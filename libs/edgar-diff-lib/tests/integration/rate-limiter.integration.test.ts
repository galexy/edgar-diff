import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEdgarClient } from '../../src/client/edgar-client.js';
import { TokenBucketRateLimiter } from '../../src/client/rate-limiter.js';

// --- Helpers ---

const EFTS_JSON = JSON.stringify({
  hits: {
    total: { value: 1, relation: 'eq' },
    hits: [
      {
        _id: '0000320193-23-000106:aapl-20230930.htm',
        _source: {
          ciks: ['0000320193'],
          root_forms: ['10-K'],
          form: '10-K',
          file_date: '2023-11-03',
          adsh: '0000320193-23-000106',
          sequence: 1,
        },
      },
    ],
  },
});

const FILING_HTML = '<html><body>Filing</body></html>';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

/** URL-aware mock that handles concurrent requests correctly */
function createUrlAwareMockFetch(opts?: {
  eftsResponses?: Array<{ status: number; body: string; headers?: Record<string, string> }>;
}): typeof globalThis.fetch {
  const defaultEfts = { status: 200, body: EFTS_JSON, headers: { 'Content-Type': 'application/json' } };
  const eftsResponses = opts?.eftsResponses ?? [defaultEfts];
  let eftsCallIndex = 0;

  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('efts.sec.gov')) {
      const resp = eftsResponses[eftsCallIndex] ?? eftsResponses[eftsResponses.length - 1];
      eftsCallIndex++;
      return Promise.resolve(
        new Response(resp!.body, { status: resp!.status, headers: resp!.headers }),
      );
    }
    // HTML document fetch
    return Promise.resolve(
      new Response(FILING_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
  }) as typeof globalThis.fetch;
}

// --- Integration Tests: Rate Limiter + Client ---

describe('rate limiter + client integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should space rapid sequential fetchFiling calls when bucket empties', async () => {
    // Small capacity: 3 tokens, refillRate 3/s => interval ~334ms
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 3 });

    // 3 fetchFiling calls = 6 acquires (2 per call: EFTS + HTML)
    // First 3 immediate, remaining 3 queued
    const fetchTimestamps: number[] = [];
    const baseMockFetch = createUrlAwareMockFetch();
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchTimestamps.push(Date.now());
      return (baseMockFetch as ReturnType<typeof vi.fn>).getMockImplementation()!(url, init);
    }) as typeof globalThis.fetch;

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
      rateLimiter: limiter,
    });

    // Fire all 3 calls concurrently
    const p1 = client.fetchFiling('0000320193-23-000106');
    const p2 = client.fetchFiling('0000320193-23-000106');
    const p3 = client.fetchFiling('0000320193-23-000106');

    // Advance enough time for all queued acquires to resolve
    await vi.advanceTimersByTimeAsync(3000);

    await Promise.all([p1, p2, p3]);

    // All 6 fetch calls should have been made
    expect(mockFetch).toHaveBeenCalledTimes(6);

    // Some fetch calls should be delayed (tokens had to refill for 3 of 6 acquires)
    const startTime = fetchTimestamps[0]!;
    const delayedCalls = fetchTimestamps.filter((ts) => ts > startTime);
    expect(delayedCalls.length).toBeGreaterThan(0);

    limiter.dispose();
  });

  it('should not add delay when requests fit within bucket capacity', async () => {
    // Default rate limiter (10/s), 2 fetchFiling calls = 4 acquires, all fit in capacity=10
    const limiter = new TokenBucketRateLimiter(); // capacity=10, refillRate=10

    const fetchTimestamps: number[] = [];
    const baseMockFetch = createUrlAwareMockFetch();
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchTimestamps.push(Date.now());
      return (baseMockFetch as ReturnType<typeof vi.fn>).getMockImplementation()!(url, init);
    }) as typeof globalThis.fetch;

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
      rateLimiter: limiter,
    });

    const filing1 = await client.fetchFiling('0000320193-23-000106');
    const filing2 = await client.fetchFiling('0000320193-23-000106');

    expect(filing1.accessionNumber).toBe('0000320193-23-000106');
    expect(filing2.accessionNumber).toBe('0000320193-23-000106');

    // All 4 fetches should happen at time=0 (no waiting needed)
    expect(fetchTimestamps.length).toBe(4);
    for (const ts of fetchTimestamps) {
      expect(ts).toBe(fetchTimestamps[0]);
    }

    limiter.dispose();
  });

  it('should handle 429 retry without double-acquiring rate limiter tokens', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
    const acquireSpy = vi.spyOn(limiter, 'acquire');

    // Mock: first EFTS call returns 429, retry succeeds, then HTML succeeds
    let eftsCallCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('efts.sec.gov')) {
        eftsCallCount++;
        if (eftsCallCount === 1) {
          return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
        }
        return Promise.resolve(new Response(EFTS_JSON, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(FILING_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    }) as typeof globalThis.fetch;

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
      rateLimiter: limiter,
    });

    const promise = client.fetchFiling('0000320193-23-000106');
    // Advance past the Retry-After delay
    await vi.advanceTimersByTimeAsync(3000);
    const filing = await promise;

    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    // acquire() called exactly 2 times (once per fetchWithRetry), NOT 3 times
    expect(acquireSpy).toHaveBeenCalledTimes(2);
    // But fetch was called 3 times (429 + retry + HTML)
    expect(mockFetch).toHaveBeenCalledTimes(3);

    limiter.dispose();
  });

  it('should handle 429 Retry-After delay independent of rate limiter', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });

    // Mock: 429 with Retry-After: 2 on EFTS, then success
    let eftsCallCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('efts.sec.gov')) {
        eftsCallCount++;
        if (eftsCallCount === 1) {
          return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
        }
        return Promise.resolve(new Response(EFTS_JSON, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(FILING_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    }) as typeof globalThis.fetch;

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
      rateLimiter: limiter,
    });

    const promise = client.fetchFiling('0000320193-23-000106');
    await vi.advanceTimersByTimeAsync(5000);
    const filing = await promise;

    // fetchWithRetry handled the retry independently
    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    limiter.dispose();
  });
});

describe('shared rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should enforce combined rate across two clients sharing one limiter', async () => {
    // capacity=3, so 4 acquires (2 per client) exceeds capacity by 1
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 3 });
    const acquireSpy = vi.spyOn(limiter, 'acquire');

    const fetchTimestamps: number[] = [];

    const baseMockFetch1 = createUrlAwareMockFetch();
    const mockFetch1 = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchTimestamps.push(Date.now());
      return (baseMockFetch1 as ReturnType<typeof vi.fn>).getMockImplementation()!(url, init);
    }) as typeof globalThis.fetch;

    const baseMockFetch2 = createUrlAwareMockFetch();
    const mockFetch2 = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchTimestamps.push(Date.now());
      return (baseMockFetch2 as ReturnType<typeof vi.fn>).getMockImplementation()!(url, init);
    }) as typeof globalThis.fetch;

    const client1 = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch1,
      rateLimiter: limiter,
    });
    const client2 = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch2,
      rateLimiter: limiter,
    });

    // Each fetchFiling = 2 acquires, 2 clients = 4 acquires total > capacity of 3
    const p1 = client1.fetchFiling('0000320193-23-000106');
    const p2 = client2.fetchFiling('0000320193-23-000106');

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([p1, p2]);

    // Both clients share the same limiter
    expect(acquireSpy).toHaveBeenCalledTimes(4);

    // The 4th acquire should have been delayed (proves rate enforcement)
    const startTime = fetchTimestamps[0]!;
    const delayedCalls = fetchTimestamps.filter((ts) => ts > startTime);
    expect(delayedCalls.length).toBeGreaterThan(0);

    limiter.dispose();
  });
});

describe('client dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should dispose owned rate limiter when client.dispose() is called', async () => {
    const mockFetch = createUrlAwareMockFetch();
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    await client.fetchFiling('0000320193-23-000106');
    client.dispose();

    // After dispose, timer count should be 0
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should NOT dispose injected rate limiter when client.dispose() is called', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
    const disposeSpy = vi.spyOn(limiter, 'dispose');

    const mockFetch = createUrlAwareMockFetch();
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
      rateLimiter: limiter,
    });

    await client.fetchFiling('0000320193-23-000106');
    client.dispose();

    // Injected limiter should NOT be disposed
    expect(disposeSpy).not.toHaveBeenCalled();

    // Limiter should still be usable
    await expect(limiter.acquire()).resolves.toBeUndefined();

    limiter.dispose();
  });

  it('should not affect other clients sharing the same injected limiter when one client disposes', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });

    const mockFetch1 = createUrlAwareMockFetch();
    const mockFetch2 = createUrlAwareMockFetch();

    const client1 = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch1,
      rateLimiter: limiter,
    });
    const client2 = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch2,
      rateLimiter: limiter,
    });

    await client1.fetchFiling('0000320193-23-000106');
    client1.dispose(); // Should NOT dispose shared limiter

    // client2 should still work
    const filing = await client2.fetchFiling('0000320193-23-000106');
    expect(filing.accessionNumber).toBe('0000320193-23-000106');

    limiter.dispose();
  });
});
