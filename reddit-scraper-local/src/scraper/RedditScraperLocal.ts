import { PlatformScraper, NormalizedPost, ScrapingParams } from '../core/NormalizedPost';
import { HttpRateLimiter } from '../utils/rateLimiter';
import { TimeWindow } from '../utils/timeWindow';

/**
 * Reddit Scraper - Direct JSON API
 * FOR LOCAL DEVELOPMENT ONLY
 * This file should NEVER be imported in production builds
 */

// Hard-coded allow list of subreddits - NO scraping outside this list
const ALLOWED_SUBREDDITS = [
  'vibecoding',
  'saasbuild',
  'AIAssisted',
  'automation',
  'AI_Agents',
  'cursor',
  'aitoolforU',
  'NoCodeSaaS',
  'OnlyAICoding',
  'StartupSoloFounder',
  'AI_Tips_Tricks',
  'DigitalWizards',
  'ChatGPTCoding',
  'AskReddit',
  'nocode',
  'microsaas',
  'AiForSmallBusiness',
  'ClaudeAI',
  'GenAI4all',
  'ProductivityApps',
  'ChatGPTPro',
  'AIToolTesting',
  'developersIndia',
  'developersPak',
  'Entrepreneur',
  'marketing',
  'indiehackers',
  'AskProgrammers',
  'LocalLLaMA',
  'teenagersbutcode',
  'VibeCodeCamp',
  'VibeCodeDevs',
  'VibeCodersNest',
  'lovable',
  'n8n',
  'NextGenAITool'
];

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

export class RedditScraperLocal implements PlatformScraper {
  platform: 'reddit' = 'reddit';
  private rateLimiter: HttpRateLimiter;

  constructor() {
    this.rateLimiter = new HttpRateLimiter('reddit');
    console.log('[RedditScraperLocal] Initialized - LOCAL DEV ONLY');
  }

  /**
   * Fetch posts from Reddit using subreddit new feed + local keyword filtering
   * This is the SAFE strategy: ~30 requests instead of 400+
   */
  async fetchPosts(params: ScrapingParams & { runId?: string }): Promise<NormalizedPost[]> {
    const { keywords, timeWindow, limit = 50 } = params;
    
    // Normalize and deduplicate keywords
    const uniqueKeywords = deduplicateKeywords(keywords);
    console.log(`[RedditScraperLocal] Fetching from ${ALLOWED_SUBREDDITS.length} subreddits, filtering by ${uniqueKeywords.length} keywords`);
    console.log(`[RedditScraperLocal] Keywords: ${uniqueKeywords.join(', ')}`);
    
    // Reset rate limiter run state
    this.rateLimiter.resetRun();
    
    const allPosts: NormalizedPost[] = [];
    let totalRequests = 0;
    let failedSubreddits: string[] = [];

    // SAFE STRATEGY: One request per subreddit, filter locally
    for (const subreddit of ALLOWED_SUBREDDITS) {
      const posts = await this.fetchSubredditNew(subreddit, uniqueKeywords, timeWindow, limit);
      
      if (posts.length === 0) {
        // Check if it was a rate limit/block issue
        const stats = this.rateLimiter.getStats();
        if ((stats as any).blockedSubreddits?.includes(subreddit)) {
          failedSubreddits.push(subreddit);
        }
      }
      
      allPosts.push(...posts);
      totalRequests++;
      
      // Progress log every 10 requests
      if (totalRequests % 10 === 0) {
        console.log(`[RedditScraperLocal] Progress: ${totalRequests}/${ALLOWED_SUBREDDITS.length} subreddits processed`);
      }
    }
    
    const stats = this.rateLimiter.getStats();
    console.log(`[RedditScraperLocal] Run stats: ${totalRequests} requests, ${allPosts.length} posts`);
    if (failedSubreddits.length > 0) {
      console.log(`[RedditScraperLocal] Failed subreddits: ${failedSubreddits.join(', ')}`);
    }
    
    const uniquePosts = this.deduplicateById(allPosts);
    console.log(`[RedditScraperLocal] Found ${uniquePosts.length} unique posts from ${totalRequests} requests`);
    
    return uniquePosts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Fetch posts from a subreddit's new feed and filter by keywords locally
   * Uses /r/{subreddit}/new.json - much safer than search
   */
  private async fetchSubredditNew(
    subreddit: string,
    keywords: string[],
    timeWindow: { from: Date; to: Date },
    limit: number
  ): Promise<NormalizedPost[]> {
    const posts: NormalizedPost[] = [];
    
    // Use /r/{subreddit}/new.json - much simpler and safer than search
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`;
    
    const response = await this.rateLimiter.request<any>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    }, subreddit);
    
    if (!response) {
      console.log(`[RedditScraperLocal] No response from r/${subreddit} - rate limited or blocked`);
      return posts;
    }
    
    if (!response?.data?.data?.children) {
      return posts;
    }
    
    let postsInWindow = 0;
    let postsFiltered = 0;
    let matchedCount = 0;

    for (const child of response.data.data.children) {
      const post = child.data;
      const postDate = new Date(post.created_utc * 1000);
      
      // Check time window
      if (!TimeWindow.isWithinWindow(postDate, timeWindow.from, timeWindow.to)) {
        postsFiltered++;
        continue;
      }
      
      // Filter deleted/removed posts
      if (post.selftext === '[deleted]' || post.title === '[deleted]' || post.removed_by_category) {
        continue;
      }
      
      // Check if any keyword matches in title (case-insensitive)
      const titleLower = post.title.toLowerCase();
      const keywordsMatched = keywords.filter(kw => 
        titleLower.includes(kw.toLowerCase())
      );
      
      if (keywordsMatched.length === 0) {
        continue; // No keyword match, skip
      }
      
      matchedCount++;
      posts.push({
        id: post.id,
        platform: 'reddit',
        title: post.title,
        content: post.selftext || '',
        url: `https://reddit.com${post.permalink}`,
        author: post.author !== '[deleted]' ? post.author : undefined,
        sourceContext: `r/${subreddit}`,
        createdAt: postDate,
        keywordsMatched,
        raw: {
          score: post.score,
          numComments: post.num_comments,
          subreddit,
        },
      });
      postsInWindow++;
    }
    
    if (postsInWindow > 0) {
      console.log(`[RedditScraperLocal] r/${subreddit}: ${postsInWindow} posts matched keywords`);
    }
    
    return posts;
  }

  /**
   * @deprecated Use fetchPosts instead (uses safer strategy)
   */
  async fetchFromSubreddits(
    subreddits: string[], 
    keywords: string[], 
    timeWindow: { from: Date; to: Date }
  ): Promise<NormalizedPost[]> {
    return this.fetchPosts({ keywords, timeWindow, limit: 50 });
  }

  /**
   * @deprecated Use fetchPosts instead (uses safer strategy)
   */
  async fetchTrending(timeWindow: { from: Date; to: Date }): Promise<NormalizedPost[]> {
    return this.fetchPosts({ 
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
