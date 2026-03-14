import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEftsProxy } from './handle-efts-proxy';

const env = { SEC_USER_AGENT: 'edgar-diff research@example.com' };

function makeRequest(path: string, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers['Origin'] = origin;
  return new Request(`https://test.example.com${path}`, { headers });
}

function makeUrl(path: string): URL {
  return new URL(`https://test.example.com${path}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('EFTS Proxy Handler', () => {
  it('WP-E1: proxies to correct EFTS URL', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index?q=apple'),
      env,
      makeUrl('/api/sec/efts/search-index?q=apple'),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://efts.sec.gov/LATEST/search-index?q=apple',
      { headers: { 'User-Agent': 'edgar-diff research@example.com' } },
    );
  });

  it('WP-E2: adds User-Agent header from env', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index'),
      env,
      makeUrl('/api/sec/efts/search-index'),
    );

    const call = mockFetch.mock.calls[0];
    expect(call[1]).toEqual({ headers: { 'User-Agent': 'edgar-diff research@example.com' } });
  });

  it('WP-E3: response body passed through', async () => {
    const body = { hits: [{ cik: '320193' }] };
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    ));

    const response = await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index?q=apple'),
      env,
      makeUrl('/api/sec/efts/search-index?q=apple'),
    );

    const json = await response.json();
    expect(json).toEqual(body);
  });

  it('WP-E4: CORS headers added to response', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    ));

    const response = await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index', 'http://localhost:5173'),
      env,
      makeUrl('/api/sec/efts/search-index'),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('WP-E5: SEC 404 forwarded to client', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('', { status: 404, headers: { 'Content-Type': 'application/json' } })),
    ));

    const response = await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index?q=nonexistent'),
      env,
      makeUrl('/api/sec/efts/search-index?q=nonexistent'),
    );

    expect(response.status).toBe(404);
  });

  it('WP-E6: SEC 429 forwarded to client', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('', { status: 429, headers: { 'Content-Type': 'application/json' } })),
    ));

    const response = await handleEftsProxy(
      makeRequest('/api/sec/efts/search-index'),
      env,
      makeUrl('/api/sec/efts/search-index'),
    );

    expect(response.status).toBe(429);
  });
});
