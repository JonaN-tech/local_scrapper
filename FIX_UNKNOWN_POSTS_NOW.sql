-- ================================================================
-- FIX EXISTING "UNKNOWN" POSTS - Run in Supabase SQL Editor
-- ================================================================
-- This will fix your 2,488 existing "unknown" posts
-- Copy each section and run one at a time
-- ================================================================

-- ================================================================
-- STEP 1: See what we're dealing with (SAFE - READ ONLY)
-- ================================================================
SELECT 
    COUNT(*) as total_unknown_posts,
    COUNT(CASE WHEN url LIKE '%reddit.com/r/%' THEN 1 END) as can_recover_from_url
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- Should show: 2488 total, and how many can be recovered


-- ================================================================
-- STEP 2: Recover posts from URLs (WRITES DATA)
-- ================================================================
-- This extracts subreddit from URL and updates the metadata
-- Example: https://reddit.com/r/cursor/comments/abc → subreddit: "cursor"

WITH recoverable AS (
  SELECT 
    id,
    url,
    -- Extract subreddit from URL, case-insensitive
    LOWER(TRIM(SUBSTRING(url FROM '/r/([^/]+)/'))) as extracted_subreddit,
    metadata
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      LOWER(metadata->>'subreddit') = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
    )
    AND url ~* '/r/[^/]+/'  -- URL contains /r/something/
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

-- Shows how many rows were updated


-- ================================================================
-- STEP 3: Check how many were recovered (SAFE - READ ONLY)
-- ================================================================
SELECT 
    'Successfully recovered' as status,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND updated_at > NOW() - INTERVAL '5 minutes'
  AND metadata->>'subreddit' != 'unknown'
  AND metadata->>'subreddit' IS NOT NULL;

-- This shows how many posts were just recovered


-- ================================================================
-- STEP 4: Count remaining unknown posts (SAFE - READ ONLY)
-- ================================================================
SELECT 
    COUNT(*) as still_unknown
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- Shows how many "unknown" posts remain


-- ================================================================
-- STEP 5: Delete remaining unknown posts (WRITES DATA - BE CAREFUL)
-- ================================================================
-- These posts cannot be recovered - their URLs don't contain subreddit info
-- or they're completely broken

DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- Shows how many rows were deleted


-- ================================================================
-- STEP 6: Final verification (SAFE - READ ONLY)
-- ================================================================
-- Should return 0
SELECT 
    COUNT(*) as remaining_unknown_posts
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
  );

-- If this shows 0, you're done! ✅


-- ================================================================
-- STEP 7: See your cleaned data distribution (SAFE - READ ONLY)
-- ================================================================
SELECT 
    metadata->>'subreddit' as subreddit,
    COUNT(*) as post_count
FROM normalized_items
WHERE source_platform = 'reddit'
GROUP BY metadata->>'subreddit'
ORDER BY post_count DESC
LIMIT 30;

-- Shows how posts are distributed across subreddits
-- Should see NO 'unknown' in this list