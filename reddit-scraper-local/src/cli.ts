/**
 * CLI Script for Local Reddit Keyword Testing
 * Usage: npx tsx src/cli.ts --keywords="ai tools, cursor, claude"
 * Usage: npm run scrape -- --keywords="ai tools, cursor, claude"
 */

import { RedditScraperLocal } from './scraper/RedditScraperLocal';
import { TimeWindow } from './utils/timeWindow';

// Parse command line arguments
const args = process.argv.slice(2);
const keywordArg = args.find(arg => arg.startsWith('--keywords=') || arg.startsWith('-k='));

if (!keywordArg) {
  console.error('Error: --keywords argument is required');
  console.error('Usage: npm run scrape -- --keywords="ai tools, cursor, claude"');
  console.error('Usage: npx tsx src/cli.ts --keywords="ai tools, cursor, claude"');
  process.exit(1);
}

const keywordsRaw = keywordArg
  .split('=')[1]
  .split(',')
  .map(k => k.trim())
  .filter(k => k.length > 0);

if (keywordsRaw.length === 0) {
  console.error('Error: At least one keyword is required');
  process.exit(1);
}

async function main() {
  console.log('='.repeat(60));
  console.log('Reddit Keyword Scraper - Local CLI');
  console.log('='.repeat(60));
  console.log(`Keywords: ${keywordsRaw.join(', ')}`);
  console.log(`Time Window: Last 7 days`);
  console.log('');
  
  const startTime = Date.now();
  
  try {
    const scraper = new RedditScraperLocal();
    
    // Default: last 7 days
    const timeWindow = TimeWindow.createTimeWindow(7);
    
    console.log(`Time window: ${timeWindow.from.toISOString()} to ${timeWindow.to.toISOString()}`);
    console.log('');
    
    const posts = await scraper.fetchPosts({
      keywords: keywordsRaw,
      timeWindow,
      limit: 50,
    });
    
    const duration = Date.now() - startTime;
    
    console.log('');
    console.log('='.repeat(60));
    console.log('Results');
    console.log('='.repeat(60));
    console.log(`Total posts found: ${posts.length}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('');
    
    // Group posts by subreddit
    const bySubreddit = new Map<string, typeof posts>();
    for (const post of posts) {
      const subreddit = post.sourceContext;
      if (!bySubreddit.has(subreddit)) {
        bySubreddit.set(subreddit, []);
      }
      bySubreddit.get(subreddit)!.push(post);
    }
    
    console.log('Posts by subreddit:');
    for (const [subreddit, subredditPosts] of bySubreddit) {
      console.log(`  ${subreddit}: ${subredditPosts.length} posts`);
    }
    
    console.log('');
    console.log('Sample posts (first 5):');
    for (const post of posts.slice(0, 5)) {
      console.log(`  [${post.sourceContext}] ${post.title.substring(0, 60)}...`);
      console.log(`    ${post.url}`);
    }
    
    console.log('');
    console.log('Done!');
    
  } catch (error) {
    console.error('Error during scraping:', error);
    process.exit(1);
  }
}

main();
