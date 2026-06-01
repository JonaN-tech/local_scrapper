/**
 * HTTP Rate Limiter with proper backoff strategies
 */

// Reddit-specific request headers to avoid 403 blocks.
// Use REDDIT_USER_AGENT env var in production (Render) if set.
// Falls back to a realistic browser UA that passes Reddit's bot detection.
const buildUserAgent = (): string => {
  const envUA = process.env['REDDIT_USER_AGENT'];
  if (envUA && envUA.trim().length > 0) {
    return envUA.trim();
  }
  // Full, valid Chrome UA -- must include the KHTML+Chrome suffix or Reddit CDN blocks it
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
};

export const REDDIT_REQUEST_HEADERS = {
  'User-Agent': buildUserAgent(),
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.reddit.com',
  'Connection': 'keep-alive',
};

export type RateLimitAction = 'continue' | 'wait' | 'stop';

export interface RateLimitResult {
  action: RateLimitAction;
  waitMs?: number;
  reason?: string;
}

export class HttpRateLimiter {
  private platform: string;
  private requests: number = 0;
  private lastReset: number = Date.now();
  private readonly windowMs: number = 60000; // 1 minute window
  private readonly maxRequestsPerMinute: number = 30; // Conservative limit
  private readonly minRequestIntervalMs: number = 2000; // 2 seconds between requests

  // Track blocked subreddits to avoid hammering
  private blockedSubreddits: Set<string> = new Set();
  private blockedKeywords: Set<string> = new Set();

  // Per-run limits
  private totalRequestsThisRun: number = 0;
  private readonly maxRequestsPerRun: number = 30;
  private runStartTime: number = 0;

  // Rate limit (429) backoff state
  private lastRateLimitTime: number = 0;
  private rateLimitBackoffMs: number = 30000;

  constructor(platform: string) {
    this.platform = platform;
    console.log(`[HttpRateLimiter] Initialized for ${platform}`);
    console.log(`[HttpRateLimiter] User-Agent: ${REDDIT_REQUEST_HEADERS['User-Agent']}`);
    console.log(`[HttpRateLimiter] User-Agent source: ${process.env['REDDIT_USER_AGENT'] ? 'REDDIT_USER_AGENT env var' : 'built-in default'}`);
  }

  /**
   * Reset run state for a new scraping session
   */
  resetRun(): void {
    this.totalRequestsThisRun = 0;
    this.runStartTime = Date.now();
    this.blockedSubreddits.clear();
    this.blockedKeywords.clear();
    console.log(`[HttpRateLimiter] Run state reset`);
  }

  /**
   * Check if we should proceed with a request
   */
  async checkRequest(subreddit?: string, keyword?: string): Promise<RateLimitResult> {
    const now = Date.now();

    // Check run limits
    if (this.totalRequestsThisRun >= this.maxRequestsPerRun) {
      return { action: 'stop', reason: 'Max requests per run reached' };
    }

    // Check if subreddit is blocked
    if (subreddit && this.blockedSubreddits.has(subreddit)) {
      return { action: 'stop', reason: `Subreddit r/${subreddit} is blocked (403)` };
    }

    // Check if keyword is blocked
    if (keyword && this.blockedKeywords.has(keyword)) {
      return { action: 'stop', reason: `Keyword "${keyword}" is blocked` };
    }

    // Check rate limit backoff
    if (now - this.lastRateLimitTime < this.rateLimitBackoffMs) {
      const waitMs = this.rateLimitBackoffMs - (now - this.lastRateLimitTime);
      return { action: 'wait', waitMs, reason: 'Rate limit backoff' };
    }

    // Reset window if needed
    if (now - this.lastReset > this.windowMs) {
      this.requests = 0;
      this.lastReset = now;
    }

    // Check per-minute limits
    if (this.requests >= this.maxRequestsPerMinute) {
      const waitMs = this.windowMs - (now - this.lastReset);
      return { action: 'wait', waitMs, reason: 'Rate limit window full' };
    }

    // Check minimum interval
    const timeSinceLastRequest = now - this.lastReset;
    if (this.requests > 0 && timeSinceLastRequest < this.minRequestIntervalMs) {
      const waitMs = this.minRequestIntervalMs - timeSinceLastRequest;
      return { action: 'wait', waitMs, reason: 'Minimum interval' };
    }

    return { action: 'continue' };
  }

  /**
   * Execute a request with proper rate limiting.
   * On 403: retries once after a short delay before permanently blocking the subreddit.
   * On 429: applies exponential backoff (does not retry the dropped request).
   */
  async request<T>(
    url: string,
    options?: RequestInit,
    subreddit?: string,
    keyword?: string
  ): Promise<{ data: T } | null> {
    // Check if we should proceed
    const check = await this.checkRequest(subreddit, keyword);

    if (check.action === 'stop') {
      console.log(`[HttpRateLimiter] Skipping request: ${check.reason}`);
      return null;
    }

    if (check.action === 'wait' && check.waitMs) {
      console.log(`[HttpRateLimiter] Waiting ${check.waitMs}ms: ${check.reason}`);
      await this.sleep(check.waitMs);
    }

    // Actually make the request
    return this.executeRequest<T>(url, options, subreddit, keyword);
  }

  /**
   * Execute the actual HTTP request with detailed diagnostic logging.
   * isRetry flag prevents infinite recursion -- only one retry allowed.
   */
  private async executeRequest<T>(
    url: string,
    options?: RequestInit,
    subreddit?: string,
    keyword?: string,
    isRetry: boolean = false
  ): Promise<{ data: T } | null> {
    const startTime = Date.now();
    this.totalRequestsThisRun++;
    this.requests++;

    const attemptLabel = isRetry ? ' [RETRY]' : '';
    console.log(`[HttpRateLimiter] [${this.totalRequestsThisRun}/${this.maxRequestsPerRun}]${attemptLabel} Request to: ${url}`);

    // Build final headers.
    // CRITICAL: Always enforce our User-Agent -- never let callers override it.
    const callerHeaders = (options?.headers as Record<string, string> | undefined) || {};
    const finalHeaders: Record<string, string> = {
      ...callerHeaders,
      // Base headers always win for critical fields
      ...REDDIT_REQUEST_HEADERS,
    };

    // Safe header log -- never log Authorization or Cookie values
    const safeHeaderLog = Object.fromEntries(
      Object.entries(finalHeaders).filter(([k]) =>
        !['authorization', 'cookie', 'x-reddit-token'].includes(k.toLowerCase())
      )
    );
    console.log(`[HttpRateLimiter] Request headers:`, JSON.stringify(safeHeaderLog));
    console.log(`[HttpRateLimiter] Method: ${options?.method || 'GET'}`);
    if (subreddit) console.log(`[HttpRateLimiter] Subreddit: r/${subreddit}`);

    try {
      const response = await fetch(url, {
        ...options,
        headers: finalHeaders,
      });

      const duration = Date.now() - startTime;
      console.log(`[HttpRateLimiter] Response: ${response.status} ${response.statusText} (${duration}ms, requests this minute: ${this.requests})`);

      // Handle different HTTP status codes
      if (response.status === 403) {
        // Read a safe preview of the response body for diagnostics
        let bodyPreview = '';
        try {
          const rawBody = await response.text();
          bodyPreview = rawBody.substring(0, 400);
        } catch {
          bodyPreview = '[could not read response body]';
        }

        console.error(`[HttpRateLimiter] 403 Forbidden`);
        console.error(`[HttpRateLimiter]   Subreddit : r/${subreddit || 'unknown'}`);
        console.error(`[HttpRateLimiter]   URL       : ${url}`);
        console.error(`[HttpRateLimiter]   Body      : ${bodyPreview}`);
        console.error(`[HttpRateLimiter]   Likely causes:`);
        console.error(`[HttpRateLimiter]     1. Reddit blocking datacenter/cloud IPs (very common on Render/Vercel)`);
        console.error(`[HttpRateLimiter]     2. Unauthenticated scraping from a cloud host -- set REDDIT_CLIENT_ID`);
        console.error(`[HttpRateLimiter]     3. Private, banned, quarantined, or nonexistent subreddit`);
        console.error(`[HttpRateLimiter]     4. Missing or truncated User-Agent`);
        console.error(`[HttpRateLimiter]   Env check: REDDIT_USER_AGENT=${Boolean(process.env['REDDIT_USER_AGENT'])}, REDDIT_CLIENT_ID=${Boolean(process.env['REDDIT_CLIENT_ID'])}`);

        if (!isRetry) {
          // Retry once after a short delay -- might be a transient block
          console.warn(`[HttpRateLimiter] Retrying once in 5s for r/${subreddit || 'unknown'}...`);
          await this.sleep(5000);
          // Decrement counters so the retry does not double-count
          this.totalRequestsThisRun--;
          this.requests--;
          const retryResult = await this.executeRequest<T>(url, options, subreddit, keyword, true);
          if (retryResult !== null) {
            console.log(`[HttpRateLimiter] Retry succeeded for r/${subreddit || 'unknown'}`);
            return retryResult;
          }
          // Retry also failed -- permanently block for this run
          console.error(`[HttpRateLimiter] 403 persists after retry -- blocking r/${subreddit || 'unknown'} for this run`);
        } else {
          console.error(`[HttpRateLimiter] 403 Forbidden - Blocking subreddit r/${subreddit || 'unknown'} after retry`);
        }

        if (subreddit) this.blockedSubreddits.add(subreddit);
        return null;
      }

      if (response.status === 429) {
        let bodyPreview = '';
        try {
          const rawBody = await response.text();
          bodyPreview = rawBody.substring(0, 200);
        } catch {
          bodyPreview = '[could not read response body]';
        }

        console.error(`[HttpRateLimiter] 429 Too Many Requests - Applying backoff`);
        console.error(`[HttpRateLimiter]   URL: ${url}`);
        console.error(`[HttpRateLimiter]   Subreddit: r/${subreddit || 'unknown'}`);
        console.error(`[HttpRateLimiter]   Body: ${bodyPreview}`);
        this.lastRateLimitTime = Date.now();
        this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, 120000); // Max 2 min backoff
        console.error(`[HttpRateLimiter]   Next backoff: ${this.rateLimitBackoffMs}ms`);
        return null;
      }

      if (!response.ok) {
        let bodyPreview = '';
        try {
          const rawBody = await response.text();
          bodyPreview = rawBody.substring(0, 300);
        } catch {
          bodyPreview = '[could not read response body]';
        }
        console.error(`[HttpRateLimiter] HTTP Error: ${response.status} ${response.statusText}`);
        console.error(`[HttpRateLimiter]   URL: ${url}`);
        console.error(`[HttpRateLimiter]   Body: ${bodyPreview}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Success - reset rate limit backoff
      this.rateLimitBackoffMs = 30000;

      const data = await response.json();
      return { data };

    } catch (error) {
      console.error(`[HttpRateLimiter] Request failed:`, error);
      return null;
    }
  }

  /**
   * Mark a subreddit as blocked (after 403)
   */
  blockSubreddit(subreddit: string): void {
    this.blockedSubreddits.add(subreddit);
    console.log(`[HttpRateLimiter] Blocked subreddit: r/${subreddit}`);
  }

  /**
   * Get run statistics
   */
  getStats(): object {
    return {
      totalRequests: this.totalRequestsThisRun,
      requestsThisMinute: this.requests,
      blockedSubreddits: Array.from(this.blockedSubreddits),
      blockedKeywords: Array.from(this.blockedKeywords),
      runDuration: Date.now() - this.runStartTime,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
