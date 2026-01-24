import { useState } from 'react';

interface ScrapeRequest {
  keywords: string[];
  days: number;
  limit: number;
}

interface ScrapeResponse {
  success: boolean;
  count: number;
  posts: any[];
  error?: string;
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
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
