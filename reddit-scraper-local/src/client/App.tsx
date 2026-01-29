import { useState } from 'react';

interface ScrapeRequest {
  keywords: string[];
  days: number;
  limit: number;
}

interface RedditPost {
  id: string;
  title: string;
  url: string;
  author?: string;
  sourceContext: string;
  createdAt: string;
  keywordsMatched: string[];
  raw?: {
    subreddit?: string;
    score?: number;
    numComments?: number;
  };
}

interface ScrapeResponse {
  success: boolean;
  count: number;
  posts: RedditPost[];
  error?: string;
}

/**
 * Extract subreddit name from sourceContext with safety checks
 * Returns null if subreddit cannot be determined
 */
function getSubredditName(post: RedditPost): string | null {
  // Try raw.subreddit first
  const rawSub = post.raw?.subreddit;
  if (rawSub && typeof rawSub === 'string' && rawSub.trim() !== '') {
    return rawSub.toLowerCase().trim();
  }

  // Try sourceContext (format: "r/{subreddit}")
  if (post.sourceContext && typeof post.sourceContext === 'string') {
    const sub = post.sourceContext.replace(/^r\//i, '').trim();
    if (sub && sub !== 'unknown' && sub !== '') {
      return sub.toLowerCase();
    }
  }

  // Could not determine subreddit
  return null;
}

/**
 * Render subreddit link with safety guards
 */
function SubredditLink({ post }: { post: RedditPost }) {
  const subreddit = getSubredditName(post);

  if (!subreddit) {
    return <span style={{ color: '#999', fontStyle: 'italic' }}>Unknown source (skipped)</span>;
  }

  return (
    <a
      href={`https://reddit.com/r/${subreddit}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: '#0066cc' }}
    >
      r/{subreddit}
    </a>
  );
}

function App() {
  const [keywords, setKeywords] = useState('cursor, kilocode, ai coding');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunScraper = async () => {
    const keywordList = keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    if (keywordList.length === 0) {
      setError('Enter at least one keyword');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const requestBody: ScrapeRequest = {
        keywords: keywordList,
        days,
        limit: 50,
      };

      const response = await fetch('http://localhost:3001/api/scrape/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Scraping failed');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Reddit Scraper</h1>
      
      <div className="input-group">
        <label>Keywords</label>
        <input
          type="text"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="cursor, kilocode, ai coding"
        />
      </div>

      <div className="input-group">
        <label>Days back</label>
        <input
          type="number"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          min="1"
          max="365"
        />
      </div>

      <button onClick={handleRunScraper} disabled={loading}>
        {loading ? 'Running...' : 'Run Scraper'}
      </button>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="results">
          <p className="count">{result.count} posts found</p>
          
          {/* Display posts with safety guards */}
          <div style={{ marginTop: '20px' }}>
            {result.posts.slice(0, 10).map(post => (
              <div key={post.id} style={{
                border: '1px solid #ddd',
                padding: '15px',
                marginBottom: '10px',
                borderRadius: '5px'
              }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    {post.title}
                  </a>
                </h3>
                <div style={{ fontSize: '14px', color: '#666' }}>
                  <SubredditLink post={post} /> •
                  by {post.author || '[deleted]'} •
                  {new Date(post.createdAt).toLocaleDateString()}
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
                  Keywords: {post.keywordsMatched.join(', ')}
                </div>
              </div>
            ))}
          </div>

          {/* Raw JSON for debugging */}
          <details style={{ marginTop: '20px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              View raw JSON
            </summary>
            <pre style={{ marginTop: '10px' }}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

export default App;
