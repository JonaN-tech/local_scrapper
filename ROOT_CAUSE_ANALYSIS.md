# Why Were We Getting r/Unknown Posts?

## The Problem

The original scraper **never extracted subreddit data from Reddit's API response**. Instead, it blindly used whatever subreddit name was passed as a parameter to the function.

## Code Analysis - Before Fix

### Original Code (WRONG)
```typescript
// In RedditScraperLocal.ts - fetchSubredditNew()
private async fetchSubredditNew(
  subreddit: string,  // <-- This was just a parameter
  keywords: string[],
  timeWindow: { from: Date; to: Date },
  limit: number
): Promise<NormalizedPost[]> {
  // ... fetch from Reddit ...
  
  for (const child of response.data.data.children) {
    const post = child.data;  // <-- Reddit API response here!
    
    posts.push({
      id: post.id,
      // ... other fields ...
      sourceContext: `r/${subreddit}`,  // ❌ WRONG - using parameter
      raw: {
        score: post.score,
        numComments: post.num_comments,
        subreddit,  // ❌ WRONG - using parameter, not post.subreddit
      },
    });
  }
}
```

### Database Insertion (WRONG)
```typescript
// In runRedditDiscovery.ts - insertPosts()
const subredditRaw = post.raw?.subreddit || post.sourceContext.replace('r/', '');
// ❌ This was just the parameter, not real Reddit data
```

## How "Unknown" Values Got In

There are several ways this could happen:

### 1. **Error Handling with Default Values**
```typescript
// Somewhere in the code (hypothetical)
const subreddit = getSomeSubreddit() || 'unknown';  // ❌ Bad fallback
```

### 2. **Missing/Null Values**
If the parameter wasn't provided or was undefined:
```typescript
fetchSubredditNew(undefined, keywords, timeWindow, limit)
// Would result in sourceContext: "r/undefined" or similar
```

### 3. **Manual Database Entries**
Someone might have manually inserted test data with:
```sql
INSERT INTO normalized_items (subreddit, ...) VALUES ('unknown', ...);
```

### 4. **Old Migration or Import Scripts**
Legacy data imports that didn't have proper subreddit mapping:
```typescript
// Old import script
const item = {
  subreddit: oldData.subreddit || 'unknown',  // ❌ Bad default
};
```

### 5. **API Response Inconsistencies**
If Reddit's API ever returned posts without the expected fields, and there was error handling:
```typescript
try {
  subreddit = post.data.subreddit;
} catch (e) {
  subreddit = 'unknown';  // ❌ Bad error handling
}
```

### 6. **Crossposting or Aggregation Issues**
Reddit posts can be crossposted. If the scraper fetched from one subreddit but the post originated elsewhere, without proper extraction it might have gotten confused.

## Why This Was a Critical Bug

### 1. **Data Integrity**
- Posts appear to come from a non-existent subreddit
- Analytics and reports become meaningless
- Cannot trust any historical data

### 2. **UI Breakage**
```typescript
// UI tries to build link
const link = `https://reddit.com/r/${post.subreddit}/`;
// Results in: https://reddit.com/r/unknown/ ❌ 404 error
```

### 3. **Search and Filtering Broken**
```sql
-- User wants posts from r/cursor
SELECT * FROM posts WHERE subreddit = 'cursor';
-- Misses posts that should be included but are marked "unknown"
```

### 4. **Loss of Context**
- Can't understand which community a post came from
- Can't analyze trends per subreddit
- Can't filter or group by subreddit

## The Fix - How We Solved It

### 1. **Extract from Reddit API Response**
```typescript
// NEW - extractSubreddit()
private extractSubreddit(post: any): string | null {
  // Try direct field from Reddit API
  if (post.subreddit && typeof post.subreddit === 'string') {
    return this.normalizeSubreddit(post.subreddit);  // ✅ Use actual data
  }

  // Fallback: parse from permalink
  if (post.permalink && typeof post.permalink === 'string') {
    const match = post.permalink.match(/^\/r\/([^\/]+)\//);
    if (match && match[1]) {
      return this.normalizeSubreddit(match[1]);  // ✅ Extract from URL
    }
  }

  return null;  // ✅ Be honest - we don't know
}
```

### 2. **Skip Invalid Posts**
```typescript
const extractedSubreddit = this.extractSubreddit(post);
if (!extractedSubreddit) {
  // ✅ Skip the post - don't store garbage
  skippedNoSubreddit++;
  console.log(`Skipped post ${post.id}: subreddit could not be resolved`);
  continue;
}
```

### 3. **Validate Before Storage**
```typescript
// In insertPosts()
if (!subredditRaw || typeof subredditRaw !== 'string' || subredditRaw.trim() === '') {
  skippedCount++;
  console.log(`Skipped post ${post.id}: subreddit missing or invalid`);
  continue;  // ✅ Don't insert bad data
}

// Verify URL matches subreddit
if (!post.url.includes(`/r/${subreddit}/`)) {
  skippedCount++;
  console.log(`Skipped post ${post.id}: URL mismatch`);
  continue;  // ✅ Double-check consistency
}
```

## Prevention Strategy

### Defense in Depth
1. **Scraper Level** - Extract and validate from source
2. **Processing Level** - Verify before transformation
3. **Database Level** - Final validation before insert
4. **UI Level** - Handle edge cases gracefully

### Never Trust Input
```typescript
// ❌ WRONG
const subreddit = parameter;

// ✅ RIGHT
const subreddit = extractFromActualData(response);
if (!subreddit) {
  skip(); // or throw error
}
```

### Fail Fast
```typescript
// ❌ WRONG - silent failure
const subreddit = data.subreddit || 'unknown';

// ✅ RIGHT - explicit failure
const subreddit = data.subreddit;
if (!subreddit) {
  throw new Error('Subreddit missing');
}
```

## Monitoring Going Forward

Watch for these patterns:
```
✅ Good: [RedditScraperLocal] r/cursor: 15 posts matched keywords
⚠️ Bad:  [RedditScraperLocal] Skipped 10 posts: subreddit could not be resolved
```

If you see many skipped posts, investigate:
- Reddit API changes
- Network/rate limiting
- Data quality issues
- Scraper configuration errors

## Summary

**The bug existed because:**
- Code never read `post.subreddit` from Reddit API
- It trusted the function parameter instead
- No validation at any level
- Bad error handling with "unknown" fallbacks

**We fixed it by:**
- Extracting subreddit from actual Reddit API response
- Validating at multiple levels
- Skipping invalid posts with logging
- Using Reddit conventions ("[deleted]" not "unknown")
- Adding UI safety guards

This is now a **robust, deterministic scraper** that only stores valid, verified data.