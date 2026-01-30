# ACTION PLAN - Fix "Unknown" Posts Issue

## Current Situation
You're still seeing:
- ❌ Posts with "by unknown" author
- ❌ Posts appearing under r/Unknown
- ❌ Empty content posts
- ❌ Fewer results than before

## Why This Is Happening

1. **Old data in database** - Previous scrapes before the fix
2. **Server not restarted** - New code not running yet
3. **Possibly too strict validation** - Rejecting valid posts

## IMMEDIATE ACTIONS (Do These Now)

### Step 1: Restart Your Server ⚡
```bash
# Stop the current server (Ctrl+C if running)
cd reddit-scraper-local

# Start with the NEW code
npm run dev
```

**Look for this log to confirm new code is running:**
```
[RedditScraperLocal] Initialized - LOCAL DEV ONLY
```

### Step 2: Test with a Small Scrape 🧪
Open a new terminal and test:

```bash
curl -X POST http://localhost:3001/api/scrape/reddit \
  -H "Content-Type: application/json" \
  -d '{
    "subreddits": ["cursor"],
    "keywords": ["bug", "issue"],
    "days": 1
  }'
```

**Watch the server logs carefully.** You should see:
```
[RedditScraperLocal] r/cursor: Processing X posts from API
[RedditScraperLocal] r/cursor: SUMMARY
[RedditScraperLocal]   ✅ Matched & extracted: X posts
```

**If you see:**
```
⚠️ Skipped (NO SUBREDDIT): X ⚠️
```
This means Reddit's API is not returning `post.subreddit` field. We'll investigate.

### Step 3: Check What You Got 📊
Look at the response from the curl command:

```json
{
  "success": true,
  "count": 15,
  "posts": [
    {
      "id": "...",
      "sourceContext": "r/cursor",  // ✅ Should NOT be "r/unknown"
      "raw": {
        "subreddit": "cursor"  // ✅ Should be present
      }
    }
  ]
}
```

**If you still see "unknown" in NEW posts**, continue to Step 4.

### Step 4: Enable Deep Debug Mode 🔍
Add this to the **top** of `fetchSubredditNew` method to see raw Reddit data:

```typescript
// reddit-scraper-local/src/scraper/RedditScraperLocal.ts
// Line ~146, right after checking response.data.data.children

// ADD THIS DEBUG BLOCK
console.log(`[DEBUG] First post sample from Reddit API:`, {
  id: response.data.data.children[0]?.data?.id,
  subreddit: response.data.data.children[0]?.data?.subreddit,
  subreddit_name_prefixed: response.data.data.children[0]?.data?.subreddit_name_prefixed,
  permalink: response.data.data.children[0]?.data?.permalink,
  allFields: Object.keys(response.data.data.children[0]?.data || {})
});
```

Then restart and run another test. This will show what Reddit is actually sending.

### Step 5: Clean Old Database Records 🧹
The "unknown" posts you're seeing are probably OLD data. Let's clean them:

```sql
-- Connect to your Supabase database or use Supabase Dashboard SQL Editor

-- 1. FIRST: See how many bad records exist (READ-ONLY)
SELECT COUNT(*) as bad_records
FROM normalized_items
WHERE source_platform = 'reddit'
  AND LOWER(metadata->>'subreddit') = 'unknown';

-- 2. Delete them (IF YOU WANT)
DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND LOWER(metadata->>'subreddit') = 'unknown';
```

**Or use the full script:** [`CLEANUP_UNKNOWN_POSTS.sql`](CLEANUP_UNKNOWN_POSTS.sql)

## DECISION TREE

### Scenario A: New scrapes work, but old data remains
**Symptoms:**
- Recent posts (today) have valid subreddit
- Older posts (before fix) show "unknown"

**Solution:**
✅ Code is working! Just clean old data with SQL cleanup script.

### Scenario B: New scrapes still produce "unknown"
**Symptoms:**
- Brand new scrape (after restart) still creates "unknown" posts
- Logs show: `⚠️ Skipped (NO SUBREDDIT): X`

**Investigation needed:**
1. Check debug logs from Step 4 - what does Reddit API actually return?
2. Possible Reddit API changed format
3. Check if `post.subreddit` field exists in raw response

**Next steps:**
- Share the debug output (from Step 4)
- We'll adjust extraction logic if needed

### Scenario C: Fewer results than before
**Symptoms:**
- Before: 50 posts returned
- After: 20 posts returned
- No "unknown" posts though

**This could be:**
1. **Stricter validation** - We're now rejecting invalid posts (GOOD)
2. **Keyword matching** - Keywords might not match as many posts
3. **Time window** - Posts outside time window are filtered

**Check logs for:**
```
[RedditScraperLocal]   🔍 Skipped (no keyword match): 25
```

If this number is high, your keywords might be too specific.

## EXPECTED BEHAVIOR AFTER FIX

### ✅ Good Signs
```
[RedditScraperLocal] r/cursor: Processing 50 posts from API
[RedditScraperLocal] r/cursor: SUMMARY
[RedditScraperLocal]   ✅ Matched & extracted: 15 posts
[RedditScraperLocal]   🔍 Skipped (no keyword match): 30
[RedditScraperLocal]   ⏰ Skipped (time window): 5
```

**API Response:**
```json
{
  "posts": [
    {
      "sourceContext": "r/cursor",  // ✅ Valid
      "author": "someuser",  // ✅ Valid or "[deleted]"
      "raw": {
        "subreddit": "cursor"  // ✅ Present
      }
    }
  ]
}
```

### ⚠️ Warning Signs
```
[RedditScraperLocal]   ⚠️ Skipped (NO SUBREDDIT): 15 ⚠️
[RedditScraperLocal]   Post ID: abc123
[RedditScraperLocal]   Has post.subreddit: false
```

If you see this, Reddit API is not returning the subreddit field. This needs investigation.

## VERIFICATION CHECKLIST

After following steps 1-5:

- [ ] Server restarted with new code
- [ ] Ran test scrape (days: 1, one subreddit)
- [ ] Checked server logs for new debug messages
- [ ] Verified NEW posts have valid subreddit (not "unknown")
- [ ] Cleaned old "unknown" records from database (optional)
- [ ] Checked UI - no r/Unknown links for NEW posts

## WHAT TO SHARE IF STILL BROKEN

If you still have issues after following all steps, share:

1. **Server logs from a test scrape** (the debug output)
2. **One example "unknown" post** from API response
3. **Database query result:**
   ```sql
   SELECT id, title, url, metadata, created_at
   FROM normalized_items
   WHERE LOWER(metadata->>'subreddit') = 'unknown'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
4. **Confirm server restart** - did you restart after code changes?

## FILES CREATED

1. [`REDDIT_UNKNOWN_BUG_FIX.md`](REDDIT_UNKNOWN_BUG_FIX.md) - Complete fix documentation
2. [`ROOT_CAUSE_ANALYSIS.md`](ROOT_CAUSE_ANALYSIS.md) - Why the bug existed
3. [`CLEANUP_UNKNOWN_POSTS.sql`](CLEANUP_UNKNOWN_POSTS.sql) - Database cleanup script
4. [`TROUBLESHOOTING_GUIDE.md`](TROUBLESHOOTING_GUIDE.md) - Detailed troubleshooting
5. [`ACTION_PLAN.md`](ACTION_PLAN.md) - This file (what to do now)

## QUICK TEST COMMAND

```bash
# One-liner to test everything
curl -s -X POST http://localhost:3001/api/scrape/reddit \
  -H "Content-Type: application/json" \
  -d '{"subreddits":["cursor"],"keywords":["bug"],"days":1}' \
  | jq '.posts[0] | {sourceContext, raw_subreddit: .raw.subreddit}'

# Should output:
# {
#   "sourceContext": "r/cursor",
#   "raw_subreddit": "cursor"
# }
```

If you see "unknown" in this output, the new code isn't running yet.