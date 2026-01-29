# Reddit r/Unknown Bug - Fix Documentation

## Issue Summary
Posts were being stored with `subreddit: "unknown"` and `author: "unknown"`, causing invalid UI links to `https://reddit.com/r/Unknown/`.

## Root Cause
1. Scraper didn't extract subreddit from Reddit API response - it relied on the passed parameter
2. No validation before database insertion
3. No fallback handling for missing data
4. UI blindly trusted data without validation

## Fixes Applied

### 1. ✅ Canonical Subreddit Extraction Logic
**File**: [`reddit-scraper-local/src/scraper/RedditScraperLocal.ts`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:240)

Added [`extractSubreddit()`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:240) method that:
- First tries `post.subreddit` field (direct from Reddit API)
- Falls back to parsing from `post.permalink` (format: `/r/{subreddit}/comments/{id}/`)
- Returns `null` if subreddit cannot be determined
- Normalizes subreddit name: lowercase, removes `r/` prefix, trims whitespace

### 2. ✅ Skip Posts Without Valid Subreddit
**File**: [`reddit-scraper-local/src/scraper/RedditScraperLocal.ts`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:172)

Modified [`fetchSubredditNew()`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:125):
- Calls [`extractSubreddit()`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:240) for every post
- If `null` is returned, skips the post completely
- Logs skipped posts with debug information
- Never stores posts with missing/invalid subreddit

### 3. ✅ Author Extraction with "[deleted]" Convention
**File**: [`reddit-scraper-local/src/scraper/RedditScraperLocal.ts`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:268)

Added [`extractAuthor()`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:268) method that:
- Returns `"[deleted]"` for deleted/missing authors (Reddit convention)
- Never returns `undefined` or `"unknown"`

### 4. ✅ Debug Logging for Failures
**File**: [`reddit-scraper-local/src/scraper/RedditScraperLocal.ts`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts:172)

Added structured logging:
```
[RedditScraperLocal] Skipped post {id}: subreddit could not be resolved
[RedditScraperLocal] Post details - permalink: {permalink}, available fields: {keys}
```

### 5. ✅ Validation Before DB Insert
**File**: [`reddit-scraper-local/src/runner/runRedditDiscovery.ts`](reddit-scraper-local/src/runner/runRedditDiscovery.ts:280)

Modified [`insertPosts()`](reddit-scraper-local/src/runner/runRedditDiscovery.ts:270) method:
- Validates `subredditRaw` is not null/empty/invalid before insert
- Verifies URL contains `/r/{subreddit}/` to prevent mismatches
- Converts `author: "unknown"` to `"[deleted]"`
- Skips invalid posts and logs details
- Tracks skipped count in summary

### 6. ✅ UI Safety Guard
**File**: [`reddit-scraper-local/src/client/App.tsx`](reddit-scraper-local/src/client/App.tsx:27)

Added [`getSubredditName()`](reddit-scraper-local/src/client/App.tsx:27) and [`SubredditLink`](reddit-scraper-local/src/client/App.tsx:47) component:
- Safely extracts subreddit from post data
- Returns `null` if subreddit is missing/invalid/"unknown"
- Displays "Unknown source (skipped)" instead of broken link
- Prevents clicking through to invalid URLs

## Testing Checklist

### Manual Testing Steps

1. **Start the development server**
   ```bash
   cd reddit-scraper-local
   npm run dev
   ```

2. **Test with valid subreddits**
   - Use endpoint: `POST http://localhost:3001/api/scrape/reddit`
   - Body:
     ```json
     {
       "subreddits": ["cursor", "ClaudeAI"],
       "keywords": ["bug", "issue"],
       "days": 7
     }
     ```
   - ✅ Verify all posts have valid subreddit names
   - ✅ Verify no "unknown" values
   - ✅ Check logs for extraction messages

3. **Test extraction logging**
   - Monitor console output during scraping
   - Look for:
     - `[RedditScraperLocal] r/{subreddit}: X posts matched keywords`
     - `[RedditScraperLocal] Skipped post {id}: subreddit could not be resolved` (if any)

4. **Test database insertion**
   - Use endpoint: `POST http://localhost:3001/run/reddit`
   - Body:
     ```json
     {
       "keywords": ["ai", "claude"],
       "subreddits": ["cursor", "ClaudeAI"],
       "window": "7d"
     }
     ```
   - ✅ Check `normalized_items` table
   - ✅ Verify no records with invalid subreddit
   - ✅ Verify `metadata.subreddit` is always lowercase, no "unknown"

5. **Test UI rendering**
   - Open frontend: `http://localhost:5173` (or configured port)
   - Run scraper with test keywords
   - ✅ Verify subreddit links work correctly
   - ✅ Verify no broken r/Unknown links appear
   - ✅ Verify "[deleted]" appears for deleted authors, not "unknown"

### Expected Behavior After Fix

✅ **No r/Unknown links in UI**
✅ **All posts map to real subreddits**
✅ **Invalid posts are skipped with logging**
✅ **Analytics and charts become accurate**
✅ **Scraper appears deterministic and trustworthy**

### Database Cleanup (If Needed)

If old data with "unknown" exists, clean it up:

```sql
-- Check for invalid subreddit data
SELECT id, url, metadata->>'subreddit' as subreddit
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- Delete invalid records (OPTIONAL - only if needed)
DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );
```

## Code Changes Summary

| File | Lines Changed | Purpose |
|------|---------------|---------|
| [`RedditScraperLocal.ts`](reddit-scraper-local/src/scraper/RedditScraperLocal.ts) | +70 | Canonical extraction, validation, logging |
| [`runRedditDiscovery.ts`](reddit-scraper-local/src/runner/runRedditDiscovery.ts) | +30 | DB insertion validation |
| [`App.tsx`](reddit-scraper-local/src/client/App.tsx) | +60 | UI safety guards |

## Key Principles Applied

1. **Never trust external data** - Always validate
2. **Fail fast** - Skip invalid posts immediately
3. **Log everything** - Debug info for troubleshooting
4. **Use conventions** - "[deleted]" follows Reddit's standard
5. **Defense in depth** - Multiple validation layers (scraper → DB → UI)

## Breaking Changes

None. This is a bug fix that improves data quality without changing interfaces.

## Migration Notes

Existing data with "unknown" values will remain in the database but:
- Future scrapes will not create new "unknown" records
- UI will handle legacy data gracefully
- Consider running cleanup SQL if data quality is critical

## Monitoring

Watch for these log patterns post-deployment:

✅ **Good signs:**
```
[RedditScraperLocal] r/cursor: 15 posts matched keywords
[RedditDiscoveryRunner] ✅ Successfully inserted 15/15 items
```

⚠️ **Warning signs:**
```
[RedditScraperLocal] Skipped post abc123: subreddit could not be resolved
[RedditDiscoveryRunner] ⚠️ Skipped 3 items (invalid subreddit or URL mismatch)
```

If you see many skipped posts, investigate:
1. Reddit API response format changes
2. Network/rate limiting issues
3. Data quality from source