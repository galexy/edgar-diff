import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleArchivesProxy } from './handle-archives-proxy';

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

describe('Archives Proxy Handler', () => {
  it('WP-A1: proxies to correct SEC Archives URL', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response('<html>filing</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await handleArchivesProxy(
      makeRequest('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
      env,
      makeUrl('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl.htm',
      { headers: { 'User-Agent': 'edgar-diff research@example.com' } },
    );
  });

  it('WP-A2: adds User-Agent header from env', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response('ok', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await handleArchivesProxy(
      makeRequest('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
      env,
      makeUrl('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
    );

    const call = mockFetch.mock.calls[0];
    expect(call[1]).toEqual({ headers: { 'User-Agent': 'edgar-diff research@example.com' } });
  });

  it('WP-A3: response body passed through with correct Content-Type', async () => {
    const html = '<html><body>Filing content</body></html>';
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })),
    ));

    const response = await handleArchivesProxy(
      makeRequest('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
      env,
      makeUrl('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
    );

    expect(response.headers.get('Content-Type')).toBe('text/html');
    const body = await response.text();
    expect(body).toBe(html);
  });

  it('WP-A4: CORS headers added to response', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('ok', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    ));

    const response = await handleArchivesProxy(
      makeRequest('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm', 'http://localhost:5173'),
      env,
      makeUrl('/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm'),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('WP-A5: invalid path (traversal attempt) returns 400', async () => {
    const response = await handleArchivesProxy(
      makeRequest('/api/sec/archives/../../../etc/passwd'),
      env,
      makeUrl('/api/sec/archives/../../../etc/passwd'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('WP-A6: path not matching expected pattern returns 400', async () => {
    const response = await handleArchivesProxy(
      makeRequest('/api/sec/archives/random/invalid/path'),
      env,
      makeUrl('/api/sec/archives/random/invalid/path'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid archives path');
  });
});
