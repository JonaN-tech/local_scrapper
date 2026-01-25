# 🔴 Vercel Worker Bug Fix

## Error
```
[WORKER] ❌ reddit failed: h?.filter is not a function
```

## Root Cause
The Vercel worker code (running at `/api/discovery/runs/process`) is calling `.filter()` on a variable that is **not an array**. This typically happens when:

1. **Wrong data type returned from database**: The worker expects an array but receives `null`, `undefined`, or a single object
2. **Incorrect destructuring**: A variable named `h` (likely from minified/bundled code) is not properly initialized
3. **Missing data transformation**: Data fetched from Supabase needs array conversion

## Where to Fix
The bug is in your **Vercel-hosted worker code**, NOT in the local scraper. Look for:

### File Location (Typical Paths)
- `/api/discovery/runs/process/route.ts`
- `/api/discovery/runs/process.ts`
- `/pages/api/discovery/runs/process.ts`

### What to Look For
Search for code that:
1. Fetches data from Supabase for pending runs
2. Processes results with `.filter()` or `.map()`
3. Has variables that might be minified to single letters like `h`

### Common Bug Pattern
```typescript
// ❌ WRONG - Can fail if data is not an array
const h = await supabase.from('runs').select('*').eq('status', 'pending');
const filtered = h?.filter(run => run.status === 'pending'); // ERROR: h?.filter is not a function

// ✅ CORRECT - Ensure it's an array
const { data: h } = await supabase.from('runs').select('*').eq('status', 'pending');
const filtered = (h || []).filter(run => run.status === 'pending');
```

### Specific Fix Steps

1. **Find the variable `h` (or similar)** in your Vercel worker code
2. **Ensure it's properly destructured** from Supabase response:
   ```typescript
   // Before
   const h = await supabase.from('runs').select('*');
   
   // After
   const { data: h } = await supabase.from('runs').select('*');
   ```

3. **Add null-safety** when using array methods:
   ```typescript
   // Before
   const results = h?.filter(...)
   
   // After
   const results = (h || []).filter(...)
   ```

4. **Add logging** to debug what `h` actually contains:
   ```typescript
   console.log('[WORKER] h type:', typeof h);
   console.log('[WORKER] h value:', JSON.stringify(h));
   console.log('[WORKER] h is array?', Array.isArray(h));
   ```

## Current State After Local Scraper Fix

With the local scraper fixes applied:
- ✅ Local scraper handles missing `platforms_status` column gracefully
- ✅ Run records will be created successfully
- ✅ Posts will be stored in database
- ❌ **Vercel worker will still crash** when trying to process these runs

## Action Required

**You MUST fix the Vercel worker code** to resolve the `h?.filter is not a function` error. The local scraper changes alone won't fix this issue.

### Recommended Logging to Add

Add this to help debug the Vercel worker:

```typescript
console.log('[WORKER] Fetching pending runs...');
const { data: runs, error } = await supabase
  .from('runs')
  .select('*')
  .eq('status', 'pending');

console.log('[WORKER] Query result - error:', error);
console.log('[WORKER] Query result - runs type:', typeof runs);
console.log('[WORKER] Query result - is array?', Array.isArray(runs));
console.log('[WORKER] Query result - count:', runs?.length || 0);

// Safe filtering
const pendingRuns = (runs || []).filter(run => run.status === 'pending');
console.log('[WORKER] Found', pendingRuns.length, 'pending runs');
```

## Testing After Fix

1. Deploy the Vercel worker fix
2. Trigger a new scheduled run
3. Verify logs show:
   - `[WORKER] Found X pending runs` (not 0)
   - No `h?.filter is not a function` error
   - Run status changes from `running` → `completed`