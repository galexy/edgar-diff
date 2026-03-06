---
title: Test Plan — US-1.2 SEC Rate Limiter
story: US-1.2
created: "2026-03-06"
status: final
---

# Test Plan: Token Bucket Rate Limiter (US-1.2)

## Overview

This plan covers the `TokenBucketRateLimiter` (new file: `rate-limiter.ts`) and its integration into `edgar-client.ts`. Tests follow existing project conventions: vitest with globals, fake timers, mock fetch injection.

Aligned with the implementation design: constructor takes `TokenBucketOptions` (`{ capacity?, refillRate? }`, both default 10), acquire is called once before each `fetchWithRetry` call (retries do NOT re-acquire), and `dispose()` resolves (not rejects) pending waiters.

---

## 1. BDD Acceptance Criteria

### AC-1: Default rate limiting at 10 req/s

```
Given a default EdgarClient (no custom rate limiter)
When 15 acquire() calls are made as fast as possible
Then the first 10 complete immediately (initial bucket capacity)
And the remaining 5 are spaced ~100ms apart (refill interval = ceil(1000/10))
And total elapsed time is >= 500ms
```

### AC-2: 429 response handled by fetchWithRetry, not rate limiter

```
Given a client with a rate limiter
When a request returns 429 with Retry-After: 2
Then fetchWithRetry handles the retry with its own backoff (existing behavior)
And the rate limiter is NOT re-consulted for retry attempts
And subsequent NEW requests still go through acquire()
```

### AC-3: Custom rate limiter injection

```
Given a custom RateLimiter implementation
When passed via EdgarClientOptions.rateLimiter
Then the custom limiter's acquire() is called before each fetchWithRetry
And the default TokenBucketRateLimiter is NOT created
```

### AC-4: Shared rate limiter across client instances

```
Given a single TokenBucketRateLimiter instance
When injected into two separate EdgarClient instances
And both clients make 6 requests simultaneously (12 acquire() calls total)
Then the combined requests respect the shared 10/s limit
And the 11th and 12th acquires are queued until tokens refill
```

---

## 2. Unit Tests: `rate-limiter.ts`

File: `tests/unit/rate-limiter.test.ts`

### 2.1 Token Bucket Core

```
describe('TokenBucketRateLimiter', () => {
  // Use vi.useFakeTimers() in beforeEach, vi.useRealTimers() in afterEach

  describe('construction', () => {
    it('should default to capacity=10, refillRate=10 when no options given')
    it('should accept custom capacity and refillRate (e.g., { capacity: 5, refillRate: 5 })')
    it('should allow independent capacity and refillRate (e.g., { capacity: 2, refillRate: 10 } for fast tests)')
    it('should start with full bucket (tokens = capacity)')
    it('should throw on capacity <= 0')
    it('should throw on refillRate <= 0')
  })

  describe('acquire - tokens available', () => {
    it('should resolve immediately when tokens are available')
    it('should consume one token per acquire call')
    it('should allow N immediate acquires where N = capacity')
  })

  describe('acquire - bucket empty', () => {
    it('should return pending promise when bucket is empty')
    it('should resolve blocked acquire after refill timer tick (~100ms for rate=10)')
    it('should resolve multiple blocked acquires in FIFO order as tokens refill')
  })

  describe('refill behavior (elapsed-time based)', () => {
    it('should refill based on elapsed Date.now() time, not fixed increments')
    it('should add ~1 token per 100ms at rate=10/s')
    it('should not exceed capacity when idle (capped at capacity)')
    it('should resume refilling after bucket was fully drained')
    it('should handle custom rate (e.g., 5/s = refill interval ~200ms)')
    it('should handle event loop stall: 500ms gap adds 5 tokens (capped at capacity)')
    it('should clamp negative elapsed time to 0 (clock jump backward)')
  })

  describe('refill timer lifecycle', () => {
    it('should NOT start refill timer when tokens are available')
    it('should start refill timer on first blocked acquire (ensureRefillTimer)')
    it('should stop refill timer when wait queue drains')
    it('should restart timer if new acquires block after timer stopped')
  })

  describe('concurrent acquires', () => {
    it('should queue 5 acquires when only 3 tokens available, resolve 3 immediately and 2 after refill')
    it('should handle 20 concurrent acquires with capacity 10: first 10 immediate, rest queued')
    it('should maintain FIFO ordering across all queued acquires')
  })

  describe('edge cases', () => {
    it('should handle capacity=1, refillRate=1 (single token, 1s refill interval)')
    it('should handle rapid acquire-wait-acquire cycles')
    it('should handle acquire called after long idle period (bucket fully refilled)')
    it('should handle fractional token accumulation (e.g., 50ms elapsed at rate 10 = 0.5 tokens, not enough for 1)')
  })

  describe('dispose', () => {
    it('should clear the refill interval timer on dispose()')
    it('should resolve all pending waiters on dispose() (not reject)')
    it('should be safe to call dispose() multiple times (idempotent)')
    it('should throw Error("RateLimiter has been disposed") on acquire() after dispose()')
    it('should set disposed flag preventing further timer starts')
  })
})
```

### 2.2 Timer Strategy

All timing tests use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`, following the pattern in `fetch-with-retry.test.ts`. Fake timers control both `Date.now()` and `setInterval`, making the elapsed-time refill logic deterministic.

Example pattern:
```typescript
vi.useFakeTimers();
const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

// Drain bucket
await limiter.acquire(); // token 1
await limiter.acquire(); // token 2

// 3rd acquire should block
const order: number[] = [];
const p3 = limiter.acquire().then(() => order.push(3));
const p4 = limiter.acquire().then(() => order.push(4));

// After 500ms (= ceil(1000/2)), 1 token refills -> p3 resolves
await vi.advanceTimersByTimeAsync(500);
expect(order).toEqual([3]);

// After another 500ms, 1 more token -> p4 resolves
await vi.advanceTimersByTimeAsync(500);
expect(order).toEqual([3, 4]);

limiter.dispose();
vi.useRealTimers();
```

---

## 3. Unit Tests: Updated `edgar-client.ts`

File: `tests/unit/edgar-client.test.ts` (extend existing)

### 3.1 Rate Limiter Integration

```
describe('rate limiter integration', () => {
  it('should call rateLimiter.acquire() before each fetchWithRetry call')
  it('should create a default TokenBucketRateLimiter when none provided')
  it('should use the injected rateLimiter when provided in options')
  it('should call acquire() exactly twice for a fetchFiling call (EFTS + HTML)')
  it('should call acquire() before fetch, not after (ordering via mock call sequence)')
  it('should propagate errors from rateLimiter.acquire() to caller')
  it('should expose dispose() on returned client object')
  it('should only dispose rate limiter if client created it (ownsLimiter flag)')
  it('should NOT dispose an injected rate limiter when client.dispose() is called')
})
```

### 3.2 Retries Do Not Re-Acquire

```
describe('rate limiter and retries', () => {
  it('should NOT call acquire() again when fetchWithRetry retries on 429', async () => {
    // Mock: EFTS returns 429 then 200, HTML returns 200
    // acquire should be called exactly 2 times (once per fetchWithRetry),
    // NOT 3 times (once per fetch attempt including retry)
  })

  it('should NOT call acquire() again when fetchWithRetry retries on 503', async () => {
    // Same as above but for 503
  })
})
```

### 3.3 Mock Strategy

Use a spy/stub `RateLimiter` to verify calls without real timing:

```typescript
const mockRateLimiter = {
  acquire: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
};

const client = createEdgarClient({
  userAgent: 'TestCo test@example.com',
  fetch: mockFetch,
  rateLimiter: mockRateLimiter,
});

await client.fetchFiling('0000320193-23-000106');
expect(mockRateLimiter.acquire).toHaveBeenCalledTimes(2); // EFTS + HTML
```

---

## 4. Integration Tests: Rate Limiter + fetchWithRetry

File: `tests/integration/rate-limiter.integration.test.ts`

### 4.1 Rate-Limited Sequential Fetches

```
describe('rate limiter + client integration', () => {
  it('should space rapid sequential fetchFiling calls when bucket empties', async () => {
    // Create client with small rate limiter ({ capacity: 3, refillRate: 3 })
    // Fire 3 sequential fetchFiling calls (each = 2 acquires = 6 total)
    // First 3 acquires immediate, remaining 3 queued
    // Use fake timers; assert mock fetch timestamps are spaced correctly
  })

  it('should not add delay when requests fit within bucket capacity', async () => {
    // Default rate limiter (10/s), 2 fetchFiling calls = 4 acquires
    // All fit within capacity of 10, so no waiting
    // Verify all fetches happen at time=0
  })

  it('should handle 429 retry without double-acquiring rate limiter tokens', async () => {
    // Mock: first EFTS call returns 429, second succeeds
    // Verify rate limiter was consulted 2 times (not 3)
    // Verify fetchWithRetry still retried correctly
  })

  it('should handle 429 Retry-After delay independent of rate limiter', async () => {
    // Mock: 429 with Retry-After: 2
    // Rate limiter acquire happens BEFORE the fetchWithRetry
    // fetchWithRetry handles the Retry-After delay itself
    // These are independent mechanisms that don't interact
  })
})
```

### 4.2 Shared Limiter Across Clients

```
describe('shared rate limiter', () => {
  it('should enforce combined rate across two clients sharing one limiter', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 4, refillRate: 4 });
    // Create two clients, both using the same limiter
    // Make requests from both clients concurrently
    // Assert combined acquire count respects the shared 4-token budget
  })
})
```

### 4.3 Client Dispose

```
describe('client dispose', () => {
  it('should dispose owned rate limiter when client.dispose() is called')
  it('should NOT dispose injected rate limiter when client.dispose() is called (ownsLimiter=false)')
  it('should not affect other clients sharing the same injected limiter when one client disposes')
})
```

---

## 5. E2E Tests: Full Client Flow

File: `tests/e2e/edgar-client.e2e.test.ts` (extend existing)

### 5.1 Rate-Limited Full Flow

```
describe('e2e: rate limiting', () => {
  it('should fetch multiple filings with default rate limiter (no throttle under capacity)', async () => {
    // Use createEftsMockFetch pattern from existing e2e tests
    // 3 fetchFiling calls = 6 HTTP calls, all under capacity=10
    // Verify all filings returned correctly with no delays
  })

  it('should handle rate limiting under 429 error scenario end-to-end', async () => {
    // Mock: EFTS returns 429 on first call, then succeeds
    // Full flow completes with correct RawFiling
    // Use fake timers for the retry delay
  })

  it('should work with default rate limiter (no explicit injection)', async () => {
    // Create client with NO rateLimiter option
    // Verify fetchFiling works (default TokenBucketRateLimiter created internally)
  })

  it('should clean up via client.dispose() after use', async () => {
    // Create client, fetch a filing, dispose
    // Verify no leaked timers (vi.getTimerCount() === 0 after dispose)
  })
})
```

### 5.2 Live EDGAR (manual only, skip by default)

```
describe.skip('live EDGAR rate limit e2e (manual only)', () => {
  it('should fetch 3 filings sequentially without triggering 429', async () => {
    // Real SEC EDGAR calls
    // Verify rate limiter prevents 429 responses
    // Call client.dispose() after
    // Timeout: 30s
  }, 30_000)
})
```

---

## 6. Boundary Conditions

| Condition | Test Location | Description |
|---|---|---|
| 0 concurrent requests | unit | Acquire on idle limiter resolves immediately |
| 1 concurrent request | unit | Single acquire consumes 1 token, resolves immediately |
| Exactly at capacity | unit | N acquires where N = capacity, all resolve immediately |
| Capacity + 1 | unit | (N+1)th acquire blocks until refill |
| Burst then idle | unit | Drain bucket, wait for full refill, drain again — all immediate |
| Refill timing precision | unit | Advance timers by exactly refill interval, verify 1 token added |
| Refill does not overflow | unit | Leave bucket idle for 10x refill period, verify tokens <= capacity |
| Fractional tokens | unit | 50ms at rate 10/s = 0.5 tokens — not enough for acquire |
| Dispose with pending | unit | Dispose while acquires are queued, verify they resolve (not reject) |
| Dispose then acquire | unit | Acquire after dispose throws Error('RateLimiter has been disposed') |
| Rate = 1/s | unit | Very slow rate: 1 token per second, interval=1000ms |
| Clock jump backward | unit | Negative elapsed time clamped to 0 |
| Large burst (100 acquires) | integration | Verify queuing and FIFO at scale |
| capacity <= 0 | unit | Constructor throws |
| refillRate <= 0 | unit | Constructor throws |
| Client dispose (owned) | unit (client) | Disposes limiter it created |
| Client dispose (injected) | unit (client) | Does NOT dispose injected limiter |

---

## 7. Test Data and Mocks

### Existing Patterns to Reuse

- **`createMockFetchSequence()`**: Already used in all test levels. Reuse for rate limiter integration tests.
- **`createEftsMockFetch()`**: Factory from integration/e2e tests. Reuse for full-flow rate limiter tests.
- **`vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`**: Established pattern in `fetch-with-retry.test.ts`. All rate limiter timing tests must use this. Fake timers control both `Date.now()` and `setInterval`, which is critical since the implementation uses elapsed-time refill via `Date.now()`.
- **`vi.fn()` for mock fetch**: Standard vitest mock pattern used throughout.

### New Mocks Needed

1. **`MockRateLimiter`**: Implements `RateLimiter` interface with `vi.fn()` stubs for `acquire()` and `dispose()`. Used in `edgar-client.test.ts` to verify the client calls the limiter without real timing.

```typescript
function createMockRateLimiter(): RateLimiter & { acquire: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}
```

2. **`createTimingTracker()`**: Helper that records timestamps of mock fetch calls (using `Date.now()` under fake timers) to assert spacing between requests:

```typescript
function createTimingTracker(mockFetch: ReturnType<typeof vi.fn>) {
  const callTimestamps: number[] = [];
  mockFetch.mockImplementation(() => {
    callTimestamps.push(Date.now());
    return Promise.resolve(new Response('ok', { status: 200 }));
  });
  return { callTimestamps };
}
```

### Fixtures

No new fixture files needed. Rate limiter tests are timing/behavior tests, not data-dependent. Reuse existing EFTS/HTML mock data from `edgar-client.test.ts` fixtures.

---

## 8. Interface Contract (Aligned with Implementation Design)

Tests verify against these interfaces:

```typescript
// rate-limiter.ts
interface RateLimiter {
  /** Wait until a request is allowed, then consume one token. */
  acquire(): Promise<void>;
  /** Clean up internal timers. Resolves pending waiters. */
  dispose(): void;
}

interface TokenBucketOptions {
  /** Max tokens (burst capacity). Default: 10 */
  capacity?: number;
  /** Tokens added per second. Default: 10 */
  refillRate?: number;
}

class TokenBucketRateLimiter implements RateLimiter {
  constructor(options?: TokenBucketOptions);
  acquire(): Promise<void>;
  dispose(): void;
}
```

```typescript
// types.ts (updated)
interface EdgarClientOptions {
  userAgent: string;
  /** Custom rate limiter. Default: new TokenBucketRateLimiter() (10 req/s). */
  rateLimiter?: RateLimiter;
  fetch?: typeof globalThis.fetch;
}
```

```typescript
// edgar-client.ts (updated return type)
function createEdgarClient(options: EdgarClientOptions): {
  fetchFiling(accessionNumber: string): Promise<RawFiling>;
  dispose(): void;
};
```

**Key design alignment:**
- Constructor takes `TokenBucketOptions` with separate `capacity` and `refillRate` (both default 10)
- `maxRequestsPerSecond` removed from `EdgarClientOptions` — use `rateLimiter` with custom options instead
- `dispose()` resolves pending waiters (does not reject them)
- `acquire()` after `dispose()` throws `Error('RateLimiter has been disposed')`
- `dispose()` is idempotent (safe to call multiple times)
- Client only disposes limiter it created (`ownsLimiter` flag); injected limiters are caller's responsibility
- Rate limiter called once per `fetchWithRetry` invocation; retries do not re-acquire

---

## 9. Test Execution

```bash
# Unit tests only (rate limiter)
npx vitest run tests/unit/rate-limiter.test.ts

# All unit tests
npx vitest run tests/unit/

# Integration tests (rate limiter)
npx vitest run tests/integration/rate-limiter.integration.test.ts

# E2E tests
npx vitest run tests/e2e/

# All tests
npx vitest run
```

All tests must pass with `vi.useFakeTimers()` — no real-time waits in CI.
