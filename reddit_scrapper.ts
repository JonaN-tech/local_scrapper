import { PlatformScraper, NormalizedPost, ScrapingParams } from '../core/NormalizedPost';
import { HttpRateLimiter } from '../utils/rateLimiter';
import { TimeWindow } from '../utils/timeWindow';

/**
 * Reddit Scraper - Direct JSON API
 * FOR LOCAL DEVELOPMENT ONLY
 * This file should NEVER be imported in production builds
 */
export class RedditScraperLocal implements PlatformScraper {
  platform: 'reddit' = 'reddit';
  private rateLimiter: HttpRateLimiter;

  constructor() {
    this.rateLimiter = new HttpRateLimiter('reddit');
    console.log('[RedditScraperLocal] Initialized - LOCAL DEV ONLY');
  }

  /**
   * Fetch posts from Reddit using direct JSON API
   */
  async fetchPosts(params: ScrapingParams & { runId?: string }): Promise<NormalizedPost[]> {
    const { keywords, timeWindow, limit = 100 } = params;
    
    console.log(`[RedditScraperLocal] Fetching directly for keywords: ${keywords.join(', ')}`);
    
    const allPosts: NormalizedPost[] = [];
    
    for (const keyword of keywords) {
      try {
        const keywordPosts = await this.fetchPostsForKeyword(keyword, timeWindow, limit);
        allPosts.push(...keywordPosts);
        await this.sleep(2000);
      } catch (error) {
        console.error(`[RedditScraperLocal] Error fetching for "${keyword}":`, error);
      }
    }
    
    const uniquePosts = this.deduplicateById(allPosts);
    return uniquePosts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async fetchPostsForKeyword(
    keyword: string,
    timeWindow: { from: Date; to: Date },
    limit: number
  ): Promise<NormalizedPost[]> {
    const posts: NormalizedPost[] = [];
    
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=new&t=all&limit=${limit}`;
    
    const response = await this.rateLimiter.request<any>(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (response.data && response.data.children) {
      for (const child of response.data.children) {
        const post = child.data;
        const postDate = new Date(post.created_utc * 1000);
        
        if (!TimeWindow.isWithinWindow(postDate, timeWindow.from, timeWindow.to)) {
          continue;
        }
        
        if (post.selftext === '[deleted]' || post.title === '[deleted]') {
          continue;
        }
        
        posts.push({
          id: post.id,
          platform: 'reddit',
          title: post.title,
          content: post.selftext || '',
          url: `https://reddit.com${post.permalink}`,
          author: post.author !== '[deleted]' ? post.author : undefined,
          sourceContext: `r/${post.subreddit}`,
          createdAt: postDate,
          keywordsMatched: [keyword],
          raw: {
            score: post.score,
            numComments: post.num_comments,
            subreddit: post.subreddit,
          },
        });
      }
    }
    
    return posts;
  }

  async fetchFromSubreddits(
    subreddits: string[], 
    keywords: string[], 
    timeWindow: { from: Date; to: Date }
  ): Promise<NormalizedPost[]> {
    return this.fetchPosts({ keywords, timeWindow, limit: 50 });
  }

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}