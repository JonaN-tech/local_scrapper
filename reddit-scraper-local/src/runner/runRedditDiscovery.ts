import { RedditScraperLocal } from '../scraper/RedditScraperLocal';
import { TimeWindow } from '../utils/timeWindow';
import { NormalizedPost } from '../core/NormalizedPost';
import { supabase, isDbEnabled } from '../supabase';

export interface RedditDiscoveryRequest {
  source: 'manual' | 'schedule';
  scheduleId?: string;
  keywords: string[];
  subreddits: string[];
  window: string; // e.g., "24h", "7d"
}

export interface RedditDiscoveryResult {
  runId: string | null;
  status: 'completed' | 'failed';
  postsFound: number;
  error?: string;
}

export class RedditDiscoveryRunner {
  /**
   * Run Reddit discovery and persist results to Supabase
   */
  async run(request: RedditDiscoveryRequest): Promise<RedditDiscoveryResult> {
    const startTime = Date.now();
    let runId: string | null = null;

    console.log(`[RedditDiscoveryRunner] Starting discovery`);
    console.log(`[RedditDiscoveryRunner] Source: ${request.source}, ScheduleId: ${request.scheduleId || 'N/A'}`);
    console.log(`[RedditDiscoveryRunner] Keywords: ${request.keywords.join(', ')}`);
    console.log(`[RedditDiscoveryRunner] Subreddits: ${request.subreddits.join(', ') || 'all allowed'}`);
    console.log(`[RedditDiscoveryRunner] Window: ${request.window}`);
    console.log(`[RedditDiscoveryRunner] DB enabled: ${isDbEnabled}`);

    // Parse window string to days
    const days = this.parseWindow(request.window);
    const timeWindow = TimeWindow.createTimeWindow(days);
    const startAt = timeWindow.from.toISOString();
    const endAt = timeWindow.to.toISOString();

    try {
      // Create run record in Supabase (if DB enabled)
      if (isDbEnabled && supabase) {
        const { data, error } = await supabase
          .from('runs')
          .insert({
            mode: request.source === 'schedule' ? 'scheduled' : 'manual',
            name: request.source === 'schedule' ? 'Scheduled Reddit Scan' : 'Manual Reddit Scan',
            time_window: request.window,
            start_at: startAt,
            end_at: endAt,
            status: 'running',
            platform_stats: { reddit: 0 },
          })
          .select()
          .single();

        if (error) {
          console.error('[RedditDiscoveryRunner] Failed to create run record:', error.message);
        } else {
          runId = data.id;
          console.log(`[RedditDiscoveryRunner] Created run: ${runId}`);
        }
      }

      // Run the scraper
      const scraper = new RedditScraperLocal();
      
      const posts = await scraper.fetchPosts({
        keywords: request.keywords,
        timeWindow,
        limit: 50,
      });

      console.log(`[RedditDiscoveryRunner] Scraped ${posts.length} posts`);

      // Insert posts into normalized_items (if DB enabled)
      if (isDbEnabled && supabase && runId && posts.length > 0) {
        await this.insertPosts(runId, posts);
        console.log(`[RedditDiscoveryRunner] Inserted ${posts.length} posts into normalized_items`);
      }

      // Update run record on completion
      if (isDbEnabled && supabase && runId) {
        await supabase
          .from('runs')
          .update({
            status: 'completed',
            total_results: posts.length,
            platform_stats: { reddit: posts.length },
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId);
        console.log(`[RedditDiscoveryRunner] Updated run ${runId} to completed`);
      }

      console.log(`[RedditDiscoveryRunner] Discovery completed successfully`);
      console.log(`[RedditDiscoveryRunner] Duration: ${Date.now() - startTime}ms`);

      return {
        runId,
        status: 'completed',
        postsFound: posts.length,
      };

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      console.error(`[RedditDiscoveryRunner] Discovery failed:`, error.message);

      // Update run record on failure
      if (isDbEnabled && supabase && runId) {
        await supabase
          .from('runs')
          .update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId);
      }

      return {
        runId,
        status: 'failed',
        postsFound: 0,
        error: error.message,
      };
    }
  }

  /**
   * Insert scraped posts into normalized_items table
   */
  private async insertPosts(runId: string, posts: NormalizedPost[]): Promise<void> {
    if (!supabase || posts.length === 0) return;

    const items = posts.map((post) => ({
      run_id: runId,
      platform: 'reddit',
      subreddit: post.raw?.subreddit || post.sourceContext.replace('r/', ''),
      title: post.title,
      content: post.content.substring(0, 10000),
      url: post.url,
      author: post.author || null,
      created_at: post.createdAt.toISOString(),
      keywords_matched: post.keywordsMatched,
      score: post.raw?.score as number | undefined,
      num_comments: post.raw?.numComments as number | undefined,
    }));

    const { error } = await supabase
      .from('normalized_items')
      .insert(items);

    if (error) {
      console.error('[RedditDiscoveryRunner] Failed to insert posts:', error.message);
    }
  }

  /**
   * Parse window string to number of days
   * Supports: "24h" -> 1, "7d" -> 7, "1w" -> 7, "30d" -> 30
   */
  private parseWindow(window: string): number {
    const match = window.match(/^(\d+)([hdw])$/);
    if (!match) {
      console.warn(`[RedditDiscoveryRunner] Invalid window format: ${window}, defaulting to 7 days`);
      return 7;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'h':
        return Math.ceil(value / 24);
      case 'd':
        return value;
      case 'w':
        return value * 7;
      default:
        return 7;
    }
  }
}
