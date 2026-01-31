# Troubleshooting Guide - "Unknown" Posts Still Appearing

## Problem: Still Seeing "Unknown" Posts After Fix

You're experiencing two issues:
1. ❌ Still seeing "unknown" posts with empty content
2. ❌ Getting fewer good results than before

## Root Causes

### Issue 1: Old Data Still in Database
The code fixes prevent **NEW** bad data, but **OLD** records from before the fix remain in the database.

### Issue 2: Code Not Deployed Yet
If you haven't restarted the server, it's still running the old code.

### Issue 3: Validation May Be Too Strict
Our new validation might be rejecting valid posts incorrectly.

## ✅ SOLUTION STEPS

### Step 1: Restart the Server (REQUIRED)
The new code won't run until you restart:

```bash
# Stop any running servers
# Press Ctrl+C in the terminal running the server

# Start fresh
cd reddit-scraper-local
npm run dev
```

**Verify the new code is running:**
Look for these logs when scraping:
```
[RedditScraperLocal] r/cursor: X posts matched keywords
[RedditScraperLocal] Skipped X posts (subreddit unresolvable)  # New log
```

### Step 2: Test with Fresh Data
Run a NEW scrape to verify the fixes work:

```bash
# Test API endpoint
curl -X POST http://localhost:3001/api/scrape/reddit \
  -H "Content-Type: application/json" \
  -d '{
    "subreddits": ["cursor", "ClaudeAI"],
    "keywords": ["bug", "issue", "help"],
    "days": 1
  }'
```

**Expected behavior:**
- No new posts with `subreddit: "unknown"`
- All posts have valid subreddit extracted from Reddit API
- Some posts may be skipped (logged)

### Step 3: Clean Old Data from Database

Use the provided SQL script: [`CLEANUP_UNKNOWN_POSTS.sql`](CLEANUP_UNKNOWN_POSTS.sql)

```sql
-- Run in your database client (Supabase, pgAdmin, etc.)

-- 1. FIRST: Inspect the damage (safe, read-only)
SELECT 
    'Total posts with unknown/invalid subreddit' as description,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );

-- 2. Try to recover posts from their URLs
-- (Uncomment and run the UPDATE statement in CLEANUP_UNKNOWN_POSTS.sql)

-- 3. Delete unrecoverable posts
-- (Uncomment and run the DELETE statement in CLEANUP_UNKNOWN_POSTS.sql)
```

### Step 4: Investigate "Fewer Results" Issue

If you're getting fewer results, check the logs:

```bash
# Start the server with logs visible
npm run dev

# Watch for these patterns:
[RedditScraperLocal] r/cursor: 15 posts matched keywords  ✅ Good
[RedditScraperLocal] Skipped post abc123: subreddit could not be resolved  ⚠️ Investigation needed
```


**If you see many "Skipped" messages:**

This means Reddit's API response is missing data. Let's add debug logging to see the raw response.

## Debug Mode - See What's Being Rejected

Add this temporary logging to see what's happening:

**File:** `reddit-scraper-local/src/scraper/RedditScraperLocal.ts`

Find the `fetchSubredditNew` method and add more logging:

```typescript
for (const child of response.data.data.children) {
  const post = child.data;
  
  // ADD THIS DEBUG LOG
  console.log(`[DEBUG] Post ${post.id}:`, {
    hasSubreddit: !!post.subreddit,
    subreddit: post.subreddit,
    permalink: post.permalink,
    title: post.title?.substring(0, 50)
  });
  
  // ... rest of code
}
```

This will show you:
- Which posts have `post.subreddit` field
- Which posts are being rejected
- What data Reddit is actually sending

## Common Scenarios

### Scenario A: Empty Content Posts
**Symptom:** Posts with empty content appearing as "unknown"

**Cause:** These are link posts (not text posts)
- `post.selftext` is empty (intentionally)
- But they should still have valid subreddit

**Solution:** Our fix handles this - empty content is OK, but subreddit must be valid

### Scenario B: Crossposted Content
**Symptom:** Posts appearing with wrong subreddit

**Cause:** Reddit crossposts can be tricky
- Original post from subreddit A
- Crossposted to subreddit B
- Which one do we store?

**Our approach:** We extract from the API response's `post.subreddit` field, which gives us where we fetched it from (correct behavior)

### Scenario C: Rate Limiting
**Symptom:** Suddenly fewer results

**Cause:** Reddit blocking/rate limiting
- Not related to our fix
- Check the logs for "rate limited" or "blocked"

**Solution:** 
```
[RedditScraperLocal] No response from r/subreddit - rate limited or blocked
```

Wait and try again later, or adjust rate limiter settings.

## Verification Steps

After applying fixes and cleanup:

### 1. ✅ Check New Data Quality
```sql
-- All posts should have valid subreddits
SELECT 
    metadata->>'subreddit' as subreddit,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND created_at > NOW() - INTERVAL '1 hour'  -- Recent posts
GROUP BY metadata->>'subreddit'
ORDER BY count DESC;

-- Should see NO 'unknown' in results
```

### 2. ✅ Check UI
- Open your frontend app
- Run a new scrape
- Verify no r/Unknown links appear
- Verify subreddit links are clickable and valid

### 3. ✅ Check Logs
```
✅ GOOD LOGS:
[RedditScraperLocal] r/cursor: 15 posts matched keywords
[RedditDiscoveryRunner] ✅ Successfully inserted 15/15 items

⚠️ WARNING LOGS (investigate if many):
[RedditScraperLocal] Skipped post abc123: subreddit could not be resolved
[RedditDiscoveryRunner] ⚠️ Skipped 3 items (invalid subreddit)
```

## If You Still See "Unknown" Posts

### Option 1: Hard Reset
```sql
-- NUCLEAR OPTION: Delete ALL Reddit posts and re-scrape
-- ⚠️ This deletes everything!
DELETE FROM normalized_items WHERE source_platform = 'reddit';
```

Then run a fresh scrape from scratch.

### Option 2: Investigate Specific Post
Pick one "unknown" post and trace it:

```sql
-- Find a specific unknown post
SELECT 
    id,
    source_id,
    title,
    url,
    metadata,
    created_at
FROM normalized_items
WHERE source_platform = 'reddit'
  AND LOWER(metadata->>'subreddit') = 'unknown'
LIMIT 1;
```

Check:
1. When was it created? (Before or after the fix?)
2. What does the URL look like?
3. Can you manually extract subreddit from URL?
4. If it's NEW (after fix), this indicates a code problem

### Option 3: Check If Code Is Actually Running
Add a console log at the very start of fetchSubredditNew:

```typescript
private async fetchSubredditNew(...) {
  console.log('🔍 NEW CODE IS RUNNING - extractSubreddit method available');
  // ... rest of code
}
```

If you DON'T see this log, the old code is still running.

## Contact Points

If issues persist:

1. **Check server restart:** Make sure you restarted after code changes
2. **Check database:** Run cleanup SQL to remove old data  
3. **Check logs:** Look for "Skipped post" messages to understand rejections
4. **Add debug logging:** See what Reddit API is actually returning
5. **Test with small dataset:** Use days: 1 to test quickly

## Quick Checklist

- [ ] Restarted server after code changes
- [ ] Verified new logs appear when scraping
- [ ] Ran SQL cleanup for old data
- [ ] Tested with fresh scrape (days: 1)
- [ ] Checked that fewer results aren't due to stricter validation
- [ ] Reviewed logs for "Skipped post" warnings
- [ ] Verified UI no longer shows r/Unknown links for NEW posts