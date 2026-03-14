import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index';

// --- Mock environment ---
const env = { SEC_USER_AGENT: 'edgar-diff research@example.com' };

// --- Helpers ---
function makeRequest(path: string, method = 'GET', headers: Record<string, string> = {}): Request {
  return new Request(`https://test.example.com${path}`, {
    method,
    headers: { ...headers },
  });
}

function makeRequestWithOrigin(path: string, origin: string, method = 'GET'): Request {
  return new Request(`https://test.example.com${path}`, {
    method,
    headers: { Origin: origin },
  });
}

// --- Mock caches.default ---
let cacheStore: Map<string, Response>;
const mockCache = {
  match: vi.fn(async (key: Request) => cacheStore.get(key.url) ?? undefined),
  put: vi.fn(async (key: Request, response: Response) => {
    cacheStore.set(key.url, response);
  }),
};

beforeEach(() => {
  vi.restoreAllMocks();
  cacheStore = new Map();
  // @ts-expect-error — mock Workers Cache API
  globalThis.caches = { default: mockCache };
});

// ─── Route Matching ───────────────────────────────────────────────────────────

describe('Worker: Route Matching', () => {
  it('handles ticker data route GET /api/tickers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ '0': { ticker: 'AAPL' } }), { status: 200 })),
      ),
    );

    const response = await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('0');
  });

  it('handles submissions proxy route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ name: 'Apple Inc.' }), { status: 200 })),
      ),
    );

    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
  });

  it('handles CORS preflight OPTIONS /api/tickers', async () => {
    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173', 'OPTIONS'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(204);
  });

  it('returns 404 for unknown API routes', async () => {
    const response = await worker.fetch(makeRequest('/api/unknown'), env, {} as ExecutionContext);
    expect(response.status).toBe(404);
  });

  it('returns 404 for non-API routes (assets handled separately)', async () => {
    const response = await worker.fetch(makeRequest('/'), env, {} as ExecutionContext);
    expect(response.status).toBe(404);
  });
});

// ─── CORS Headers ─────────────────────────────────────────────────────────────

describe('Worker: CORS Headers', () => {
  it('preflight includes Access-Control-Allow-Origin from request Origin', async () => {
    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173', 'OPTIONS'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('preflight includes Access-Control-Allow-Methods', async () => {
    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173', 'OPTIONS'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('preflight includes Access-Control-Allow-Headers', async () => {
    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173', 'OPTIONS'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('preflight includes Access-Control-Max-Age', async () => {
    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173', 'OPTIONS'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('data responses include Access-Control-Allow-Origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );

    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('data responses include Vary: Origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );

    const response = await worker.fetch(
      makeRequestWithOrigin('/api/tickers', 'http://localhost:5173'),
      env,
      {} as ExecutionContext,
    );
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('falls back to wildcard when no Origin header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );

    const response = await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ─── Tickers Caching ──────────────────────────────────────────────────────────

describe('Worker: Tickers Caching', () => {
  it('cache miss → fetches from SEC with User-Agent header', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ '0': { ticker: 'AAPL' } }), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.sec.gov/files/company_tickers.json',
      { headers: { 'User-Agent': 'edgar-diff research@example.com' } },
    );
  });

  it('cache miss → stores response in cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );

    await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    expect(mockCache.put).toHaveBeenCalled();
  });

  it('cache hit → returns cached response without upstream fetch', async () => {
    // Pre-populate cache
    const cachedBody = JSON.stringify({ cached: true });
    cacheStore.set(
      'https://cache.internal/api/tickers',
      new Response(cachedBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const response = await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    const body = await response.json();

    expect(body).toEqual({ cached: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sets Content-Type to application/json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );

    const response = await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('upstream SEC failure → returns 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    );

    const response = await worker.fetch(makeRequest('/api/tickers'), env, {} as ExecutionContext);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });
});

// ─── Submissions Proxy ────────────────────────────────────────────────────────

describe('Worker: Submissions Proxy', () => {
  it('proxies to correct SEC URL', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ name: 'Apple Inc.' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://data.sec.gov/submissions/CIK0000320193.json',
      { headers: { 'User-Agent': 'edgar-diff research@example.com' } },
    );
  });

  it('injects User-Agent header', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );

    const call = mockFetch.mock.calls[0];
    expect(call[1]).toEqual({ headers: { 'User-Agent': 'edgar-diff research@example.com' } });
  });

  it('forwards SEC status code (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );

    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/CIK9999999999.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
  });

  it('forwards SEC response body', async () => {
    const body = { name: 'Apple Inc.', cik: '320193' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
      ),
    );

    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(body);
  });

  it('handles SEC 429 (rate limit)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 429 }))),
    );

    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(429);
  });

  it('handles SEC 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    );

    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/CIK0000320193.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(500);
  });

  it('rejects invalid path format with 400', async () => {
    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/notacik.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('rejects non-CIK paths with 400', async () => {
    const response = await worker.fetch(
      makeRequest('/api/sec/submissions/arbitrary.json'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
  });
});
