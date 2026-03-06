---
title: "Test Plan: US-1.2 Respect SEC Rate Limits"
story: US-1.2
created: "2026-03-06"
status: draft
---

# Test Plan: US-1.2 — Respect SEC Rate Limits

## 1. Scope

This plan covers testing for the `TokenBucketRateLimiter` and `createEdgarClient` (rate-limiting and retry behavior). It does NOT cover filing parsing, diff logic, or full end-to-end EDGAR network tests.

Units under test:
- `libs/edgar-diff-lib/src/client/rate-limiter.ts` — `TokenBucketRateLimiter`
- `libs/edgar-diff-lib/src/client/edgar-client.ts` — `createEdgarClient` (specifically `fetchWithRateLimit` behavior)
- `libs/edgar-diff-lib/src/client/types.ts` — `EdgarNetworkError`

---

## 2. BDD Acceptance Criteria

### AC-1: Enforces maximum 10 requests/second to EDGAR endpoints

**Scenario 1: Burst within limit**
- **Given** a client configured with default 10 req/s
- **When** 10 requests are made in rapid succession
- **Then** all 10 proceed without delay

**Scenario 2: Burst exceeds limit**
- **Given** a client configured with default 10 req/s
- **When** 11 requests are made in rapid succession
- **Then** the 11th request is delayed until a token becomes available (~100ms after the burst)

**Scenario 3: Sustained throughput at limit**
- **Given** a client configured with 10 req/s
- **When** 30 requests are issued continuously
- **Then** throughput averages no more than 10 req/s over the full duration

**Scenario 4: Custom rate limit**
- **Given** a client configured with `maxRequestsPerSecond: 5`
- **When** 6 requests are made in rapid succession
- **Then** the 6th request is delayed (~200ms) and throughput does not exceed 5 req/s

### AC-2: Backs off on 429 or 503 responses

**Scenario 5: Retry on 429**
- **Given** a client making a request
- **When** EDGAR responds with 429
- **Then** the client retries after exponential backoff (1s, 2s, 4s)
- **And** the request eventually succeeds if a retry returns 200

**Scenario 6: Retry on 503**
- **Given** a client making a request
- **When** EDGAR responds with 503
- **Then** the client retries with the same backoff strategy as 429

**Scenario 7: Retry-After header honored**
- **Given** a 429 response includes `Retry-After: 5`
- **When** the client processes the response
- **Then** it waits 5 seconds before retrying (not exponential backoff)

**Scenario 8: Retries exhausted**
- **Given** EDGAR returns 429 on all 3 retry attempts
- **When** the client has exhausted MAX_RETRIES (3)
- **Then** it throws `EdgarNetworkError` with `statusCode: 429`

**Scenario 9: Non-retryable error**
- **Given** EDGAR returns 404 (or 400, 403, 500)
- **When** the client receives the response
- **Then** it throws `EdgarNetworkError` immediately without retrying

### AC-3: Rate limiting is internal to the library

**Scenario 10: Caller transparency**
- **Given** a caller uses `client.fetchFiling(accessionNumber)`
- **When** rate limiting or retries occur
- **Then** the caller only sees the final result (or error after exhaustion)
- **And** the caller does not need to implement any rate-limiting logic

---

## 3. Unit Tests

### 3.1 TokenBucketRateLimiter

All tests use `vi.useFakeTimers()` to control time deterministically.

| # | Test Case | Status |
|---|-----------|--------|
| U1 | Allows burst up to `maxRequestsPerSecond` without delay | Exists |
| U2 | Delays acquisition when tokens exhausted | Exists |
| U3 | Refills tokens over time (full refill after 1s) | Exists |
| U4 | Token count never exceeds `maxTokens` (cap enforcement) | Exists |
| U5 | **Partial refill**: after 500ms at 10 rps, only 5 tokens available | Missing |
| U6 | **Concurrent acquires**: multiple callers waiting simultaneously resolve in FIFO-like order | Missing |
| U7 | **Fractional tokens**: with `maxRequestsPerSecond: 1`, second acquire waits ~1000ms | Missing |
| U8 | **Zero elapsed time**: two acquires at same tick both consume from initial pool | Missing |
| U9 | **Large burst after idle**: limiter idle for 10s, still capped at `maxTokens` on burst | Covered by U4 |

### 3.2 createEdgarClient

| # | Test Case | Status |
|---|-----------|--------|
| C1 | Sends `User-Agent` header on every request | Exists |
| C2 | Returns `RawFiling` with correct fields from happy-path fetch | Exists |
| C3 | Retries on 429 with exponential backoff | Exists |
| C4 | Retries on 503 | Exists |
| C5 | Honors `Retry-After` header | Exists |
| C6 | Throws `EdgarNetworkError` after 3 retries exhausted (429) | Exists |
| C7 | Throws `EdgarNetworkError` immediately on non-retryable status (404) | Exists |
| C8 | Respects custom `maxRequestsPerSecond` (no throw on construction) | Exists |
| C9 | **Retry on 503 then success**: 503 -> 200 yields valid filing | Partially covered by C4 |
| C10 | **Mixed retryable errors**: 429 -> 503 -> 200 across retries | Missing |
| C11 | **Retry-After with non-numeric value**: header like `"abc"` falls back to exponential | Missing |
| C12 | **Network fetch throws** (e.g., DNS failure, connection refused) — error propagates | Missing |
| C13 | **Index fetch fails, doc fetch never attempted** | Missing |
| C14 | **EdgarNetworkError properties**: `statusCode`, `accessionNumber`, `retryAfter`, `name`, `message` all correct | Missing |
| C15 | **Backoff timing**: verify 1s, 2s, 4s exponential progression | Implicit in C3 |
| C16 | **All 3 retries return 503**: throws after exhaustion (same as C6 but for 503) | Missing |

### 3.3 EdgarNetworkError

| # | Test Case | Status |
|---|-----------|--------|
| E1 | `name` is `'EdgarNetworkError'` | Missing |
| E2 | `message` includes status code and accession number | Missing |
| E3 | `instanceof Error` is true | Missing |
| E4 | `retryAfter` is undefined when not provided | Missing |

---

## 4. Integration Tests

These test the boundary between the rate limiter and the EDGAR client working together.

| # | Test Case | Description |
|---|-----------|-------------|
| I1 | **Rate limiter gates client requests** | Issue 15 `fetchFiling` calls with mock fetch; verify the mock is not called more than 10 times in the first second |
| I2 | **Retry respects rate limiter** | Mock returns 429, then 200; verify the retry's `acquire()` call is made (rate limiter still gates retries) |
| I3 | **Multiple clients share nothing** | Two `createEdgarClient` instances each get independent rate limiters; one saturated client doesn't block the other |
| I4 | **Sequential filings** | Fetch 3 filings in sequence; all succeed; total mock calls = 6 (2 per filing: index + doc) |

---

## 5. End-to-End (Public API) Tests

These test through the public API surface that consumers would use.

| # | Test Case | Description |
|---|-----------|-------------|
| E2E-1 | **Happy path**: `createEdgarClient({ userAgent, fetch }).fetchFiling(accession)` returns a valid `RawFiling` | Mock fetch returns index JSON + HTML doc |
| E2E-2 | **Error path**: fetch fails with 404, caller catches `EdgarNetworkError` | Verify error is catchable and has expected shape |
| E2E-3 | **Retry path transparent to caller**: 429 on first try, 200 on second — caller gets filing, not error | Verify the retry is invisible |

---

## 6. Boundary Conditions

| # | Condition | Expected Behavior |
|---|-----------|-------------------|
| B1 | `maxRequestsPerSecond: 1` | 1 request immediate, 2nd waits ~1s |
| B2 | `maxRequestsPerSecond: 100` | High burst allowed; still rate-limited beyond 100 |
| B3 | `maxRequestsPerSecond: 0` | Constructor should handle gracefully (throw or default) — **currently unhandled, potential bug** |
| B4 | Negative `maxRequestsPerSecond` | Same as B3 — should throw or default |
| B5 | `Retry-After: 0` | Should retry immediately (0 second wait) |
| B6 | `Retry-After: 999` | Should wait 999 seconds (test with fake timers) |
| B7 | Empty accession number string | Client constructs malformed URL — verify behavior |
| B8 | Accession number with unexpected format | URL construction may produce wrong paths |
| B9 | Index response with missing `primaryDocUrl` | Should handle gracefully (throw or return partial) |
| B10 | HTML response is empty string | `RawFiling.html` is `""` — valid edge case |

---

## 7. Error Conditions

| # | Condition | Expected Behavior |
|---|-----------|-------------------|
| ERR1 | `fetch` throws (network error, DNS, timeout) | Error propagates to caller (not silently swallowed) |
| ERR2 | `fetch` returns malformed JSON for index | JSON parse error propagates |
| ERR3 | 429 with `Retry-After` header containing date string | `parseRetryAfter` returns undefined, falls back to exponential |
| ERR4 | 429 with negative `Retry-After` value | `parseRetryAfter` returns the negative number — **potential bug, should be handled** |
| ERR5 | Response status 500 (server error) | Treated as non-retryable; throws immediately |
| ERR6 | Response status 301/302 (redirect) | Depends on fetch implementation; document behavior |
| ERR7 | Concurrent `fetchFiling` calls where some fail and some succeed | Failures don't corrupt the rate limiter state |

---

## 8. Performance Criteria

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Throughput accuracy | 10 +/- 1 req/s sustained | Issue 50 requests with mock, measure wall clock time with fake timers |
| Burst latency | First `maxTokens` requests complete in < 1ms | Measure time for initial burst |
| Token refill accuracy | After N ms, `floor(N * rate)` tokens available | Exhaust bucket, advance time, verify exact acquire count |
| Backoff timing | Retry delays match 1s * 2^attempt (or Retry-After) | Verify with fake timers that mock is called at correct times |

---

## 9. Test Data and Fixtures

### Mock Fetch Factory

The existing `createMockFetch` helper in `edgar-client.test.ts` is well-designed. It should be extracted to a shared test utility if integration tests also need it.

```typescript
// tests/helpers/mock-fetch.ts
export function createMockFetch(responses: Array<{
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}>): { mockFetch: typeof fetch; calls: () => Array<{ url: string; init?: RequestInit }> };
```

### Standard Fixtures

| Fixture | Description |
|---------|-------------|
| `INDEX_BODY` | Valid filing index JSON (already in tests) |
| `HTML_BODY` | Minimal valid HTML doc body (already in tests) |
| `ACCESSION` | Standard accession number `0000320193-23-000106` (already in tests) |
| `MALFORMED_INDEX` | Index JSON missing required fields |
| `EMPTY_HTML` | Empty string for HTML body edge case |

### Fake Timer Strategy

All timing-dependent tests use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`. Real timers are restored in `afterEach`. This is already the pattern in existing tests.

---

## 10. Review of Existing Tests

### rate-limiter.test.ts (4 tests)

**Coverage**: Good coverage of core token bucket mechanics. Missing:
- Partial refill scenario (U5)
- Concurrent acquire ordering (U6)
- Edge cases with `maxRequestsPerSecond: 1` (U7)

### edgar-client.test.ts (7 tests)

**Coverage**: Good coverage of happy path and retry logic. Missing:
- Network-level errors (fetch throws, not just HTTP errors) (C12)
- Mixed retryable error codes in sequence (C10)
- Invalid `Retry-After` values (C11)
- Index fetch failure before doc fetch (C13)
- Exhausted retries for 503 specifically (C16)
- `EdgarNetworkError` structural assertions (C14)

### Recommended Priority for New Tests

1. **High**: C12 (network errors), C13 (index failure), U5 (partial refill), C14 (error shape)
2. **Medium**: C10 (mixed errors), C11 (bad Retry-After), C16 (503 exhaustion), U6 (concurrency)
3. **Low**: B3/B4 (invalid config), ERR4 (negative Retry-After), boundary edge cases

---

## 11. Test Organization

```
tests/
  unit/
    rate-limiter.test.ts        # TokenBucketRateLimiter unit tests (U1-U9)
    edgar-client.test.ts        # createEdgarClient unit tests (C1-C16)
    edgar-network-error.test.ts # EdgarNetworkError unit tests (E1-E4)
  integration/
    client-rate-limiting.test.ts  # Integration tests (I1-I4)
  helpers/
    mock-fetch.ts               # Shared createMockFetch factory
```
