/**
 * Supabase-ready interface for Reddit scraped posts
 * Ready for future storage in Supabase
 */

/**
 * Raw scraped post data structure for Supabase storage
 */
export interface ScrapedPost {
  subreddit: string;
  keyword: string;
  title: string;
  url: string;
  content: string;
  author?: string;
  created_utc: number;
  score: number;
  num_comments: number;
  raw_data: object;
  scraped_at: string;
}

/**
 * Convert NormalizedPost to ScrapedPost for Supabase storage
 */
export function toScrapedPost(
  post: {
    id: string;
    sourceContext: string;
    keywordsMatched: string[];
    title: string;
    url: string;
    content: string;
    author?: string;
    createdAt: Date;
    raw: {
      score: number;
      numComments: number;
      subreddit: string;
    };
  }
): ScrapedPost {
  return {
    subreddit: post.raw.subreddit,
    keyword: post.keywordsMatched[0] || '',
    title: post.title,
    url: post.url,
    content: post.content,
    author: post.author,
    created_utc: Math.floor(post.createdAt.getTime() / 1000),
    score: post.raw.score,
    num_comments: post.raw.numComments,
    raw_data: post.raw as object,
    scraped_at: new Date().toISOString(),
  };
}
