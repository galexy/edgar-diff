import { createEdgarClient, TokenBucketRateLimiter } from '@edgar-diff/lib';
import type { RateLimiter } from '@edgar-diff/lib';

/** Shared rate limiter — singleton across the app. */
let sharedRateLimiter: RateLimiter | null = null;

export function getSharedRateLimiter(): RateLimiter {
  if (!sharedRateLimiter) {
    sharedRateLimiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
  }
  return sharedRateLimiter;
}

/** Reset for testing only. */
export function _resetSharedRateLimiter(): void {
  sharedRateLimiter = null;
}

/**
 * Creates a fetch wrapper that rewrites SEC URLs to Worker proxy routes.
 *
 * The EdgarClient internally hits:
 *   - https://efts.sec.gov/LATEST/... → rewritten to /api/sec/efts/...
 *   - https://www.sec.gov/Archives/... → rewritten to /api/sec/archives/...
 *
 * The Worker proxy adds User-Agent headers required by SEC.
 */
export function createProxiedFetch(): typeof globalThis.fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    let proxiedUrl = url;
    if (url.startsWith('https://efts.sec.gov/LATEST/')) {
      proxiedUrl = url.replace('https://efts.sec.gov/LATEST/', '/api/sec/efts/');
    } else if (url.startsWith('https://www.sec.gov/Archives/')) {
      proxiedUrl = url.replace('https://www.sec.gov/Archives/', '/api/sec/archives/');
    }

    // Strip User-Agent from client-side fetch (browser forbids it;
    // the Worker proxy adds it server-side)
    const headers = new Headers(init?.headers);
    headers.delete('User-Agent');

    return globalThis.fetch(proxiedUrl, { ...init, headers });
  };
}

/**
 * Create an EdgarClient configured for browser use with proxy routing.
 * Shares a single rate limiter across all instances.
 */
export function createProxiedEdgarClient() {
  return createEdgarClient({
    userAgent: '', // Worker proxy injects the real User-Agent
    rateLimiter: getSharedRateLimiter(),
    fetch: createProxiedFetch(),
  });
}
