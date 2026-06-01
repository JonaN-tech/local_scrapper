import { PlatformScraper, NormalizedPost, ScrapingParams } from '../core/NormalizedPost';
import { HttpRateLimiter } from '../utils/rateLimiter';
import { TimeWindow } from '../utils/timeWindow';

/**
 * Reddit Scraper - Direct JSON API
 *
 * IMPORTANT: Uses EXACTLY the subreddits provided in the request.
 * No hardcoded lists, no automatic expansion.
 *
 * NOTE: Unauthenticated scraping from cloud/datacenter IPs (Render, Vercel, etc.)
 * will often receive 403 Forbidden from Reddit. Set REDDIT_CLIENT_ID and
 * REDDIT_CLIENT_SECRET in your Render environment to use authenticated OAuth.
 * At a minimum, set REDDIT_USER_AGENT to a descriptive custom string.
 */

// Allowed fallback subreddits for error cases only (deprecated methods only)
const FALLBACK_SUBREDDITS = ['vibecoding', 'AI_Agents', 'cursor', 'ClaudeAI'];

/**
 * Validate subreddit name format.
 * Returns { valid: true, cleaned } or { valid: false, reason }
 */
function validateSubredditName(raw: string): { valid: boolean; cleaned?: string; reason?: string } {
  // Remove leading/trailing whitespace and r/ prefix
  const cleaned = raw.replace(/^r\//i, '').trim();

  if (!cleaned || cleaned.length === 0) {
    return { valid: false, reason: 'Empty subreddit name after cleaning' };
  }
  if (cleaned.length > 50) {
    return { valid: false, reason: `Subreddit name too long (${cleaned.length} chars)` };
  }
  // Reddit subreddit names: letters, digits, underscores only
  if (!/^[A-Za-z0-9_]+$/.test(cleaned)) {
    return { valid: false, reason: `Invalid characters in subreddit name: "${cleaned}"` };
  }
  return { valid: true, cleaned };
}

/**
 * Normalize a keyword for consistent searching
 * - Lowercase
 * - Trim whitespace
 * - Replace underscores and hyphens with spaces
 */
function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' '); // Collapse multiple spaces
}

/**
 * Deduplicate keywords after normalization
 */
function deduplicateKeywords(keywords: string[]): string[] {
  const normalized = keywords.map(normalizeKeyword);
  const seen = new Set<string>();
  return normalized.filter(kw => {
    if (seen.has(kw)) return false;
    seen.add(kw);
    return true;
  });
}

export interface SubredditResult {
  subreddit: string;
  posts: NormalizedPost[];
  status: 'ok' | 'blocked' | 'error' | 'skipped';
  reason?: string;
}

export class RedditScraperLocal implements PlatformScraper {
  platform: 'reddit' = 'reddit';
  private rateLimiter: HttpRateLimiter;

  constructor() {
    this.rateLimiter = new HttpRateLimiter('reddit');
    console.log('[RedditScraperLocal] Initialized');

    // Warn loudly in production if credentials are missing
    if (!process.env['REDDIT_CLIENT_ID']) {
      console.warn('[RedditScraperLocal] WARNING: REDDIT_CLIENT_ID is not set.');
      console.warn('[RedditScraperLocal]   Unauthenticated scraping from cloud hosts (Render, Vercel)');
      console.warn('[RedditScraperLocal]   is frequently blocked by Reddit with 403 Forbidden.');
      console.warn('[RedditScraperLocal]   Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in your Render env vars.');
    }
    if (!process.env['REDDIT_USER_AGENT']) {
      console.warn('[RedditScraperLocal] WARNING: REDDIT_USER_AGENT is not set. Using built-in default.');
    }
  }

  /**
   * Fetch posts from Reddit using EXACTLY the requested subreddits.
   * No internal expansion or modification of subreddit list.
   * Subreddits that fail (403, invalid name, etc.) are skipped; others continue.
   */
  async fetchPosts(params: ScrapingParams & { runId?: string }): Promise<NormalizedPost[]> {
    const { subreddits, keywords, timeWindow, limit = 50 } = params;

    // Validate subreddits - must be provided
    if (!subreddits || subreddits.length === 0) {
      throw new Error('Subreddits list is required - cannot use default list');
    }

    // Validate and clean each subreddit name upfront
    const targetSubreddits: string[] = [];
    for (const raw of subreddits) {
      const validation = validateSubredditName(raw);
      if (!validation.valid) {
        console.error(`[RedditScraperLocal] Skipping invalid subreddit "${raw}": ${validation.reason}`);
      } else {
        targetSubreddits.push(validation.cleaned!);
      }
    }

    if (targetSubreddits.length === 0) {
      throw new Error('No valid subreddits after validation');
    }

    // Normalize and deduplicate keywords
    const uniqueKeywords = deduplicateKeywords(keywords);

    console.log(`[RedditScraperLocal] Fetching from ${targetSubreddits.length} subreddits: [${targetSubreddits.join(', ')}]`);
    console.log(`[RedditScraperLocal] Keywords: ${uniqueKeywords.join(', ')}`);

    // Reset rate limiter run state
    this.rateLimiter.resetRun();

    const allPosts: NormalizedPost[] = [];
    let totalProcessed = 0;
    const subredditResults: SubredditResult[] = [];

    // Process EXACTLY the requested subreddits -- one failure does NOT stop the rest
    for (const subreddit of targetSubreddits) {
      const result = await this.fetchSubredditNew(subreddit, uniqueKeywords, timeWindow, limit);
      subredditResults.push(result);

      if (result.status === 'ok') {
        allPosts.push(...result.posts);
      } else {
        console.warn(`[RedditScraperLocal] r/${subreddit} skipped: ${result.reason || result.status}`);
      }

      totalProcessed++;

      // Progress log every 10 requests
      if (totalProcessed % 10 === 0 || totalProcessed === targetSubreddits.length) {
        console.log(`[RedditScraperLocal] Progress: ${totalProcessed}/${targetSubreddits.length} subreddits processed`);
      }
    }

    // Summary of subreddit results
    const blocked = subredditResults.filter(r => r.status === 'blocked');
    const errors = subredditResults.filter(r => r.status === 'error');
    const ok = subredditResults.filter(r => r.status === 'ok');

    console.log(`[RedditScraperLocal] Run summary:`);
    console.log(`[RedditScraperLocal]   OK     : ${ok.length} subreddits`);
    console.log(`[RedditScraperLocal]   Blocked: ${blocked.length} subreddits${blocked.length > 0 ? ' (' + blocked.map(r => 'r/' + r.subreddit).join(', ') + ')' : ''}`);
    console.log(`[RedditScraperLocal]   Errors : ${errors.length} subreddits${errors.length > 0 ? ' (' + errors.map(r => 'r/' + r.subreddit).join(', ') + ')' : ''}`);

    if (blocked.length > 0) {
      console.error(`[RedditScraperLocal] BLOCKED SUBREDDITS: ${blocked.map(r => 'r/' + r.subreddit + ' (' + (r.reason || '403') + ')').join(', ')}`);
      console.error(`[RedditScraperLocal] This is most likely caused by Reddit blocking Render/cloud datacenter IPs.`);
      console.error(`[RedditScraperLocal] Fix: Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in Render environment variables.`);
    }

    const uniquePosts = this.deduplicateById(allPosts);
    console.log(`[RedditScraperLocal] Found ${uniquePosts.length} unique posts from ${totalProcessed} subreddits`);

    return uniquePosts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Fetch posts from a subreddit's new feed and filter by keywords locally.
   * Returns a SubredditResult so callers know whether it succeeded or why it failed.
   * Never throws -- all errors are caught and returned as status fields.
   */
  private async fetchSubredditNew(
    subreddit: string,
    keywords: string[],
    timeWindow: { from: Date; to: Date },
    limit: number
  ): Promise<SubredditResult> {
    const posts: NormalizedPost[] = [];

    // Use /r/{subreddit}/new.json -- simpler and safer than search endpoint
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`;

    console.log(`[RedditScraperLocal] Requesting: ${url}`);

    // Do NOT pass headers here -- rateLimiter enforces the correct User-Agent itself
    const response = await this.rateLimiter.request<any>(url, {}, subreddit);

    if (!response) {
      // Check if the subreddit got blocked (403) or just hit rate limits
      const stats = this.rateLimiter.getStats() as any;
      const isBlocked = Array.isArray(stats.blockedSubreddits) && stats.blockedSubreddits.includes(subreddit);

      if (isBlocked) {
        return {
          subreddit,
          posts: [],
          status: 'blocked',
          reason: '403 Forbidden - Reddit blocked this request (likely cloud IP or unauthenticated)',
        };
      }

      // Generic failure (rate limit, network error, etc.)
      return {
        subreddit,
        posts: [],
        status: 'error',
        reason: 'No response from Reddit (rate limited, network error, or private subreddit)',
      };
    }

    if (!response?.data?.data?.children) {
      // Reddit returned a response but it has no posts array
      // This can mean: subreddit is private, quarantined, banned, or empty
      const kind = response?.data?.kind;
      const reason = kind === 'Listing'
        ? 'Empty subreddit (no posts in feed)'
        : 'Unexpected response shape -- subreddit may be private, quarantined, or banned';
      console.warn(`[RedditScraperLocal] r/${subreddit}: ${reason}`);
      return {
        subreddit,
        posts: [],
        status: 'error',
        reason,
      };
    }

    let postsInWindow = 0;
    let postsFiltered = 0;
    let matchedCount = 0;
    let skippedNoSubreddit = 0;
    let skippedCrossPost = 0;
    let skippedDeleted = 0;
    let skippedTimeWindow = 0;
    let skippedNoKeyword = 0;

    const children = response.data.data.children;
    console.log(`[RedditScraperLocal] r/${subreddit}: Processing ${children.length} posts from API`);

    for (const child of children) {
      const post = child.data;
      const postDate = new Date(post.created_utc * 1000);

      // Check time window
      if (!TimeWindow.isWithinWindow(postDate, timeWindow.from, timeWindow.to)) {
        postsFiltered++;
        skippedTimeWindow++;
        continue;
      }

      // Filter deleted/removed posts
      if (post.selftext === '[deleted]' || post.title === '[deleted]' || post.removed_by_category) {
        skippedDeleted++;
        continue;
      }

      // Check if any keyword matches in title (case-insensitive)
      const titleLower = post.title.toLowerCase();
      const keywordsMatched = keywords.filter(kw =>
        titleLower.includes(kw.toLowerCase())
      );

      if (keywordsMatched.length === 0) {
        skippedNoKeyword++;
        continue; // No keyword match, skip
      }

      // CRITICAL: Extract subreddit using canonical logic (permalink is source of truth)
      const extraction = this.extractSubreddit(post);

      if (!extraction.subreddit) {
        if (extraction.isCrossPost) {
          // This is a cross-subreddit post - skip it
          skippedCrossPost++;
          const apiSubreddit = post.subreddit ? this.normalizeSubreddit(post.subreddit) : 'unknown';
          const permalinkMatch = post.permalink?.match(/^\/r\/([^\/]+)\//);
          const permalinkSubreddit = permalinkMatch ? permalinkMatch[1].toLowerCase() : 'unknown';

          console.log(`[RedditScraperLocal] Skipped cross-subreddit post`);
          console.log(`[RedditScraperLocal]   Post ID: ${post.id}`);
          console.log(`[RedditScraperLocal]   Title: ${post.title?.substring(0, 50)}...`);
          console.log(`[RedditScraperLocal]   Requested: r/${subreddit}`);
          console.log(`[RedditScraperLocal]   API says: r/${apiSubreddit}`);
          console.log(`[RedditScraperLocal]   Permalink says: r/${permalinkSubreddit}`);
          console.log(`[RedditScraperLocal]   -> Canonical subreddit mismatch - skipping`);
        } else {
          // Could not extract subreddit at all
          skippedNoSubreddit++;
          console.warn(`[RedditScraperLocal] SKIPPED POST - No subreddit extractable`);
          console.warn(`[RedditScraperLocal]   Post ID: ${post.id}`);
          console.warn(`[RedditScraperLocal]   Permalink: ${post.permalink}`);
          console.warn(`[RedditScraperLocal]   Has post.subreddit: ${!!post.subreddit}`);
        }
        continue;
      }

      const extractedSubreddit = extraction.subreddit;

      // Extract author with proper handling
      const author = this.extractAuthor(post);

      matchedCount++;
      posts.push({
        id: post.id,
        platform: 'reddit',
        title: post.title,
        content: post.selftext || '',
        url: `https://reddit.com${post.permalink}`,
        author: author,
        sourceContext: `r/${extractedSubreddit}`,
        createdAt: postDate,
        keywordsMatched,
        raw: {
          score: post.score,
          numComments: post.num_comments,
          subreddit: extractedSubreddit,
        },
      });
      postsInWindow++;
    }

    // Enhanced summary logging
    console.log(`[RedditScraperLocal] r/${subreddit}: SUMMARY`);
    console.log(`[RedditScraperLocal]   Matched & extracted: ${postsInWindow} posts`);
    if (skippedTimeWindow > 0) console.log(`[RedditScraperLocal]   Skipped (time window): ${skippedTimeWindow}`);
    if (skippedDeleted > 0) console.log(`[RedditScraperLocal]   Skipped (deleted): ${skippedDeleted}`);
    if (skippedNoKeyword > 0) console.log(`[RedditScraperLocal]   Skipped (no keyword match): ${skippedNoKeyword}`);
    if (skippedCrossPost > 0) console.log(`[RedditScraperLocal]   Skipped (cross-subreddit posts): ${skippedCrossPost}`);
    if (skippedNoSubreddit > 0) console.log(`[RedditScraperLocal]   Skipped (NO SUBREDDIT): ${skippedNoSubreddit}`);

    return { subreddit, posts, status: 'ok' };
  }

  /**
   * Canonical subreddit extraction logic
   * PERMALINK IS THE SOURCE OF TRUTH - Reddit API can return cross-subreddit posts
   */
  private extractSubreddit(post: any): { subreddit: string | null; isCrossPost: boolean } {
    let permalinkSubreddit: string | null = null;
    if (post.permalink && typeof post.permalink === 'string') {
      const match = post.permalink.match(/^\/r\/([^\/]+)\//);
      if (match && match[1]) {
        permalinkSubreddit = this.normalizeSubreddit(match[1]);
      }
    }

    if (!permalinkSubreddit) {
      return { subreddit: null, isCrossPost: false };
    }

    if (post.subreddit && typeof post.subreddit === 'string') {
      const apiSubreddit = this.normalizeSubreddit(post.subreddit);
      if (apiSubreddit !== permalinkSubreddit) {
        return { subreddit: null, isCrossPost: true };
      }
    }

    return { subreddit: permalinkSubreddit, isCrossPost: false };
  }

  /**
   * Normalize subreddit name: lowercase, remove r/ prefix, trim whitespace
   */
  private normalizeSubreddit(subreddit: string): string {
    return subreddit
      .toLowerCase()
      .trim()
      .replace(/^r\//i, '');
  }

  /**
   * Extract author with proper handling.
   * Returns "[deleted]" for deleted accounts (Reddit convention).
   */
  private extractAuthor(post: any): string {
    if (!post.author || post.author === '[deleted]') {
      return '[deleted]';
    }
    return post.author;
  }

  /**
   * @deprecated Use fetchPosts instead with explicit subreddits
   */
  async fetchFromSubreddits(
    subreddits: string[],
    keywords: string[],
    timeWindow: { from: Date; to: Date }
  ): Promise<NormalizedPost[]> {
    return this.fetchPosts({ subreddits, keywords, timeWindow, limit: 50 });
  }

  /**
   * @deprecated Use fetchPosts instead with explicit subreddits and keywords
   */
  async fetchTrending(timeWindow: { from: Date; to: Date }): Promise<NormalizedPost[]> {
    return this.fetchPosts({
      subreddits: FALLBACK_SUBREDDITS,
      keywords: ['ai', 'cursor', 'claude', 'github copilot'],
      timeWindow,
      limit: 50
    });
  }

  private deduplicateById(posts: NormalizedPost[]): NormalizedPost[] {
    const seen = new Set<string>();
    return posts.filter(post => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }
}
