import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the library before importing the module under test
vi.mock('@edgar-diff/lib', () => ({
  createEdgarClient: vi.fn(() => ({ fetchFiling: vi.fn(), dispose: vi.fn() })),
  TokenBucketRateLimiter: vi.fn(),
}));

import {
  createProxiedFetch,
  getSharedRateLimiter,
  createProxiedEdgarClient,
  _resetSharedRateLimiter,
} from './edgar-client-factory';
import { createEdgarClient, TokenBucketRateLimiter } from '@edgar-diff/lib';

const mockCreateEdgarClient = vi.mocked(createEdgarClient);
const MockTokenBucketRateLimiter = vi.mocked(TokenBucketRateLimiter);

beforeEach(() => {
  vi.clearAllMocks();
  _resetSharedRateLimiter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── createProxiedFetch — URL Rewriting ──────────────────────────────────────

describe('createProxiedFetch — URL Rewriting', () => {
  let mockGlobalFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGlobalFetch = vi.fn(() => Promise.resolve(new Response('ok')));
    vi.stubGlobal('fetch', mockGlobalFetch);
  });

  it('ECF-U1: rewrites EFTS URL to proxy route', async () => {
    const proxiedFetch = createProxiedFetch();
    await proxiedFetch('https://efts.sec.gov/LATEST/search-index?q=apple&dateRange=custom');

    expect(mockGlobalFetch).toHaveBeenCalledWith(
      '/api/sec/efts/search-index?q=apple&dateRange=custom',
      expect.any(Object),
    );
  });

  it('ECF-U2: rewrites Archives URL to proxy route', async () => {
    const proxiedFetch = createProxiedFetch();
    await proxiedFetch('https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl.htm');

    expect(mockGlobalFetch).toHaveBeenCalledWith(
      '/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm',
      expect.any(Object),
    );
  });

  it('ECF-U3: non-SEC URL passes through unchanged', async () => {
    const proxiedFetch = createProxiedFetch();
    await proxiedFetch('https://example.com/foo');

    expect(mockGlobalFetch).toHaveBeenCalledWith(
      'https://example.com/foo',
      expect.any(Object),
    );
  });

  it('ECF-U4: User-Agent header is stripped', async () => {
    const proxiedFetch = createProxiedFetch();
    await proxiedFetch('https://efts.sec.gov/LATEST/search-index', {
      headers: { 'User-Agent': 'test-agent', Accept: 'application/json' },
    });

    const [, init] = mockGlobalFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.has('User-Agent')).toBe(false);
  });

  it('ECF-U5: other headers are passed through', async () => {
    const proxiedFetch = createProxiedFetch();
    await proxiedFetch('https://efts.sec.gov/LATEST/search-index', {
      headers: { Accept: 'application/json', 'X-Custom': 'value' },
    });

    const [, init] = mockGlobalFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Custom')).toBe('value');
  });
});

// ─── getSharedRateLimiter — Singleton ────────────────────────────────────────

describe('getSharedRateLimiter — Singleton', () => {
  it('ECF-U6: first call creates a TokenBucketRateLimiter', () => {
    const limiter = getSharedRateLimiter();
    expect(MockTokenBucketRateLimiter).toHaveBeenCalledTimes(1);
    expect(limiter).toBeDefined();
  });

  it('ECF-U7: second call returns the same instance', () => {
    const first = getSharedRateLimiter();
    const second = getSharedRateLimiter();
    expect(first).toBe(second);
    expect(MockTokenBucketRateLimiter).toHaveBeenCalledTimes(1);
  });
});

// ─── createProxiedEdgarClient — Integration ──────────────────────────────────

describe('createProxiedEdgarClient — Integration', () => {
  it('ECF-U8: passes getSharedRateLimiter() to createEdgarClient', () => {
    createProxiedEdgarClient();

    expect(mockCreateEdgarClient).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimiter: expect.anything(),
      }),
    );

    // Verify it's the singleton limiter
    const passedLimiter = mockCreateEdgarClient.mock.calls[0][0].rateLimiter;
    expect(passedLimiter).toBe(getSharedRateLimiter());
  });

  it('ECF-U9: passes a fetch option (the proxied fetch)', () => {
    createProxiedEdgarClient();

    expect(mockCreateEdgarClient).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: expect.any(Function),
      }),
    );
  });

  it('ECF-U10: returns the client object from createEdgarClient', () => {
    const mockClient = { fetchFiling: vi.fn(), dispose: vi.fn() };
    mockCreateEdgarClient.mockReturnValue(mockClient);

    const result = createProxiedEdgarClient();
    expect(result).toBe(mockClient);
  });
});
