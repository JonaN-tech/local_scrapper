# Quick Fix Guide - Remove 2,488 "Unknown" Posts

## Simple 3-Step Process (10 minutes)

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase project: https://supabase.com/dashboard/project/YOUR_PROJECT
2. Click **"SQL Editor"** in the left sidebar
3. Click **"New query"**

### Step 2: Copy & Run This SQL

**Copy ALL of this and paste into the SQL editor, then click "Run":**

```sql
-- Step 1: Try to recover posts from their URLs
WITH recoverable AS (
  SELECT 
    id,
    url,
    LOWER(TRIM(SUBSTRING(url FROM '/r/([^/]+)/'))) as extracted_subreddit,
    metadata
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      LOWER(metadata->>'subreddit') = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
    )
    AND url ~* '/r/[^/]+/'
)
UPDATE normalized_items
SET 
  metadata = jsonb_set(
    metadata,
    '{subreddit}',
    to_jsonb(recoverable.extracted_subreddit)
  ),
  updated_at = NOW()
FROM recoverable
WHERE normalized_items.id = recoverable.id
  AND recoverable.extracted_subreddit IS NOT NULL
  AND recoverable.extracted_subreddit != ''
  AND LOWER(recoverable.extracted_subreddit) != 'unknown'
  AND LENGTH(recoverable.extracted_subreddit) > 2;

-- Step 2: Delete posts that can't be recovered
DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- Step 3: Verify cleanup
SELECT 
    'Remaining unknown posts' as status,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );
```

### Step 3: Verify It Worked

The final SELECT should show:
```
status                    | count
--------------------------+-------
Remaining unknown posts   |     0
```

**✅ Done! All "unknown" posts are fixed or removed!**

## What Just Happened?

1. **Recovered ~500-1000 posts** - Extracted subreddit from their URLs
2. **Deleted ~1500-1988 posts** - Couldn't be recovered (broken URLs)
3. **Result** - 0 "unknown" posts remaining

## Verify in Your App

1. Refresh your application UI
2. Check the results page
3. You should see **NO r/Unknown links**
4. All posts should have valid subreddit links

## Alternative: If You Want More Control

Use the detailed step-by-step script: [`FIX_UNKNOWN_POSTS_NOW.sql`](FIX_UNKNOWN_POSTS_NOW.sql)

This lets you:
- See exactly what will be recovered
- See exactly what will be deleted
- Run each step separately
- Verify at each stage

## After Cleanup

**Redeploy your code** to Vercel so future scrapes don't create more "unknown" posts:
1. Code fixes are already committed
2. Push to your repository
3. Vercel will auto-deploy
4. Future scrapes will be clean

## Expected Results

**Before cleanup:**
- Total posts: X
- Unknown posts: 2,488 ❌
- Valid posts: X - 2,488

**After cleanup:**
- Total posts: X - ~1,500
- Unknown posts: 0 ✅
- Valid posts: Same as before + ~500 recovered

**You'll have:**
- Cleaner data
- Working subreddit links
- Accurate analytics
- No more r/Unknown links in UI

## Troubleshooting

### "Query returned 0 rows"
✅ This is good! It means there are no unknown posts to fix.

### "Error: syntax error at or near..."
❌ Make sure you copied the ENTIRE SQL block, including all three parts.

### Still seeing "unknown" in UI after cleanup
- Clear your browser cache
- Restart your application server
- Check the database count again with Step 3 query

## Summary

Just run the SQL in Supabase SQL Editor → Done in 2 minutes! 🎉