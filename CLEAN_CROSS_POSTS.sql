-- ================================================================
-- Clean Up Cross-Subreddit Posts from Database
-- ================================================================
-- These are posts where the URL doesn't match the stored subreddit
-- They were stored before the permalink validation was added
-- ================================================================

-- Step 1: Identify cross-subreddit posts (READ-ONLY)
-- ================================================================
SELECT 
    id,
    title,
    url,
    author,
    metadata->>'subreddit' as stored_subreddit,
    LOWER(SUBSTRING(url FROM '/r/([^/]+)/')) as url_actual_subreddit,
    CASE 
        WHEN LOWER(url) LIKE '%/r/' || LOWER(metadata->>'subreddit') || '/%' 
        THEN 'MATCH ✅'
        ELSE 'MISMATCH ❌'
    END as validation
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
  AND metadata->>'subreddit' != ''
ORDER BY validation DESC, created_at DESC
LIMIT 20;

-- Step 2: Count mismatches
-- ================================================================
SELECT 
    'Total posts' as category,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'

UNION ALL

SELECT 
    'Cross-subreddit posts (mismatch)' as category,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
  AND metadata->>'subreddit' != ''
  AND LOWER(url) NOT LIKE '%/r/' || LOWER(metadata->>'subreddit') || '/%';

-- Step 3: Delete cross-subreddit posts
-- ================================================================
-- These are posts where URL doesn't match stored subreddit
-- This includes both old "unknown" posts and cross-posts

DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    -- Posts with "unknown" subreddit
    LOWER(metadata->>'subreddit') = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    
    -- OR posts where URL doesn't match stored subreddit (cross-posts)
    OR LOWER(url) NOT LIKE '%/r/' || LOWER(metadata->>'subreddit') || '/%'
  );

-- Step 4: Verify cleanup (should show 0 mismatches)
-- ================================================================
SELECT 
    'Remaining mismatched posts' as status,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
  AND metadata->>'subreddit' != ''
  AND LOWER(url) NOT LIKE '%/r/' || LOWER(metadata->>'subreddit') || '/%';

-- Step 5: Final data quality check
-- ================================================================
-- Should show only posts where URL matches subreddit
SELECT 
    metadata->>'subreddit' as subreddit,
    COUNT(*) as post_count,
    MIN(created_at) as oldest_post,
    MAX(created_at) as newest_post
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
GROUP BY metadata->>'subreddit'
ORDER BY post_count DESC
LIMIT 20;