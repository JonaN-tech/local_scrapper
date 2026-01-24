/**
 * HTTP Rate Limiter with proper backoff strategies
 * FOR LOCAL DEVELOPMENT ONLY
 */

// Reddit-specific request headers to avoid 403 blocks
export const REDDIT_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    console.log(`[HttpRateLimiter] Initialized for ${platform} - LOCAL DEV ONLY`);
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
   * Execute a request with proper rate limiting
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
   * Execute the actual HTTP request
   */
  private async executeRequest<T>(
    url: string, 
    options?: RequestInit,
    subreddit?: string,
    keyword?: string
  ): Promise<{ data: T } | null> {
    const startTime = Date.now();
    this.totalRequestsThisRun++;
    this.requests++;
    
    console.log(`[HttpRateLimiter] [${this.totalRequestsThisRun}/${this.maxRequestsPerRun}] Request to: ${url}`);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...REDDIT_REQUEST_HEADERS,
          ...options?.headers,
        },
      });
      
      const duration = Date.now() - startTime;
      console.log(`[HttpRateLimiter] Response: ${response.status} ${response.statusText} (${duration}ms, requests this minute: ${this.requests})`);
      
      // Handle different HTTP status codes
      if (response.status === 403) {
        console.error(`[HttpRateLimiter] 403 Forbidden - Blocking subreddit`);
        if (subreddit) this.blockedSubreddits.add(subreddit);
        return null;
      }
      
      if (response.status === 429) {
        console.error(`[HttpRateLimiter] 429 Too Many Requests - Applying backoff`);
        this.lastRateLimitTime = Date.now();
        this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, 120000); // Max 2 min backoff
        return null;
      }
      
      if (!response.ok) {
        console.error(`[HttpRateLimiter] HTTP Error: ${response.status} ${response.statusText}`);
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
