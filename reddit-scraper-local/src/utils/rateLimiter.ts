/**
 * HTTP Rate Limiter with proper backoff strategies
 */

// Reddit-specific base headers (no Authorization -- that is added per-request by the scraper)
// User-Agent falls back to a full browser UA if REDDIT_USER_AGENT env var is not set.
const buildUserAgent = (): string => {
  const envUA = process.env['REDDIT_USER_AGENT'];
  if (envUA && envUA.trim().length > 0) return envUA.trim();
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
};

// These headers are merged with every request.
// NOTE: if the caller supplies Authorization or User-Agent (OAuth path), those win.
export const REDDIT_BASE_HEADERS = {
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const DEFAULT_USER_AGENT = buildUserAgent();

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
  private readonly windowMs: number = 60000;
  private readonly maxRequestsPerMinute: number = 30;
  private readonly minRequestIntervalMs: number = 2000;

  private blockedSubreddits: Set<string> = new Set();
  private blockedKeywords: Set<string> = new Set();

  private totalRequestsThisRun: number = 0;
  private readonly maxRequestsPerRun: number = 30;
  private runStartTime: number = 0;

  private lastRateLimitTime: number = 0;
  private rateLimitBackoffMs: number = 30000;

  constructor(platform: string) {
    this.platform = platform;
    console.log(`[HttpRateLimiter] Initialized for ${platform}`);
    console.log(`[HttpRateLimiter] Default User-Agent: ${DEFAULT_USER_AGENT}`);
    console.log(`[HttpRateLimiter] User-Agent source: ${process.env['REDDIT_USER_AGENT'] ? 'REDDIT_USER_AGENT env var' : 'built-in default'}`);
  }

  resetRun(): void {
    this.totalRequestsThisRun = 0;
    this.runStartTime = Date.now();
    this.blockedSubreddits.clear();
    this.blockedKeywords.clear();
    console.log(`[HttpRateLimiter] Run state reset`);
  }

  async checkRequest(subreddit?: string, keyword?: string): Promise<RateLimitResult> {
    const now = Date.now();

    if (this.totalRequestsThisRun >= this.maxRequestsPerRun) {
      return { action: 'stop', reason: 'Max requests per run reached' };
    }
    if (subreddit && this.blockedSubreddits.has(subreddit)) {
      return { action: 'stop', reason: `Subreddit r/${subreddit} is blocked (403)` };
    }
    if (keyword && this.blockedKeywords.has(keyword)) {
      return { action: 'stop', reason: `Keyword "${keyword}" is blocked` };
    }
    if (now - this.lastRateLimitTime < this.rateLimitBackoffMs) {
      const waitMs = this.rateLimitBackoffMs - (now - this.lastRateLimitTime);
      return { action: 'wait', waitMs, reason: 'Rate limit backoff' };
    }
    if (now - this.lastReset > this.windowMs) {
      this.requests = 0;
      this.lastReset = now;
    }
    if (this.requests >= this.maxRequestsPerMinute) {
      const waitMs = this.windowMs - (now - this.lastReset);
      return { action: 'wait', waitMs, reason: 'Rate limit window full' };
    }
    const timeSinceLastRequest = now - this.lastReset;
    if (this.requests > 0 && timeSinceLastRequest < this.minRequestIntervalMs) {
      const waitMs = this.minRequestIntervalMs - timeSinceLastRequest;
      return { action: 'wait', waitMs, reason: 'Minimum interval' };
    }
    return { action: 'continue' };
  }

  /**
   * Execute a request with rate limiting.
   * options.headers may include Authorization (OAuth) and User-Agent -- they are preserved.
   */
  async request<T>(
    url: string,
    options?: RequestInit,
    subreddit?: string,
    keyword?: string
  ): Promise<{ data: T } | null> {
    const check = await this.checkRequest(subreddit, keyword);

    if (check.action === 'stop') {
      console.log(`[HttpRateLimiter] Skipping request: ${check.reason}`);
      return null;
    }
    if (check.action === 'wait' && check.waitMs) {
      console.log(`[HttpRateLimiter] Waiting ${check.waitMs}ms: ${check.reason}`);
      await this.sleep(check.waitMs);
    }

    return this.executeRequest<T>(url, options, subreddit, keyword);
  }

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

    // Merge headers: base headers first, then caller headers (OAuth token + UA win)
    const callerHeaders = (options?.headers as Record<string, string> | undefined) || {};
    const finalHeaders: Record<string, string> = {
      ...REDDIT_BASE_HEADERS,
      'User-Agent': DEFAULT_USER_AGENT, // default, overridden below if caller provides one
      ...callerHeaders,                 // caller Authorization + User-Agent win
    };

    // Safe header log: hide Authorization value, show that it IS set
    const safeHeaderLog: Record<string, string> = {};
    for (const [k, v] of Object.entries(finalHeaders)) {
      if (k.toLowerCase() === 'authorization') {
        safeHeaderLog[k] = v.startsWith('Bearer ') ? 'Bearer [REDACTED]' : '[REDACTED]';
      } else if (['cookie', 'x-reddit-token'].includes(k.toLowerCase())) {
        safeHeaderLog[k] = '[REDACTED]';
      } else {
        safeHeaderLog[k] = v;
      }
    }
    console.log(`[HttpRateLimiter] Request headers:`, JSON.stringify(safeHeaderLog));
    console.log(`[HttpRateLimiter] Method: ${options?.method || 'GET'}`);
    if (subreddit) console.log(`[HttpRateLimiter] Subreddit: r/${subreddit}`);
    console.log(`[HttpRateLimiter] Auth: ${finalHeaders['Authorization'] ? 'OAuth Bearer token' : 'none (unauthenticated)'}`);

    try {
      const response = await fetch(url, { ...options, headers: finalHeaders });

      const duration = Date.now() - startTime;
      console.log(`[HttpRateLimiter] Response: ${response.status} ${response.statusText} (${duration}ms)`);

      if (response.status === 403) {
        let bodyPreview = '';
        try { bodyPreview = (await response.text()).substring(0, 400); } catch { bodyPreview = '[unreadable]'; }

        console.error(`[HttpRateLimiter] 403 Forbidden`);
        console.error(`[HttpRateLimiter]   Subreddit : r/${subreddit || 'unknown'}`);
        console.error(`[HttpRateLimiter]   URL       : ${url}`);
        console.error(`[HttpRateLimiter]   Auth used : ${finalHeaders['Authorization'] ? 'OAuth Bearer' : 'NONE'}`);
        console.error(`[HttpRateLimiter]   Body      : ${bodyPreview}`);
        console.error(`[HttpRateLimiter]   Possible causes:`);
        if (!finalHeaders['Authorization']) {
          console.error(`[HttpRateLimiter]     -> No OAuth token. Reddit blocks unauthenticated requests from Render IPs.`);
          console.error(`[HttpRateLimiter]        Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in Render env vars.`);
        } else {
          console.error(`[HttpRateLimiter]     -> OAuth token was sent but still got 403.`);
          console.error(`[HttpRateLimiter]        Subreddit may be private, banned, quarantined, or nonexistent.`);
          console.error(`[HttpRateLimiter]        Or credentials may be wrong / app suspended.`);
        }

        if (!isRetry) {
          console.warn(`[HttpRateLimiter] Retrying once in 3s for r/${subreddit || 'unknown'}...`);
          await this.sleep(3000);
          this.totalRequestsThisRun--;
          this.requests--;
          const retryResult = await this.executeRequest<T>(url, options, subreddit, keyword, true);
          if (retryResult !== null) return retryResult;
          console.error(`[HttpRateLimiter] 403 persists after retry -- blocking r/${subreddit || 'unknown'} for this run`);
        } else {
          console.error(`[HttpRateLimiter] 403 Forbidden - Blocking subreddit r/${subreddit || 'unknown'} after retry`);
        }

        if (subreddit) this.blockedSubreddits.add(subreddit);
        return null;
      }

      if (response.status === 401) {
        // OAuth token was rejected -- clear the cache so next request gets a fresh token
        let bodyPreview = '';
        try { bodyPreview = (await response.text()).substring(0, 200); } catch { /* ignore */ }
        console.error(`[HttpRateLimiter] 401 Unauthorized`);
        console.error(`[HttpRateLimiter]   URL: ${url}`);
        console.error(`[HttpRateLimiter]   Body: ${bodyPreview}`);
        console.error(`[HttpRateLimiter]   OAuth token may be expired or credentials are invalid.`);
        console.error(`[HttpRateLimiter]   Clearing token cache...`);
        // Dynamic import to avoid circular dependency
        const { clearRedditTokenCache } = await import('./redditAuth.js');
        clearRedditTokenCache();
        return null;
      }

      if (response.status === 429) {
        let bodyPreview = '';
        try { bodyPreview = (await response.text()).substring(0, 200); } catch { /* ignore */ }
        console.error(`[HttpRateLimiter] 429 Too Many Requests`);
        console.error(`[HttpRateLimiter]   URL: ${url}, Subreddit: r/${subreddit || 'unknown'}`);
        console.error(`[HttpRateLimiter]   Body: ${bodyPreview}`);
        this.lastRateLimitTime = Date.now();
        this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, 120000);
        console.error(`[HttpRateLimiter]   Next backoff: ${this.rateLimitBackoffMs}ms`);
        return null;
      }

      if (!response.ok) {
        let bodyPreview = '';
        try { bodyPreview = (await response.text()).substring(0, 300); } catch { /* ignore */ }
        console.error(`[HttpRateLimiter] HTTP Error: ${response.status} ${response.statusText}`);
        console.error(`[HttpRateLimiter]   URL: ${url}, Body: ${bodyPreview}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.rateLimitBackoffMs = 30000;
      const data = await response.json();
      return { data };

    } catch (error) {
      console.error(`[HttpRateLimiter] Request failed:`, error);
      return null;
    }
  }

  blockSubreddit(subreddit: string): void {
    this.blockedSubreddits.add(subreddit);
    console.log(`[HttpRateLimiter] Blocked subreddit: r/${subreddit}`);
  }

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
