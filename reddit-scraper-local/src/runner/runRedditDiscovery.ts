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
    console.log(`[RedditDiscoveryRunner] Subreddits: ${request.subreddits.join(', ') || 'empty'}`);
    console.log(`[RedditDiscoveryRunner] Window: ${request.window}`);
    console.log(`[RedditDiscoveryRunner] DB enabled: ${isDbEnabled}`);

    // Parse window string to days
    const days = this.parseWindow(request.window);
    const timeWindow = TimeWindow.createTimeWindow(days);

    try {
      // Create run record in Supabase (if DB enabled)
      if (isDbEnabled && supabase) {
        // Try with platforms_status first (new schema)
        let runPayload: any = {
          name: request.source === 'schedule'
            ? 'Daily KiloCode Discovery (Local Scrapper)'
            : 'Manual Reddit Discovery',
          mode: request.source === 'schedule' ? 'scheduled' : 'manual',
          status: 'running',
          start_at: timeWindow.from.toISOString(),
          end_at: timeWindow.to.toISOString(),
          time_window_type: request.window,
          platforms_status: { reddit: 'running' },
          subreddits: request.subreddits || [],
          total_results_count: 0,
        };

        console.log(`[RedditDiscoveryRunner] Creating run record (with platforms_status)...`);
        let { data: run, error } = await supabase
          .from('runs')
          .insert(runPayload)
          .select()
          .single();

        // If platforms_status column doesn't exist, retry without it (backward compatibility)
        if (error && error.message?.includes('platforms_status')) {
          console.warn(`[RedditDiscoveryRunner] platforms_status column not found, retrying without it...`);
          
          // Remove platforms_status and retry
          const { platforms_status, ...payloadWithoutPlatforms } = runPayload;
          runPayload = payloadWithoutPlatforms;
          
          const retry = await supabase
            .from('runs')
            .insert(runPayload)
            .select()
            .single();
          
          run = retry.data;
          error = retry.error;
        }

        if (error) {
          console.error(`[RedditDiscoveryRunner] Run insert failed:`, error.message);
          console.error(`[RedditDiscoveryRunner] Error details:`, JSON.stringify(error));
        } else {
          runId = run.id;
          console.log(`[RedditDiscoveryRunner] ✅ Run created: ${runId}`);
        }
      } else {
        console.log(`[RedditDiscoveryRunner] DB disabled, running in mock mode`);
      }

      // If runId is null, we cannot proceed with item insertion
      if (!runId && isDbEnabled) {
        console.warn(`[RedditDiscoveryRunner] No runId obtained, skipping item insertion`);
      }

      // Run the scraper (works regardless of DB status)
      const scraper = new RedditScraperLocal();
      
      console.log(`[RedditDiscoveryRunner] Starting Reddit scrape...`);
      const posts = await scraper.fetchPosts({
        keywords: request.keywords,
        timeWindow,
        limit: 50,
      });

      console.log(`[RedditDiscoveryRunner] Scraped ${posts.length} posts`);

      // Insert posts into normalized_items (only if we have a valid runId)
      if (isDbEnabled && supabase && runId && posts.length > 0) {
        console.log(`[RedditDiscoveryRunner] Inserting ${posts.length} posts into normalized_items...`);
        const insertedCount = await this.insertPosts(runId, posts);
        console.log(`[RedditDiscoveryRunner] Inserted ${insertedCount} items into normalized_items`);
      } else if (!runId && isDbEnabled) {
        console.log(`[RedditDiscoveryRunner] Skipping post insertion (no runId)`);
      }

      // Update run record on completion
      if (isDbEnabled && supabase && runId) {
        console.log(`[RedditDiscoveryRunner] Updating run to completed...`);
        
        // Try with platforms_status first
        let updatePayload: any = {
          status: 'completed',
          total_results_count: posts.length,
          platforms_status: { reddit: 'completed' },
          updated_at: new Date().toISOString(),
        };
        
        let { error: updateError } = await supabase
          .from('runs')
          .update(updatePayload)
          .eq('id', runId);

        // If platforms_status doesn't exist, retry without it
        if (updateError && updateError.message?.includes('platforms_status')) {
          console.warn(`[RedditDiscoveryRunner] Retrying update without platforms_status...`);
          const { platforms_status, ...payloadWithoutPlatforms } = updatePayload;
          const retry = await supabase
            .from('runs')
            .update(payloadWithoutPlatforms)
            .eq('id', runId);
          updateError = retry.error;
        }

        if (updateError) {
          console.error(`[RedditDiscoveryRunner] Run update failed:`, updateError.message);
        } else {
          console.log(`[RedditDiscoveryRunner] ✅ Run completed`);
        }
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
      console.error(`[RedditDiscoveryRunner] Stack:`, error.stack);

      // Update run record on failure
      if (isDbEnabled && supabase && runId) {
        console.log(`[RedditDiscoveryRunner] Updating run to failed...`);
        
        // Try with platforms_status first
        let updatePayload: any = {
          status: 'failed',
          error_message: error.message,
          platforms_status: { reddit: 'failed' },
          updated_at: new Date().toISOString(),
        };
        
        let { error: updateError } = await supabase
          .from('runs')
          .update(updatePayload)
          .eq('id', runId);

        // If platforms_status doesn't exist, retry without it
        if (updateError && updateError.message?.includes('platforms_status')) {
          console.warn(`[RedditDiscoveryRunner] Retrying update without platforms_status...`);
          const { platforms_status, ...payloadWithoutPlatforms } = updatePayload;
          const retry = await supabase
            .from('runs')
            .update(payloadWithoutPlatforms)
            .eq('id', runId);
          updateError = retry.error;
        }

        if (updateError) {
          console.error(`[RedditDiscoveryRunner] Failed to update run status:`, updateError.message);
        }
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
  private async insertPosts(runId: string, posts: NormalizedPost[]): Promise<number> {
    if (!supabase || posts.length === 0) return 0;

    console.log(`[RedditDiscoveryRunner] Inserting ${posts.length} items...`);
    
    // Strategy 1: Try with all fields (full schema)
    let items: any[] = posts.map((post) => ({
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

    let { data, error } = await supabase
      .from('normalized_items')
      .insert(items)
      .select('id');

    // Strategy 2: If any column not found, try without optional metadata columns
    if (error && error.code === 'PGRST204') {
      console.warn(`[RedditDiscoveryRunner] Column not found (${error.message}), retrying with minimal schema...`);
      
      items = posts.map((post) => ({
        run_id: runId,
        platform: 'reddit',
        subreddit: post.raw?.subreddit || post.sourceContext.replace('r/', ''),
        title: post.title,
        content: post.content.substring(0, 10000),
        url: post.url,
        author: post.author || null,
        created_at: post.createdAt.toISOString(),
      }));
      
      const retry = await supabase
        .from('normalized_items')
        .insert(items)
        .select('id');
      
      data = retry.data;
      error = retry.error;
    }

    // Strategy 3: If still failing, try with absolute minimum fields only
    if (error && error.code === 'PGRST204') {
      console.warn(`[RedditDiscoveryRunner] Still failing, trying with minimal required fields only...`);
      
      items = posts.map((post) => ({
        run_id: runId,
        platform: 'reddit',
        title: post.title,
        url: post.url,
        created_at: post.createdAt.toISOString(),
      }));
      
      const retry = await supabase
        .from('normalized_items')
        .insert(items)
        .select('id');
      
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error(`[RedditDiscoveryRunner] Failed to insert posts after all retries:`, error.message);
      console.error(`[RedditDiscoveryRunner] Error details:`, JSON.stringify(error));
      console.error(`[RedditDiscoveryRunner] Your schema may be incompatible. Required columns: run_id, platform, title, url, created_at`);
      return 0;
    }

    const insertedCount = data?.length || 0;
    console.log(`[RedditDiscoveryRunner] ✅ Successfully inserted ${insertedCount} items`);
    return insertedCount;
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
