-- ================================================================
-- IMMEDIATE CLEANUP - Remove 2488 "Unknown" Posts
-- ================================================================
-- Run this in your Supabase SQL Editor
-- ================================================================

-- STEP 1: Verify the count (should show 2488)
-- ================================================================
SELECT 
    'Posts to be deleted' as action,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );

-- STEP 2: See what will be deleted (sample)
-- ================================================================
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

-- STEP 3: Check if any can be recovered from URL
-- ================================================================
WITH recoverable AS (
  SELECT 
    id,
    url,
    SUBSTRING(url FROM '/r/([^/]+)/') as extracted_subreddit
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      metadata->>'subreddit' = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
      OR LOWER(metadata->>'subreddit') = 'unknown'
    )
    AND url LIKE '%reddit.com/r/%'
)
SELECT 
    'Can recover from URL' as status,
    COUNT(*) as count
FROM recoverable
WHERE extracted_subreddit IS NOT NULL 
  AND extracted_subreddit != ''
  AND LOWER(extracted_subreddit) != 'unknown';

-- STEP 4: Try to recover from URLs first
-- ================================================================
-- This will fix posts that have valid subreddit in their URL

WITH recoverable AS (
  SELECT 
    id,
    url,
    LOWER(TRIM(SUBSTRING(url FROM '/r/([^/]+)/'))) as extracted_subreddit,
    metadata
  FROM normalized_items
  WHERE source_platform = 'reddit'
    AND (
      metadata->>'subreddit' = 'unknown'
      OR metadata->>'subreddit' IS NULL
      OR metadata->>'subreddit' = ''
      OR LOWER(metadata->>'subreddit') = 'unknown'
    )
    AND url LIKE '%reddit.com/r/%'
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

-- Show how many were recovered
SELECT 
    'Successfully recovered' as result,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND updated_at > NOW() - INTERVAL '1 minute'
  AND metadata->>'subreddit' IS NOT NULL
  AND metadata->>'subreddit' != 'unknown';

-- STEP 5: Delete the rest
-- ================================================================
-- These cannot be recovered and must be deleted

DELETE FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );

-- STEP 6: Verify cleanup
-- ================================================================
SELECT 
    'Remaining invalid posts' as status,
    COUNT(*) as count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND (
    metadata->>'subreddit' = 'unknown'
    OR metadata->>'subreddit' IS NULL
    OR metadata->>'subreddit' = ''
    OR LOWER(metadata->>'subreddit') = 'unknown'
  );

-- Should return 0

-- STEP 7: Show current subreddit distribution
-- ================================================================
SELECT 
    metadata->>'subreddit' as subreddit,
    COUNT(*) as post_count
FROM normalized_items
WHERE source_platform = 'reddit'
  AND metadata->>'subreddit' IS NOT NULL
GROUP BY metadata->>'subreddit'
ORDER BY post_count DESC
LIMIT 20;