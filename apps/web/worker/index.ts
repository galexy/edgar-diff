interface Env {
  SEC_USER_AGENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Route: Ticker data
    if (url.pathname === '/api/tickers') {
      return handleTickers(request, env);
    }

    // Route: SEC submissions proxy
    if (url.pathname.startsWith('/api/sec/submissions/')) {
      return handleSubmissionsProxy(request, env, url);
    }

    // Not an API route — let assets/SPA handle it
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function handleOptions(request: Request): Response {
  const origin = request.headers.get('Origin') ?? '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function handleTickers(request: Request, env: Env): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/api/tickers');

  // Check cache first
  const cached = await cache.match(cacheKey);
  if (cached) {
    return addCorsHeaders(cached, request);
  }

  // Fetch from SEC
  const secResponse = await fetch(
    'https://www.sec.gov/files/company_tickers.json',
    { headers: { 'User-Agent': env.SEC_USER_AGENT } },
  );

  if (!secResponse.ok) {
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
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Invalid CIK format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  const secUrl = `https://data.sec.gov/submissions/${secPath}`;

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: { 'Content-Type': 'application/json' },
    }),
    request,
  );
}

function addCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin') ?? '*';
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', origin);
  newResponse.headers.set('Vary', 'Origin');
  return newResponse;
}
