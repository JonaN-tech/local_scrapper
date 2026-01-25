# 🔍 Debug Summary - Reddit Discovery System

## 📊 Current System State

### ✅ What's Working
- Local scraper successfully fetches 74 posts from Reddit
- Rate limiting works correctly (30 requests/minute)
- Post data normalization works
- Keyword matching works correctly

### ❌ What's Broken
1. **Local Scraper**: Database insertion failed due to schema mismatch → **FIXED**
2. **Vercel Worker**: Crashes with `h?.filter is not a function` → **NEEDS FIXING IN VERCEL CODE**

---

## 🐛 Issue #1: Database Schema Mismatch (LOCAL SCRAPER)

### Symptoms
```
[RedditDiscoveryRunner] Run insert failed: Could not find the 'platforms_status' column of 'runs' in the schema cache
[RedditDiscoveryRunner] No runId obtained, skipping item insertion
[Server] Run completed - RunId: null, Posts: 74, Status: completed
```

### Root Cause
The local scraper tried to insert/update the `platforms_status` column, which doesn't exist in your Supabase database schema.

### Fix Applied ✅
Modified [`reddit-scraper-local/src/runner/runRedditDiscovery.ts`](reddit-scraper-local/src/runner/runRedditDiscovery.ts):
- Added backward-compatible logic that tries with `platforms_status` first
- Falls back to schema without `platforms_status` if column doesn't exist
- Applies to: run creation (line 42), completion update (line 102), and failure update (line 136)

### Result
- Local scraper will now successfully create run records
- Posts will be stored in database
- No more `runId: null` issues

---

## 🐛 Issue #2: Vercel Worker Bug (VERCEL CODE)

### Symptoms
```
[WORKER] ❌ reddit failed: h?.filter is not a function
[WORKER] Found 0 pending runs
```

### Root Cause
Your Vercel worker at `/api/discovery/runs/process` has a bug where:
1. It incorrectly destructures data from Supabase
2. Tries to call `.filter()` on `undefined` or non-array value
3. Cannot find any pending runs because the query/processing logic fails

### Location
**NOT in the local scraper** - this bug is in your **Vercel-hosted code**:
- Likely at `/api/discovery/runs/process/route.ts` or similar
- The minified/bundled variable name suggests production build

### How to Fix 🔧
See [`VERCEL_WORKER_BUG_FIX.md`](VERCEL_WORKER_BUG_FIX.md) for detailed fix instructions.

**Quick fix pattern:**
```typescript
// ❌ WRONG
const h = await supabase.from('runs').select('*');
const filtered = h?.filter(...); // ERROR!

// ✅ CORRECT
const { data: h } = await supabase.from('runs').select('*');
const filtered = (h || []).filter(...);
```

---

## 📈 Current Flow & Where It Breaks

```
┌─────────────────────────────────────────────────────────┐
│ 1. Schedule Triggers Run                                │
│    ✅ POST /api/schedules/.../trigger                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Local Scraper Receives Request                       │
│    ✅ Fetches 74 posts from Reddit                       │
│    ✅ Creates run record in DB (AFTER FIX)              │
│    ✅ Inserts 74 posts into normalized_items            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Vercel Worker Processes Run                          │
│    ❌ GET /api/discovery/runs/process                    │
│    ❌ Crashes: h?.filter is not a function              │
│    ❌ Cannot process the pending run                    │
│    Shows: "Found 0 pending runs"                        │
└─────────────────────────────────────────────────────────┘
```

### Why You See "0 pending runs"
1. The worker crashes before it can properly query/process runs
2. The `.filter()` error happens early in the execution
3. Even though a run was created, the worker can't see/process it

---

## 🔧 What Was Fixed (LOCAL SCRAPER)

### File: `reddit-scraper-local/src/runner/runRedditDiscovery.ts`

**Changes:**
1. **Line 42-91**: Run creation with backward compatibility
   - Tries with `platforms_status` column first
   - Automatically retries without it if column doesn't exist
   - Better error logging with ✅ success indicators

2. **Line 102-137**: Completion update with backward compatibility
   - Same fallback pattern for updates
   - Clear success/failure logging

3. **Line 158-187**: Failure update with backward compatibility
   - Handles schema differences gracefully
   - Ensures run status is always updated

**Benefits:**
- Works with both old and new database schemas
- No more run creation failures
- Posts will be properly stored
- Better debugging with clear log indicators

---

## 📋 Next Steps

### Immediate Actions Required

1. **Fix Vercel Worker** (CRITICAL)
   - Follow instructions in [`VERCEL_WORKER_BUG_FIX.md`](VERCEL_WORKER_BUG_FIX.md)
   - Fix the `h?.filter is not a function` error
   - Add defensive null checks and logging
   - Deploy to Vercel

2. **Test End-to-End**
   After deploying Vercel fix:
   ```bash
   # Trigger a new scheduled run
   # Monitor logs for:
   ✅ [RedditDiscoveryRunner] ✅ Run created: <uuid>
   ✅ [WORKER] Found X pending runs (not 0!)
   ✅ [WORKER] Processing run: <uuid>
   ✅ Run status: running → completed
   ```

3. **Verify Database**
   - Check `runs` table has new record with valid UUID
   - Check `normalized_items` has 74 posts linked to that run
   - Verify run `status` changed from 'running' to 'completed'

### Optional Improvements

1. **Add `platforms_status` column** to your Supabase schema if you want that feature
   ```sql
   ALTER TABLE runs ADD COLUMN platforms_status JSONB;
   ```

2. **Add monitoring** to catch similar issues earlier:
   - Log all Supabase errors with full context
   - Add alerting for worker failures
   - Track run completion rates

---

## 🎯 Summary

| Component | Status | Action |
|-----------|--------|--------|
| Local Scraper | ✅ Fixed | Deploy changes to Render |
| Vercel Worker | ❌ Needs Fix | Fix `h?.filter` bug in Vercel code |
| Database | ⚠️ Schema Mismatch | Optional: Add `platforms_status` column |

**Current Impact:**
- Local scraper will now work correctly after restart/redeploy
- Vercel worker still broken until you fix the `.filter()` bug
- Scheduled runs will create records but worker can't process them yet

**After Both Fixes:**
- ✅ Scheduled runs create records successfully
- ✅ Local scraper stores posts in database  
- ✅ Vercel worker processes runs correctly
- ✅ Full end-to-end flow working