---
title: "US-1.2: Respect SEC Rate Limits - Implementation Design"
story: US-1.2
epic: edgar-diff-vda
created: "2026-03-06"
status: draft
---

# Implementation Design: US-1.2 Respect SEC Rate Limits

**Companion document**: [Test Plan](test-plan.md) — 10 BDD scenarios, 16 new tests, boundary/error condition catalog.

## 1. Approach

Draft implementations of the rate limiter, EDGAR client, and supporting types already exist from a prior session. The strategy is to **review, fix, and harden** the existing code rather than rewrite from scratch.

Key observations from reviewing the draft code:

1. **TokenBucketRateLimiter** (`rate-limiter.ts`) - Solid token-bucket implementation. Uses `Date.now()` for timing, which couples it to the wall clock but is fine for production. The `protected sleep()` hook enables test overrides. No issues found.

2. **EdgarClient** (`edgar-client.ts`) - Functional but has several issues to address:
   - Uses a speculative EDGAR index JSON endpoint (`{accession}-index.json`) whose response schema (`filedAt`, `primaryDocUrl`, `rootUrl`) is not the real EDGAR API. The real EDGAR submissions API is at `data.sec.gov/submissions/CIK{cik}.json` and the filing index is at `Archives/edgar/data/{cik}/{accession}/index.json` with different field names.
   - CIK extraction from accession number is incorrect: the first segment of an accession number is the filer CIK, but stripping leading zeros may lose necessary padding for URL construction.
   - The `fetchFiling` function makes 2 HTTP requests (index + document) but the PRD says callers provide accession numbers and the library fetches the primary document. We need to validate the actual EDGAR URL patterns.
   - `sleep()` is a module-level function, separate from the rate limiter's `sleep()` - this is correct (backoff sleep vs. rate-limit sleep).

3. **Types** (`types.ts`) - Well-defined. `EdgarNetworkError` correctly carries `statusCode`, `accessionNumber`, and optional `retryAfter`. `RawFiling` uses Temporal API per architecture doc. `EdgarClientOptions` has injectable `fetch` for testing.

4. **Barrel export** (`index.ts`) - Currently empty (`export {}`). Needs to export public API surface per architecture doc section 5.

5. **Tests** - Good coverage of core scenarios (burst, exhaustion, refill, retry, backoff, Retry-After header). Some timing-sensitive tests may be fragile with `vi.advanceTimersByTimeAsync`.

## 2. Files to Create/Modify

### Modify: `libs/edgar-diff-lib/src/client/rate-limiter.ts`
- **No changes needed.** The token-bucket implementation is correct and well-tested.

### Modify: `libs/edgar-diff-lib/src/client/types.ts`
- **No changes needed.** Types are well-defined and match the architecture spec.

### Modify: `libs/edgar-diff-lib/src/client/edgar-client.ts`
Changes needed:
- **Fix EDGAR URL construction**: Validate against real EDGAR URL patterns. The filing index JSON URL should use the correct EDGAR endpoint. Current code assumes a `{accession}-index.json` endpoint that may not exist in that format.
- **Fix CIK handling**: The CIK is the first 10 digits of the accession number. For URL construction, it needs to be used without leading zeros in some paths (`Archives/edgar/data/{cik-no-pad}/`) but with padding in others (`submissions/CIK{cik-padded}.json`).
- **Add Accept header**: Include `Accept: application/json` for JSON endpoints and `Accept: text/html` for document fetches, alongside the required `User-Agent`.
- **Improve error context**: Include the URL in `EdgarNetworkError` messages for debugging.
- **Add request timeout**: Consider adding an abort signal with a configurable timeout to prevent hanging on unresponsive EDGAR endpoints.

### Modify: `libs/edgar-diff-lib/src/index.ts`
- Export `createEdgarClient` from `./client/edgar-client.js`
- Export types: `EdgarClientOptions`, `RawFiling`, `FormType`, `EdgarNetworkError` from `./client/types.js`
- Export `TokenBucketRateLimiter` only if it should be part of the public API (architecture doc does not list it as public - keep internal)

### Modify: `libs/edgar-diff-lib/tests/unit/edgar-client.test.ts`
- Update mock responses if EDGAR URL patterns change
- Add test: network error includes URL context
- Add test: concurrent `fetchFiling` calls share the rate limiter
- Add test: `fetchFiling` with malformed accession number throws descriptive error

### Create: `libs/edgar-diff-lib/tests/helpers/mock-fetch.ts`
- Extract `createMockFetch` from `edgar-client.test.ts` into a shared helper for reuse across unit and integration tests. (Per tester recommendation.)

### Create: `libs/edgar-diff-lib/tests/unit/edgar-network-error.test.ts`
- Tests for `EdgarNetworkError` structural properties: `name`, `message`, `instanceof Error`, `retryAfter` undefined when omitted. (Tester cases E1-E4.)

### Create: `libs/edgar-diff-lib/tests/integration/client-rate-limiting.test.ts`
- Integration tests verifying rate limiter gates client requests, retry respects rate limiter, independent client instances, and sequential filing fetches. (Tester cases I1-I4.)

### Modify: `libs/edgar-diff-lib/tests/unit/rate-limiter.test.ts`
- Add partial refill test (U5), concurrent acquires (U6), fractional tokens with maxRPS=1 (U7). Existing 4 tests unchanged.

## 3. Interfaces and Types

All existing type definitions are correct per the architecture doc. No changes needed.

```typescript
// EdgarClientOptions - correct as-is
interface EdgarClientOptions {
  userAgent: string;                    // SEC-required: "Company Name email@example.com"
  maxRequestsPerSecond?: number;        // Default: 10
  fetch?: typeof globalThis.fetch;      // Injectable for testing
}

// EdgarNetworkError - correct as-is
class EdgarNetworkError extends Error {
  readonly statusCode: number;
  readonly accessionNumber: string;
  readonly retryAfter?: number;
}

// RawFiling - correct as-is, uses Temporal API
interface RawFiling {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  html: string;
  fetchedAt: Temporal.Instant;
}

// New: connection-level errors distinct from HTTP errors
class EdgarConnectionError extends EdgarNetworkError {
  constructor(
    accessionNumber: string,
    cause: Error,  // Original TypeError from fetch
  ) {
    super(0, accessionNumber);
    this.cause = cause;
  }
}

// Public API surface (factory function)
function createEdgarClient(options: EdgarClientOptions): {
  fetchFiling(accessionNumber: string): Promise<RawFiling>;
}
```

### Internal types (not exported)

```typescript
// Already defined in edgar-client.ts - may need field name updates
interface FilingIndex {
  cik: string;
  formType: FormType;
  filingDate: string;
  primaryDocumentFilename: string;
}
```

## 4. Data Flow

```
Caller
  |
  v
createEdgarClient(options)           // Factory: creates rate limiter + closure
  |
  v
fetchFiling(accessionNumber)         // Public method
  |
  +-- Derive CIK and paths from accession number
  |
  +-- fetchWithRateLimit(indexUrl)    // Step 1: Get filing metadata
  |     |
  |     +-- rateLimiter.acquire()    // Block until token available
  |     +-- fetch(url, headers)      // Actual HTTP call
  |     +-- if 429/503:
  |     |     +-- parse Retry-After header
  |     |     +-- sleep(retryAfter || exponentialBackoff)
  |     |     +-- retry (up to MAX_RETRIES=3)
  |     +-- if other error: throw EdgarNetworkError
  |     +-- if ok: return Response
  |
  +-- Parse index response -> extract metadata
  |
  +-- fetchWithRateLimit(documentUrl) // Step 2: Get HTML content
  |     (same flow as above)
  |
  +-- Construct and return RawFiling
```

### Rate Limiting Flow Detail

```
acquire()
  |
  +-- refill(): add elapsed_ms * (maxRPS / 1000) tokens, cap at maxRPS
  |
  +-- tokens >= 1?
  |     YES: consume token, return immediately
  |     NO:  calculate wait = ceil((1 - tokens) / refillRate)
  |           sleep(waitMs)
  |           refill() again
  |           consume token
```

### Retry + Backoff Flow Detail

```
fetchWithRateLimit(url, accessionNumber)
  |
  for attempt in 0..MAX_RETRIES:
    |
    +-- await rateLimiter.acquire()     // Rate limit BEFORE each attempt
    +-- response = await fetch(url)
    |
    +-- response.ok? -> return response
    |
    +-- response.status == 429 || 503?
    |     +-- retryAfter = parseRetryAfter(headers)
    |     +-- waitMs = retryAfter ? retryAfter*1000 : BACKOFF_BASE * 2^attempt
    |     +-- await sleep(waitMs)
    |     +-- continue to next attempt
    |
    +-- other status? -> throw EdgarNetworkError (non-retryable)
  |
  throw lastError  // All retries exhausted
```

**Key design decisions**:

1. The rate limiter `acquire()` is called *before each retry attempt*, not just the first. This ensures that even retries respect the SEC rate limit. This is correct behavior - a 429 response means we're already hitting limits, so we should re-acquire a token before retrying.

2. The backoff sleep and rate-limiter `acquire()` are **independent waits**. After a long backoff (e.g., 5s Retry-After), the bucket will have refilled, so the subsequent `acquire()` is effectively free. This is correct - the backoff respects the server's request to wait, and the rate limiter ensures we don't burst after the backoff. They serve different purposes and should not be combined.

## 5. Dependencies

### Runtime Dependencies (already in project)
- `@js-temporal/polyfill` - Temporal API for dates/timestamps (used in `RawFiling`)

### No New Dependencies Required
- Rate limiting: Custom token-bucket implementation (no external library needed)
- HTTP: Uses the standard `fetch` API (Node.js 18+ built-in)
- Retry/backoff: Simple loop with `setTimeout` (no external library needed)

### Dev Dependencies (already in project)
- `vitest` - Test framework
- `typescript` - Type checking

## 6. Edge Cases

### Rate Limiter
| Edge Case | Handling |
|-----------|----------|
| Concurrent callers exhaust bucket simultaneously | `acquire()` is async but not locked - two callers could both see tokens >= 1 and consume, potentially going negative. **Acceptable**: the bucket self-corrects on next refill; worst case is one extra request per burst. True mutex would add complexity with minimal benefit. |
| `maxRequestsPerSecond` set to 0 or negative | Currently unhandled. **Fix**: Validate in `createEdgarClient` and throw if <= 0. (Confirmed by tester as potential bug B3/B4.) |
| Clock jumps (NTP correction, suspend/resume) | `Date.now()` monotonicity is not guaranteed. A backward jump would compute negative elapsed time, adding negative tokens via `elapsed * refillRate`. This *reduces* the token count, potentially starving the limiter until real time catches up. `Math.min` cap prevents overflow but not underflow. **Acceptable risk**: SEC rate limit enforcement is best-effort; a brief burst after clock correction is unlikely to trigger 429. **Action**: Add a code comment documenting this behavior and clamp `elapsed` to `Math.max(0, elapsed)` in `refill()` as a low-cost guard. |

### HTTP Client
| Edge Case | Handling |
|-----------|----------|
| Network timeout / DNS failure | Currently unhandled - `fetch()` throws a `TypeError`. **Fix**: Catch fetch-level errors and wrap in a new `EdgarConnectionError` subclass (extends `EdgarNetworkError`) to distinguish network failures from HTTP errors. Using `statusCode: 0` could be confused with a real HTTP response. `EdgarConnectionError` carries the original `cause` for debugging. |
| Retry-After header with date format | `parseRetryAfter` only handles numeric seconds. HTTP spec allows dates. **Acceptable**: SEC EDGAR uses numeric values in practice. |
| Retry-After header with very large value | No cap on wait time. **Fix**: Cap `retryAfter` at a reasonable maximum (e.g., 60 seconds) to prevent indefinite blocking. |
| Negative `Retry-After` value (e.g., `-1`) | `parseRetryAfter` returns the negative number — `Number.isFinite(-1)` is true. **Fix**: Add `seconds > 0` check in `parseRetryAfter`. (Identified by tester as ERR4.) |
| EDGAR returns redirect (301/302) | `fetch()` follows redirects by default. No special handling needed. |
| EDGAR returns HTML error page instead of JSON | `response.json()` would throw. **Fix**: Wrap JSON parse in try/catch, throw descriptive error. |
| Accession number in wrong format | CIK extraction uses string splitting which could produce garbage. **Fix**: Validate accession number format with regex before proceeding. |
| Empty or null response body | `response.text()` returns empty string, `response.json()` throws. The `response.ok` check ensures we only parse successful responses. |

### Concurrency
| Edge Case | Handling |
|-----------|----------|
| Multiple `createEdgarClient` instances | Each has its own rate limiter. If callers create multiple instances, total request rate exceeds 10/s. **Documented**: Architecture note says callers can inject shared rate limiter if needed. Current design is per-instance. |
| Parallel `fetchFiling` calls on same client | Correctly serialized through shared `rateLimiter.acquire()`. Each call waits its turn. |

## 7. Open Questions

1. **EDGAR URL patterns**: The current `fetchFiling` implementation assumes a specific index JSON endpoint (`{accession}-index.json`). Need to validate this against the actual EDGAR API. The real EDGAR filing index may be at a different URL or have different response field names. **Action**: Test against a real EDGAR endpoint before finalizing.

2. **Should `fetchFiling` require CIK as a separate parameter?** Currently, CIK is extracted from the accession number's first segment. However, the accession number's first segment is the *filer* CIK, which may differ from the *subject* CIK. The PRD says callers provide accession numbers only. **Recommendation**: Keep current approach (CIK from accession number) since it matches the PRD's API surface.

3. **Should the rate limiter be exposed publicly?** The architecture doc section 5 does not list `TokenBucketRateLimiter` in public exports. However, the PRD note on US-1.2 says "allowing callers to inject their own client if they need different behavior (e.g., a shared rate limiter across multiple library instances)." **Recommendation**: Keep the rate limiter internal for now; if shared-limiter use cases emerge, expose a `RateLimiter` interface (not the concrete class) in a future iteration.

4. **Abort/cancellation support**: Should `fetchFiling` accept an `AbortSignal` for cancellation? This would be useful for long-running operations but adds API surface. **Recommendation**: Defer to a follow-up issue unless the tester flags it as needed for testability.

5. **Logging/observability**: Should rate-limit waits and retries be logged? The architecture doc defines a `Logger` interface for the parser but not the client. **Recommendation**: Add optional `logger` to `EdgarClientOptions` for retry/backoff visibility, but defer to implementation phase.
