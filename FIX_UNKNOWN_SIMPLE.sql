-- ================================================================
-- FIXED SQL - No Ambiguous Column References
-- ================================================================
-- Run this in Supabase SQL Editor
-- ================================================================

-- Step 1: Recover posts from URLs
WITH recoverable AS (
  SELECT 
    id,
    LOWER(TRIM(SUBSTRING(url FROM '/r/([^/]+)/'))) as extracted_subreddit
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
    normalized_items.metadata,  -- Fixed: qualified with table name
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

-- Step 3: Verify (should show 0)
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