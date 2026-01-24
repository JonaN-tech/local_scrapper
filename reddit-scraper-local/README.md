# Local Reddit Scraper Service

A standalone Node.js + TypeScript service for scraping Reddit and storing results in Supabase.

## Features

- **HTTP Service** - Runs as a long-running Express server
- **Safe Scraping** - Uses `/r/{subreddit}/new.json` endpoint (~30 requests vs 400+)
- **Rate Limiting** - Built-in protection against 403/429 errors
- **Supabase Integration** - Writes runs and posts to existing `runs` and `normalized_items` tables
- **Mock Mode** - Works without Supabase credentials for testing

## Quick Start

```bash
# Install dependencies
cd reddit-scraper-local
npm install

# Start the server
npm run dev
```

## Configuration

Create a `.env` file in the project root:

```env
# Required for Supabase integration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional
PORT=3001
```

**Note:** The scraper works in mock mode (no DB writes) if Supabase credentials are not set.

## API

### POST /run/reddit

Trigger a Reddit discovery run.

**Request:**
```json
{
  "source": "manual",
  "keywords": ["cursor", "ai agents"],
  "subreddits": ["vibecoding", "cursor"],
  "window": "24h"
}
```

**Response:**
```json
{
  "runId": "uuid",
  "status": "completed",
  "postsFound": 42
}
```

### GET /api/health

Health check endpoint.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service role key |
| `PORT` | No | Server port (default: 3001) |

## Supabase Schema

The service uses existing tables:

- `runs` - Stores run metadata (mode, status, time_window, etc.)
- `normalized_items` - Stores scraped posts with run_id reference

## Rate Limiting

- Max 30 requests per minute
- Per-run limit: 30 subreddit requests
- 2-second minimum interval between requests
- Automatic subreddit blocking on 403/429

## Development

```bash
# Run server only
npm run dev

# Run CLI scraper
npm run scrape -- --keywords="cursor,ai"

# Build client
npm run build
```
