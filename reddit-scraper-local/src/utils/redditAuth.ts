/**
 * Reddit OAuth2 - Application-Only (client credentials) authentication
 *
 * Reddit blocks unauthenticated requests from datacenter/cloud IPs (Render, Vercel, etc.).
 * This module obtains a Bearer token via the "client_credentials" grant and caches it
 * until it expires. All Reddit API requests should then use:
 *   - Base URL: https://oauth.reddit.com  (instead of https://www.reddit.com)
 *   - Header:   Authorization: Bearer <token>
 *
 * Required Render environment variables:
 *   REDDIT_CLIENT_ID      - from https://www.reddit.com/prefs/apps
 *   REDDIT_CLIENT_SECRET  - from https://www.reddit.com/prefs/apps
 *   REDDIT_USER_AGENT     - e.g. "MyApp/1.0 by u/yourRedditUsername"
 *
 * How to create a Reddit app:
 *   1. Go to https://www.reddit.com/prefs/apps
 *   2. Click "create another app..."
 *   3. Choose type: "script"
 *   4. Fill in name and redirect URI (use http://localhost for scripts)
 *   5. Copy the client_id (under the app name) and secret
 */

export interface RedditTokenResult {
  accessToken: string;
  expiresAt: number; // Unix ms timestamp
}

let cachedToken: RedditTokenResult | null = null;

/**
 * Returns true if Reddit OAuth credentials are configured in environment variables.
 */
export function hasRedditCredentials(): boolean {
  return Boolean(
    process.env['REDDIT_CLIENT_ID'] &&
    process.env['REDDIT_CLIENT_SECRET']
  );
}

/**
 * Fetch a Reddit OAuth2 application-only access token.
 * Caches the token and reuses it until 60 seconds before expiry.
 * Throws a descriptive error if credentials are missing or the request fails.
 */
export async function getRedditAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    console.log(`[RedditAuth] Using cached access token (expires in ${Math.round((cachedToken.expiresAt - Date.now()) / 1000)}s)`);
    return cachedToken.accessToken;
  }

  const clientId = process.env['REDDIT_CLIENT_ID'];
  const clientSecret = process.env['REDDIT_CLIENT_SECRET'];
  const userAgent = process.env['REDDIT_USER_AGENT'] ||
    'MultiPlatformScraper/1.0 (contact: support@example.com)';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Reddit API credentials are missing in production. ' +
      'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in your Render environment variables. ' +
      'Create a Reddit app at https://www.reddit.com/prefs/apps (choose type: script).'
    );
  }

  console.log(`[RedditAuth] Fetching new access token (client_credentials grant)...`);
  console.log(`[RedditAuth] Client ID set: true, Secret set: true`);
  console.log(`[RedditAuth] User-Agent: ${userAgent}`);

  // Basic auth: base64(clientId:clientSecret)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }
    throw new Error(
      `Reddit OAuth token request failed: ${response.status} ${response.statusText}. ` +
      `Body: ${body.substring(0, 300)}. ` +
      `Check that REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are correct.`
    );
  }

  const data = await response.json() as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: string;
  };

  if (data.error || !data.access_token) {
    throw new Error(
      `Reddit OAuth returned an error: ${data.error || 'no access_token in response'}. ` +
      `Verify your REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are correct.`
    );
  }

  const expiresIn = data.expires_in ?? 3600; // Default 1 hour
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  console.log(`[RedditAuth] Access token obtained successfully (expires in ${expiresIn}s)`);
  return cachedToken.accessToken;
}

/**
 * Clear cached token (useful for testing or after auth errors)
 */
export function clearRedditTokenCache(): void {
  cachedToken = null;
  console.log(`[RedditAuth] Token cache cleared`);
}
