import express from 'express';
import cors from 'cors';
import { RedditScraperLocal } from '../scraper/RedditScraperLocal';
import { RedditDiscoveryRunner, RedditDiscoveryRequest } from '../runner/runRedditDiscovery';
import { TimeWindow } from '../utils/timeWindow';

const app = express();
const PORT = process.env['PORT'] || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.path}`);
  next();
});

// POST /api/scrape/reddit
app.post('/api/scrape/reddit', async (req, res) => {
  console.log('[Server] /api/scrape/reddit called');
  console.log('[Server] Request body:', JSON.stringify(req.body, null, 2));

  const { keywords, days = 7, limit = 50 } = req.body;

  // Validate keywords
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    console.error('[Server] Error: keywords is required and must be an array');
    return res.status(400).json({ error: 'keywords is required and must be an array' });
  }

  // Validate days
  if (typeof days !== 'number' || days < 1 || days > 365) {
    console.error('[Server] Error: days must be a number between 1 and 365');
    return res.status(400).json({ error: 'days must be a number between 1 and 365' });
  }

  try {
    // Build time window
    const timeWindow = TimeWindow.createTimeWindow(days);
    console.log(`[Server] Time window: from ${timeWindow.from.toISOString()} to ${timeWindow.to.toISOString()}`);

    // Instantiate scraper
    console.log('[Server] Instantiating RedditScraperLocal...');
    const scraper = new RedditScraperLocal();

    // Run scraper
    console.log('[Server] Starting fetchPosts...');
    const posts = await scraper.fetchPosts({
      keywords,
      timeWindow,
      limit,
    });

    console.log(`[Server] fetchPosts completed. Found ${posts.length} posts`);

    // Return raw posts as JSON
    return res.json({
      success: true,
      count: posts.length,
      posts,
    });
  } catch (error) {
    console.error('[Server] Error during scraping:', error);
    console.error('[Server] Stack:', error instanceof Error ? error.stack : 'Unknown error');
    return res.status(500).json({ 
      error: 'Scraping failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Initialize the discovery runner
const redditRunner = new RedditDiscoveryRunner();

// POST /run/reddit - Main endpoint for triggering Reddit scraping with Supabase persistence
app.post('/run/reddit', async (req, res) => {
  console.log('[Server] /run/reddit called');
  console.log('[Server] Request body:', JSON.stringify(req.body, null, 2));

  const { source = 'manual', scheduleId, keywords, subreddits = [], window = '7d' } = req.body as RedditDiscoveryRequest;

  // Validate keywords
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    console.error('[Server] Error: keywords is required and must be an array');
    return res.status(400).json({ error: 'keywords is required and must be an array' });
  }

  // Validate subreddits (optional, but if provided must be an array)
  if (subreddits && !Array.isArray(subreddits)) {
    console.error('[Server] Error: subreddits must be an array');
    return res.status(400).json({ error: 'subreddits must be an array' });
  }

  // Validate source
  if (source !== 'manual' && source !== 'schedule') {
    console.error('[Server] Error: source must be "manual" or "schedule"');
    return res.status(400).json({ error: 'source must be "manual" or "schedule"' });
  }

  try {
    const request: RedditDiscoveryRequest = {
      source,
      scheduleId,
      keywords,
      subreddits,
      window,
    };

    console.log(`[Server] Starting Reddit discovery run`);
    console.log(`[Server] Source: ${source}, ScheduleId: ${scheduleId || 'N/A'}`);
    console.log(`[Server] Keywords: ${keywords.join(', ')}`);
    console.log(`[Server] Subreddits: ${subreddits.join(', ') || 'all allowed'}`);
    console.log(`[Server] Window: ${window}`);

    const result = await redditRunner.run(request);

    console.log(`[Server] Run completed - RunId: ${result.runId}, Posts: ${result.postsFound}, Status: ${result.status}`);

    return res.json({
      runId: result.runId,
      status: result.status,
      postsFound: result.postsFound,
      error: result.error,
    });
  } catch (error) {
    console.error('[Server] Error during Reddit discovery run:', error);
    console.error('[Server] Stack:', error instanceof Error ? error.stack : 'Unknown error');
    return res.status(500).json({
      error: 'Discovery run failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/run - Simple endpoint for local keyword testing
app.post('/api/run', async (req, res) => {
  console.log('[Server] /api/run called');
  
  const { subreddits, keywords, days = 7 } = req.body;
  
  // Validate keywords
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'keywords is required and must be an array' });
  }
  
  try {
    const timeWindow = TimeWindow.createTimeWindow(days);
    const scraper = new RedditScraperLocal();
    
    console.log(`[Server] Running with keywords: ${keywords.join(', ')}`);
    
    const posts = await scraper.fetchPosts({
      keywords,
      timeWindow,
      limit: 50,
    });
    
    // Group by subreddit for summary
    const bySubreddit = new Map<string, number>();
    for (const post of posts) {
      const sr = post.sourceContext;
      bySubreddit.set(sr, (bySubreddit.get(sr) || 0) + 1);
    }
    
    return res.json({
      success: true,
      totalPosts: posts.length,
      bySubreddit: Object.fromEntries(bySubreddit),
      posts: posts.slice(0, 20), // Return first 20 posts
    });
  } catch (error) {
    console.error('[Server] Error:', error);
    return res.status(500).json({ error: 'Failed to run scraper' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Reddit Scraper Service running on http://localhost:${PORT}`);
  console.log(`[Server] POST /run/reddit - Main discovery endpoint`);
  console.log(`[Server] POST /api/scrape/reddit`);
  console.log(`[Server] POST /api/run`);
  console.log(`[Server] GET /api/health`);
});
