---
title: "US-1.2: Rate Limiter Implementation Design"
story: US-1.2
beads: edgar-diff-0zm
created: "2026-03-06"
status: final
---

# Implementation Design: SEC Rate Limiter (US-1.2)

## 1. Approach

Implement a **token bucket rate limiter** that enforces a maximum of 10 requests/second to EDGAR endpoints. The rate limiter sits in the HTTP client layer (`edgar-client.ts`) so all callers get rate limiting automatically without managing it themselves.

The token bucket algorithm is chosen because:
- It naturally allows short bursts (up to bucket capacity) while enforcing a sustained rate
- It maps cleanly to SEC's "max N requests per second" policy
- Simple to implement, test, and reason about
- Async-friendly: callers `await rateLimiter.acquire()` before each fetch

**Integration point:** The rate limiter runs *before* `fetchWithRetry`. When the bucket is empty, `acquire()` returns a promise that resolves after enough time has passed for a token to refill. The retry logic in `fetchWithRetry` is unchanged --- retries do NOT re-acquire tokens; they use their own Retry-After / exponential backoff.

```
caller -> createEdgarClient -> [acquire token] -> fetchWithRetry -> [retry on 429/503 with own backoff] -> response
```

## 2. Files to Create/Modify

### New: `libs/edgar-diff-lib/src/client/rate-limiter.ts`

Contains:
- `RateLimiter` interface --- minimal contract for dependency injection
- `TokenBucketRateLimiter` class --- default implementation
- `createDefaultRateLimiter()` factory helper

### Modify: `libs/edgar-diff-lib/src/client/types.ts`

- Import and re-export `RateLimiter` type from rate-limiter.ts
- Add optional `rateLimiter?: RateLimiter` field to `EdgarClientOptions`
- Remove the `maxRequestsPerSecond` field (replaced by injectable `rateLimiter` with sensible default)

### Modify: `libs/edgar-diff-lib/src/client/edgar-client.ts`

- Import `RateLimiter` and `TokenBucketRateLimiter`
- In `createEdgarClient()`, use `options.rateLimiter ?? new TokenBucketRateLimiter()` to get or create a rate limiter
- Track `ownsLimiter` flag: only dispose the limiter if the client created it (not if injected)
- Wrap each `fetchWithRetry` call: `await rateLimiter.acquire()` before the fetch
- Add `dispose()` to the returned client object; only disposes the limiter if owned

### Modify: `libs/edgar-diff-lib/src/client/index.ts`

- Export `RateLimiter` type and `TokenBucketRateLimiter` class so callers can create shared instances

## 3. Interfaces and Types

```typescript
// --- rate-limiter.ts ---

/**
 * Minimal interface for rate limiting. Callers can inject their own
 * implementation (e.g., a shared limiter across multiple client instances).
 */
export interface RateLimiter {
  /** Wait until a request is allowed, then consume one token. */
  acquire(): Promise<void>;
  /** Clean up any internal timers. */
  dispose(): void;
}

export interface TokenBucketOptions {
  /** Max tokens (burst capacity). Default: 10 */
  capacity?: number;
  /** Tokens added per second. Default: 10 */
  refillRate?: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefillTimestamp: number;
  private waitQueue: Array<() => void>;
  private refillTimer: ReturnType<typeof setInterval> | null;

  constructor(options: TokenBucketOptions = {}) {
    const { capacity = 10, refillRate = 10 } = options;
    if (capacity <= 0 || refillRate <= 0) {
      throw new Error('capacity and refillRate must be positive numbers');
    }
    this.capacity = capacity;
    this.tokens = capacity; // start full
    this.refillRate = refillRate / 1000; // tokens per ms
    this.lastRefillTimestamp = Date.now();
    this.waitQueue = [];
    this.refillTimer = null;
  }

  private disposed = false;

  async acquire(): Promise<void> {
    if (this.disposed) {
      throw new Error('RateLimiter has been disposed');
    }
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // No tokens available --- wait for next refill
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      this.ensureRefillTimer();
    });
  }

  dispose(): void {
    if (this.disposed) return; // safe to call multiple times
    this.disposed = true;
    if (this.refillTimer !== null) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    // Resolve any remaining waiters so they don't hang
    for (const resolve of this.waitQueue) {
      resolve();
    }
    this.waitQueue = [];
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastRefillTimestamp); // clamp for clock jumps
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillTimestamp = now;
  }

  private ensureRefillTimer(): void {
    if (this.refillTimer !== null) return;
    const intervalMs = Math.ceil(1000 / this.capacity); // ~100ms for 10 req/s
    this.refillTimer = setInterval(() => {
      this.refill();
      while (this.tokens >= 1 && this.waitQueue.length > 0) {
        this.tokens -= 1;
        const resolve = this.waitQueue.shift()!;
        resolve();
      }
      if (this.waitQueue.length === 0 && this.refillTimer !== null) {
        clearInterval(this.refillTimer);
        this.refillTimer = null;
      }
    }, intervalMs);
  }
}
```

```typescript
// --- types.ts (updated EdgarClientOptions) ---

export interface EdgarClientOptions {
  /** User-Agent string. Format: "CompanyName email@domain.com" */
  userAgent: string;
  /**
   * Optional rate limiter. Defaults to a TokenBucketRateLimiter at 10 req/s.
   * Inject a shared instance to coordinate rate limiting across multiple
   * client instances hitting the same EDGAR endpoints.
   * For a custom rate, pass: new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 })
   */
  rateLimiter?: RateLimiter;
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}
```

```typescript
// --- edgar-client.ts (key changes) ---

import { TokenBucketRateLimiter } from './rate-limiter.js';
import type { RateLimiter } from './rate-limiter.js';

export function createEdgarClient(options: EdgarClientOptions) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent;
  const rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter();
  const ownsLimiter = !options.rateLimiter;

  async function fetchFiling(accessionNumber: string): Promise<RawFiling> {
    // ... (existing logic, but each fetchWithRetry call is preceded by acquire)
  }

  function dispose(): void {
    if (ownsLimiter) {
      rateLimiter.dispose();
    }
  }

  return { fetchFiling, dispose };
}
```

## 4. Data Flow

```
1. caller calls client.fetchFiling(accession)
2. resolveFilingMetadata:
   a. await rateLimiter.acquire()     <-- blocks if bucket empty
   b. await fetchWithRetry(eftsUrl)   <-- may retry on 429/503
3. fetch HTML document:
   a. await rateLimiter.acquire()     <-- blocks if bucket empty
   b. await fetchWithRetry(docUrl)    <-- may retry on 429/503
4. return RawFiling
```

Each `fetchWithRetry` attempt (including retries) does NOT re-acquire a token. The rate limiter is called once before the initial fetch attempt. Retries within `fetchWithRetry` are for server errors (429/503) with their own backoff timing, and the Retry-After header already throttles those. Acquiring again on retry would double-penalize.

**Alternative considered:** Acquiring before every retry attempt. Rejected because `fetchWithRetry` already respects Retry-After headers and uses exponential backoff. Adding rate limiter acquisition on retries would create unnecessarily long waits.

## 5. Token Bucket Algorithm Details

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Capacity | 10 (default, configurable via `capacity`) | SEC fair-access policy: max 10 req/s |
| Refill rate | 10 tokens/second (default, configurable via `refillRate`) | Sustained throughput matches capacity |
| Initial tokens | Equal to capacity (full bucket) | Allow immediate burst on startup |
| Refill timer interval | 100ms | `ceil(1000 / capacity)`, balances precision vs overhead |

**Behavior:**
- **Bucket has tokens:** `acquire()` resolves immediately, decrements by 1.
- **Bucket empty:** `acquire()` returns a promise. A refill interval timer starts (if not already running). On each tick, tokens are refilled based on elapsed time, and queued waiters are resolved FIFO.
- **Timer lifecycle:** The interval timer only runs while there are waiters in the queue. It self-stops when the queue drains. This avoids leaked timers when the client is idle.
- **Dispose:** Clears the timer and resolves all pending waiters (so no promises hang forever on shutdown).

**Precision:** Using `Date.now()` for elapsed-time refill (not fixed-increment) avoids drift from event loop delays. If 150ms pass between refill checks, 1.5 tokens are added (not 1.0).

## 6. Edge Cases

### Multiple concurrent requests
The `waitQueue` is FIFO. If 20 requests call `acquire()` simultaneously with a capacity of 10, the first 10 resolve immediately, the remaining 10 queue and resolve at ~100ms intervals as tokens refill.

### Shared rate limiter across instances
Callers can create one `TokenBucketRateLimiter` and pass it to multiple `createEdgarClient` calls. All instances share the same token pool. This is the intended use case for the `rateLimiter` option in `EdgarClientOptions`.

```typescript
const sharedLimiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
const client1 = createEdgarClient({ userAgent: '...', rateLimiter: sharedLimiter });
const client2 = createEdgarClient({ userAgent: '...', rateLimiter: sharedLimiter });
// Both clients share the 10 req/s budget
// client1.dispose() does NOT dispose the shared limiter (caller owns it)
// Caller must dispose sharedLimiter directly when done
```

### Timer cleanup
- `dispose()` clears the interval and resolves pending waiters.
- The refill timer auto-stops when the wait queue is empty (no leaked timers during idle periods).
- Callers should call `client.dispose()` when done to ensure clean shutdown.

### Shared limiter + client dispose safety
If two clients share a limiter, `client.dispose()` does NOT dispose the shared limiter (because `ownsLimiter` is false for injected limiters). The caller who created the shared limiter is responsible for disposing it when all clients are done.

### Clock jumps / event loop stalls
Elapsed-time-based refill handles event loop stalls gracefully: if the loop blocks for 500ms, the next refill adds 5 tokens (capped at capacity). System clock jumps backward could cause negative elapsed time; the refill calculation should clamp `elapsed` to `Math.max(0, elapsed)` to handle this.

### Invalid constructor arguments
Constructor validates that `capacity > 0` and `refillRate > 0`, throwing immediately if not. Non-integer values are allowed (fractional tokens work naturally in the algorithm).

### Acquire after dispose
`acquire()` throws `Error('RateLimiter has been disposed')` if called after `dispose()`. This prevents silent misuse of a dead limiter.

## 7. Testing Strategy

### Unit tests for `TokenBucketRateLimiter`
- **Immediate acquisition:** 10 sequential `acquire()` calls resolve synchronously when bucket is full.
- **Queuing:** 11th `acquire()` blocks until a token refills.
- **Throughput:** N requests over T seconds stays within expected rate (use fake timers).
- **Dispose:** Pending waiters resolve after `dispose()`. Timer is cleared.
- **Shared limiter:** Two consumers sharing one limiter collectively respect the rate.

### Integration tests for `createEdgarClient`
- Mock fetch to count calls and timestamps. Verify that rapid sequential `fetchFiling()` calls are spaced to respect the rate limit.
- Verify `dispose()` is callable and cleans up.

### Testing with fake timers
Use `vi.useFakeTimers()` to control `Date.now()` and `setInterval`. This makes tests deterministic and fast (no real 100ms waits).

## 8. Resolved Design Decisions

1. **`dispose()` added to client return type.** `createEdgarClient` returns `{ fetchFiling, dispose }`. Callers who don't need cleanup can ignore `dispose()`.

2. **`maxRequestsPerSecond` removed from `EdgarClientOptions`.** Replaced by the `rateLimiter` option. Users who want a custom rate pass `new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 })`. Eliminates ambiguity of having two overlapping options.

3. **Retries do NOT re-acquire tokens.** `acquire()` is called once before each `fetchWithRetry` call. Retries within `fetchWithRetry` use their own Retry-After / exponential backoff and do not consult the rate limiter again. The rate limiter has no awareness of HTTP responses.

4. **`dispose()` resolves (not rejects) pending waiters.** On shutdown, in-flight requests complete gracefully rather than throwing. Callers don't need to catch dispose-related errors.

5. **Constructor uses options object.** `TokenBucketRateLimiter({ capacity, refillRate })` instead of a single numeric param. This allows independent control of burst capacity vs sustained rate, and makes tests easier (e.g., `capacity: 2, refillRate: 10` for fast tests).

6. **`acquire()` after `dispose()` throws.** A `disposed` flag prevents silent use of a dead limiter. `acquire()` throws `Error('RateLimiter has been disposed')`. Multiple `dispose()` calls are safe (no-op after first).

7. **Client only disposes owned limiters.** `createEdgarClient` tracks `ownsLimiter = !options.rateLimiter`. `client.dispose()` only calls `rateLimiter.dispose()` if the client created it. Injected (shared) limiters are the caller's responsibility to dispose.

8. **Constructor validates inputs.** `capacity <= 0` or `refillRate <= 0` throws immediately. Non-integer values (e.g., `capacity: 2.5`) are allowed — they work mathematically and the token bucket handles fractional tokens naturally.

## 9. Open Questions

1. **Should the rate limiter log when requests are queued?** Could help with debugging in production. Likely defer to a future observability story.
