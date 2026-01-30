-- ================================================================
-- CLEANUP SCRIPT FOR r/Unknown POSTS
-- ================================================================
-- This script identifies and removes posts with invalid subreddit data
-- Run this AFTER deploying the code fixes to clean up existing bad data
-- ================================================================

-- STEP 1: Inspect the damage (READ-ONLY)
-- ================================================================
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

-- Show sample of problematic posts
SELECT 
    id,
    title,
    url,
    author,
    metadata->>'subreddit' as subreddit,
    created_at
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  )
ORDER BY created_at DESC
LIMIT 10;

-- STEP 2: Attempt to fix posts by extracting from URL
-- ================================================================
-- Some posts might have valid subreddit in their URL
-- This tries to extract and update them

WITH extracted_subreddits AS (
  SELECT 
    id,
    url,
    -- Extract subreddit from URL pattern: /r/{subreddit}/
    LOWER(
      SUBSTRING(url FROM '/r/([^/]+)/')
    ) as extracted_subreddit,
    metadata
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      metadata->>'subreddit' = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
      OR LOWER(metadata->>'subreddit') = 'unknown'
    )
    AND url LIKE '%/r/%'
)
SELECT 
    'Posts that CAN be recovered from URL' as description,
    COUNT(*) as count
FROM extracted_subreddits
WHERE extracted_subreddit IS NOT NULL
  AND extracted_subreddit != ''
  AND extracted_subreddit != 'unknown';

-- STEP 3: Actually fix recoverable posts (WRITE OPERATION)
-- ================================================================
-- ⚠️ UNCOMMENT TO EXECUTE - This updates the database
-- ================================================================

/*
WITH extracted_subreddits AS (
  SELECT 
    id,
    url,
    LOWER(SUBSTRING(url FROM '/r/([^/]+)/')) as extracted_subreddit,
    metadata
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      metadata->>'subreddit' = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
      OR LOWER(metadata->>'subreddit') = 'unknown'
    )
    AND url LIKE '%/r/%'
)
UPDATE normalized_items
SET metadata = jsonb_set(
    metadata,
    '{subreddit}',
    to_jsonb(extracted_subreddits.extracted_subreddit)
  ),
  updated_at = NOW()
FROM extracted_subreddits
WHERE normalized_items.id = extracted_subreddits.id
  AND extracted_subreddits.extracted_subreddit IS NOT NULL
  AND extracted_subreddits.extracted_subreddit != ''
  AND extracted_subreddits.extracted_subreddit != 'unknown';
*/

-- STEP 4: Delete posts that cannot be recovered
-- ================================================================
-- ⚠️ UNCOMMENT TO EXECUTE - This DELETES data permanently
-- ================================================================

/*
DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );
*/

-- STEP 5: Verify cleanup (READ-ONLY)
-- ================================================================
-- Run this after cleanup to verify

SELECT 
    'Remaining posts with unknown/invalid subreddit' as description,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );

-- Show distribution of subreddits after cleanup
SELECT 
    metadata->>'subreddit' as subreddit,
    COUNT(*) as post_count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
GROUP BY metadata->>'subreddit'
ORDER BY post_count DESC
LIMIT 20;