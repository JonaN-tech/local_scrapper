export interface PlatformScraper {
  platform: 'reddit' | 'twitter' | 'hackernews' | 'devto';
  fetchPosts(params: ScrapingParams): Promise<NormalizedPost[]>;
}

export interface ScrapingParams {
  keywords: string[];
  timeWindow: {
    from: Date;
    to: Date;
  };
  limit?: number;
}

export interface NormalizedPost {
  id: string;
  platform: 'reddit' | 'twitter' | 'hackernews' | 'devto';
  title: string;
  content: string;
  url: string;
  author?: string;
  sourceContext: string;
  createdAt: Date;
  keywordsMatched: string[];
  raw: Record<string, unknown>;
}
