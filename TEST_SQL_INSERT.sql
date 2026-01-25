-- ============================================
-- TEST SQL FOR MANUAL SUPABASE VERIFICATION
-- ============================================
-- Run this in Supabase SQL Editor to verify the schema works
-- This mimics what the code will do automatically

-- Test 1: Insert a single test post
INSERT INTO normalized_items (
  run_id,
  platform,
  source,
  title,
  content,
  author,
  url,
  created_at,
  subreddit,
  score
) VALUES (
  gen_random_uuid(),  -- Generates a random UUID for run_id
  'reddit'::varchar,
  'manual_test'::varchar,
  'Test Post Title'::text,
  'This is test content to verify the schema works correctly'::text,
  'test_author'::varchar,
  'https://reddit.com/test'::text,
  NOW()::timestamp,
  'TestSubreddit'::text,
  42
)
RETURNING id, run_id, platform, title;

-- Expected result: Should return the inserted row's ID and data
-- If this works, your schema is correct and the code will work!

-- ============================================
-- Test 2: Check what columns actually exist
-- ============================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'normalized_items'
ORDER BY ordinal_position;

-- This will show you ALL columns and their types in normalized_items table

-- ============================================
-- Test 3: Verify you can query the test data
-- ============================================
SELECT 
  id,
  run_id,
  platform,
  source,
  title,
  author,
  subreddit,
  score,
  created_at
FROM normalized_items
WHERE source = 'manual_test'
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- Cleanup (optional): Delete test data
-- ============================================
-- Uncomment to remove test data after verification:
-- DELETE FROM normalized_items WHERE source = 'manual_test';