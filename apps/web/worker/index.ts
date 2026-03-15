import type { Env } from './types';
import { addCorsHeaders, handleOptions } from './cors';
import { handleEftsProxy } from './handle-efts-proxy';
import { handleArchivesProxy } from './handle-archives-proxy';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      console.log(`[Worker] OPTIONS ${url.pathname}`);
      return handleOptions(request);
    }

    // Route: Ticker data
    if (url.pathname === '/api/tickers') {
      console.log(`[Worker] GET /api/tickers`);
      return handleTickers(request, env);
    }

    // Route: SEC submissions proxy
    if (url.pathname.startsWith('/api/sec/submissions/')) {
      console.log(`[Worker] GET ${url.pathname}`);
      return handleSubmissionsProxy(request, env, url);
    }

    // Route: SEC EFTS proxy
    if (url.pathname.startsWith('/api/sec/efts/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
          }),
          request,
        );
      }
      console.log(`[Worker] GET ${url.pathname}`);
      return handleEftsProxy(request, env, url);
    }

    // Route: SEC Archives proxy
    if (url.pathname.startsWith('/api/sec/archives/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
          }),
          request,
        );
      }
      console.log(`[Worker] GET ${url.pathname}`);
      return handleArchivesProxy(request, env, url);
    }

    // Not an API route — let assets/SPA handle it
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleTickers(request: Request, env: Env): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/api/tickers');

  // Check cache first
  const cached = await cache.match(cacheKey);
  if (cached) {
    console.log('[Worker] tickers cache HIT');
    return addCorsHeaders(cached, request);
  }

  console.log('[Worker] tickers cache MISS, fetching from SEC');
  const secResponse = await fetch(
    'https://www.sec.gov/files/company_tickers.json',
    { headers: { 'User-Agent': env.SEC_USER_AGENT } },
  );

  if (!secResponse.ok) {
    console.log(`[Worker] SEC tickers fetch failed: ${secResponse.status}`);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Failed to fetch tickers' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  // Cache for 24 hours
  const response = new Response(secResponse.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    },
  });

  // Store in cache (non-blocking)
  const responseToCache = response.clone();
  cache.put(cacheKey, responseToCache);

  return addCorsHeaders(response, request);
}

async function handleSubmissionsProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const secPath = url.pathname.replace('/api/sec/submissions/', '');

  // Validate path to prevent traversal attacks
  if (!/^CIK\d{10}\.json$/.test(secPath)) {
    console.log(`[Worker] rejected invalid path: ${secPath}`);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Invalid CIK format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  const secUrl = `https://data.sec.gov/submissions/${secPath}`;
  console.log(`[Worker] proxying to ${secUrl}`);

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  if (!secResponse.ok) {
    console.log(`[Worker] submissions proxy error: ${secResponse.status}`);
  }

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: { 'Content-Type': 'application/json' },
    }),
    request,
  );
}
