import { PlatformScraper, NormalizedPost, ScrapingParams } from '../core/NormalizedPost';
import { HttpRateLimiter } from '../utils/rateLimiter';
import { TimeWindow } from '../utils/timeWindow';
import { hasRedditCredentials, getRedditAccessToken, clearRedditTokenCache } from '../utils/redditAuth';

/**
 * Reddit Scraper - uses Reddit OAuth2 (application-only) when credentials are
 * present, falls back to unauthenticated www.reddit.com otherwise.
 *
 * OAuth2 is REQUIRED on cloud/datacenter hosts (Render, Vercel, AWS, etc.) because
 * Reddit blocks unauthenticated requests from those IP ranges with 403 Forbidden.
 *
 * Required Render env vars:
 *   REDDIT_CLIENT_ID      - from https://www.reddit.com/prefs/apps
 *   REDDIT_CLIENT_SECRET  - from https://www.reddit.com/prefs/apps
 *   REDDIT_USER_AGENT     - e.g. "MyApp/1.0 by u/yourRedditUsername"
 */

const FALLBACK_SUBREDDITS = ['vibecoding', 'AI_Agents', 'cursor', 'ClaudeAI'];

// OAuth base URL vs unauthenticated base URL
const OAUTH_BASE = 'https://oauth.reddit.com';
const PUBLIC_BASE = 'https://www.reddit.com';

function validateSubredditName(raw: string): { valid: boolean; cleaned?: string; reason?: string } {
  const cleaned = raw.replace(/^r\//i, '').trim();
  if (!cleaned || cleaned.length === 0) {
    return { valid: false, reason: 'Empty subreddit name after cleaning' };
  }
  if (cleaned.length > 50) {
    return { valid: false, reason: `Subreddit name too long (${cleaned.length} chars)` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(cleaned)) {
    return { valid: false, reason: `Invalid characters in subreddit name: "${cleaned}"` };
  }
  return { valid: true, cleaned };
}

function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

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

    if (hasRedditCredentials()) {
      console.log('[RedditScraperLocal] Reddit OAuth credentials found -- will use authenticated API (oauth.reddit.com)');
    } else {
      console.warn('[RedditScraperLocal] WARNING: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set.');
      console.warn('[RedditScraperLocal]   Unauthenticated scraping from cloud hosts (Render) is blocked by Reddit.');
      console.warn('[RedditScraperLocal]   Create a Reddit app at https://www.reddit.com/prefs/apps');
      console.warn('[RedditScraperLocal]   then set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in Render env vars.');
    }
  }

  async fetchPosts(params: ScrapingParams & { runId?: string }): Promise<NormalizedPost[]> {
    const { subreddits, keywords, timeWindow, limit = 50 } = params;

    if (!subreddits || subreddits.length === 0) {
      throw new Error('Subreddits list is required');
    }

    const targetSubreddits: string[] = [];
    for (const raw of subreddits) {
      const v = validateSubredditName(raw);
      if (!v.valid) {
        console.error(`[RedditScraperLocal] Skipping invalid subreddit "${raw}": ${v.reason}`);
      } else {
        targetSubreddits.push(v.cleaned!);
      }
    }

    if (targetSubreddits.length === 0) {
      throw new Error('No valid subreddits after validation');
    }

    const uniqueKeywords = deduplicateKeywords(keywords);

    console.log(`[RedditScraperLocal] Fetching from ${targetSubreddits.length} subreddits: [${targetSubreddits.join(', ')}]`);
    console.log(`[RedditScraperLocal] Using ${hasRedditCredentials() ? 'authenticated OAuth API (oauth.reddit.com)' : 'unauthenticated public API (www.reddit.com)'}`);
    console.log(`[RedditScraperLocal] Keywords: ${uniqueKeywords.join(', ')}`);

    this.rateLimiter.resetRun();

    const allPosts: NormalizedPost[] = [];
    let totalProcessed = 0;
    const subredditResults: SubredditResult[] = [];

    for (const subreddit of targetSubreddits) {
      const result = await this.fetchSubredditNew(subreddit, uniqueKeywords, timeWindow, limit);
      subredditResults.push(result);

      if (result.status === 'ok') {
        allPosts.push(...result.posts);
      } else {
        console.warn(`[RedditScraperLocal] r/${subreddit} skipped: ${result.reason || result.status}`);
      }

      totalProcessed++;

      if (totalProcessed % 10 === 0 || totalProcessed === targetSubreddits.length) {
        console.log(`[RedditScraperLocal] Progress: ${totalProcessed}/${targetSubreddits.length} subreddits processed`);
      }
    }

    const blocked = subredditResults.filter(r => r.status === 'blocked');
    const errors  = subredditResults.filter(r => r.status === 'error');
    const ok      = subredditResults.filter(r => r.status === 'ok');

    console.log(`[RedditScraperLocal] Run summary:`);
    console.log(`[RedditScraperLocal]   OK     : ${ok.length}`);
    console.log(`[RedditScraperLocal]   Blocked: ${blocked.length}${blocked.length > 0 ? ' (' + blocked.map(r => 'r/' + r.subreddit).join(', ') + ')' : ''}`);
    console.log(`[RedditScraperLocal]   Errors : ${errors.length}${errors.length > 0 ? ' (' + errors.map(r => 'r/' + r.subreddit).join(', ') + ')' : ''}`);

    if (blocked.length > 0 && !hasRedditCredentials()) {
      console.error(`[RedditScraperLocal] BLOCKED subreddits and no OAuth credentials set.`);
      console.error(`[RedditScraperLocal] Fix: add REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET to Render env vars.`);
    }

    const uniquePosts = this.deduplicateById(allPosts);
    console.log(`[RedditScraperLocal] Found ${uniquePosts.length} unique posts`);
    return uniquePosts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Fetch one subreddit. Automatically uses OAuth when credentials are set.
   * If the OAuth token request itself fails, logs clearly and falls back to null
   * so the run can continue with other subreddits.
   */
  private async fetchSubredditNew(
    subreddit: string,
    keywords: string[],
    timeWindow: { from: Date; to: Date },
    limit: number
  ): Promise<SubredditResult> {
    const posts: NormalizedPost[] = [];

    // Build URL and auth headers depending on whether credentials are available
    let url: string;
    let authHeaders: Record<string, string> = {};

    if (hasRedditCredentials()) {
      // Authenticated path: oauth.reddit.com -- works from Render/cloud IPs
      url = `${OAUTH_BASE}/r/${subreddit}/new.json?limit=${limit}&raw_json=1`;
      try {
        const token = await getRedditAccessToken();
        const ua = process.env['REDDIT_USER_AGENT'] ||
          'MultiPlatformScraper/1.0 (contact: support@example.com)';
        authHeaders = {
          'Authorization': `Bearer ${token}`,
          'User-Agent': ua,
        };
        console.log(`[RedditScraperLocal] r/${subreddit}: using OAuth token (oauth.reddit.com)`);
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : String(authErr);
        console.error(`[RedditScraperLocal] r/${subreddit}: OAuth token fetch failed: ${msg}`);
        return { subreddit, posts: [], status: 'error', reason: `OAuth token fetch failed: ${msg}` };
      }
    } else {
      // Unauthenticated fallback -- will 403 on cloud hosts
      url = `${PUBLIC_BASE}/r/${subreddit}/new.json?limit=${limit}`;
      console.warn(`[RedditScraperLocal] r/${subreddit}: no credentials, using unauthenticated endpoint (may 403 on Render)`);
    }

    console.log(`[RedditScraperLocal] Requesting: ${url}`);

    const response = await this.rateLimiter.request<any>(url, { headers: authHeaders }, subreddit);

    if (!response) {
      const stats = this.rateLimiter.getStats() as any;
      const isBlocked = Array.isArray(stats.blockedSubreddits) && stats.blockedSubreddits.includes(subreddit);

      // If we got a 401 with OAuth it means the token was rejected -- clear cache and report
      return {
        subreddit,
        posts: [],
        status: isBlocked ? 'blocked' : 'error',
        reason: isBlocked
          ? '403 Forbidden - Reddit blocked this request (likely cloud IP block or invalid credentials)'
          : 'No response (rate limited, network error, or private subreddit)',
      };
    }

    if (!response?.data?.data?.children) {
      const kind = response?.data?.kind;
      const reason = kind === 'Listing'
        ? 'Empty subreddit (no posts in feed)'
        : 'Unexpected response shape -- subreddit may be private, quarantined, or banned';
      console.warn(`[RedditScraperLocal] r/${subreddit}: ${reason}`);
      return { subreddit, posts: [], status: 'error', reason };
    }

    let postsInWindow = 0;
    let skippedCrossPost = 0;
    let skippedDeleted = 0;
    let skippedTimeWindow = 0;
    let skippedNoKeyword = 0;
    let skippedNoSubreddit = 0;

    const children = response.data.data.children;
    console.log(`[RedditScraperLocal] r/${subreddit}: Processing ${children.length} posts from API`);

    for (const child of children) {
      const post = child.data;
      const postDate = new Date(post.created_utc * 1000);

      if (!TimeWindow.isWithinWindow(postDate, timeWindow.from, timeWindow.to)) {
        skippedTimeWindow++;
        continue;
      }

      if (post.selftext === '[deleted]' || post.title === '[deleted]' || post.removed_by_category) {
        skippedDeleted++;
        continue;
      }

      const titleLower = post.title.toLowerCase();
      const keywordsMatched = keywords.filter(kw => titleLower.includes(kw.toLowerCase()));

      if (keywordsMatched.length === 0) {
        skippedNoKeyword++;
        continue;
      }

      const extraction = this.extractSubreddit(post);

      if (!extraction.subreddit) {
        if (extraction.isCrossPost) {
          skippedCrossPost++;
        } else {
          skippedNoSubreddit++;
        }
        continue;
      }

      posts.push({
        id: post.id,
        platform: 'reddit',
        title: post.title,
        content: post.selftext || '',
        url: `https://reddit.com${post.permalink}`,
        author: this.extractAuthor(post),
        sourceContext: `r/${extraction.subreddit}`,
        createdAt: postDate,
        keywordsMatched,
        raw: {
          score: post.score,
          numComments: post.num_comments,
          subreddit: extraction.subreddit,
        },
      });
      postsInWindow++;
    }

    console.log(`[RedditScraperLocal] r/${subreddit}: SUMMARY`);
    console.log(`[RedditScraperLocal]   Matched: ${postsInWindow}`);
    if (skippedTimeWindow > 0) console.log(`[RedditScraperLocal]   Skipped (time window): ${skippedTimeWindow}`);
    if (skippedDeleted > 0)    console.log(`[RedditScraperLocal]   Skipped (deleted): ${skippedDeleted}`);
    if (skippedNoKeyword > 0)  console.log(`[RedditScraperLocal]   Skipped (no keyword): ${skippedNoKeyword}`);
    if (skippedCrossPost > 0)  console.log(`[RedditScraperLocal]   Skipped (cross-post): ${skippedCrossPost}`);
    if (skippedNoSubreddit > 0) console.log(`[RedditScraperLocal]   Skipped (no subreddit): ${skippedNoSubreddit}`);

    return { subreddit, posts, status: 'ok' };
  }

  private extractSubreddit(post: any): { subreddit: string | null; isCrossPost: boolean } {
    let permalinkSubreddit: string | null = null;
    if (post.permalink && typeof post.permalink === 'string') {
      const match = post.permalink.match(/^\/r\/([^\/]+)\//);
      if (match?.[1]) {
        permalinkSubreddit = this.normalizeSubreddit(match[1]);
      }
    }

    if (!permalinkSubreddit) return { subreddit: null, isCrossPost: false };

    if (post.subreddit && typeof post.subreddit === 'string') {
      const apiSub = this.normalizeSubreddit(post.subreddit);
      if (apiSub !== permalinkSubreddit) {
        return { subreddit: null, isCrossPost: true };
      }
    }

    return { subreddit: permalinkSubreddit, isCrossPost: false };
  }

  private normalizeSubreddit(subreddit: string): string {
    return subreddit.toLowerCase().trim().replace(/^r\//i, '');
  }

  private extractAuthor(post: any): string {
    if (!post.author || post.author === '[deleted]') return '[deleted]';
    return post.author;
  }

  /** @deprecated Use fetchPosts with explicit subreddits */
  async fetchFromSubreddits(
    subreddits: string[],
    keywords: string[],
    timeWindow: { from: Date; to: Date }
  ): Promise<NormalizedPost[]> {
    return this.fetchPosts({ subreddits, keywords, timeWindow, limit: 50 });
  }

  /** @deprecated Use fetchPosts with explicit subreddits and keywords */
  async fetchTrending(timeWindow: { from: Date; to: Date }): Promise<NormalizedPost[]> {
    return this.fetchPosts({
      subreddits: FALLBACK_SUBREDDITS,
      keywords: ['ai', 'cursor', 'claude', 'github copilot'],
      timeWindow,
      limit: 50,
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
