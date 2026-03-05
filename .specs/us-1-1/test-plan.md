# Test Plan: US-1.1 — Fetch a Filing by Accession Number

## Overview

This plan covers the `createEdgarClient(options).fetchFiling(accessionNumber)` function, which:

1. Accepts an accession number (e.g., `0000320193-23-000106`)
2. Validates format against `/^\d{10}-\d{2}-\d{6}$/` (after trimming whitespace)
3. Queries the SEC EFTS search-index API (`https://efts.sec.gov/LATEST/search-index?q="{accessionNumber}"`) to discover CIK, form type, filing date, and primary document filename
4. Identifies the primary document as the hit with `sequence === 1`; extracts filename from `_id` field (split on `:`)
5. Fetches the primary HTML document from `https://www.sec.gov/Archives/edgar/data/{CIK-no-leading-zeros}/{accession-no-dashes}/{primaryDocumentFilename}`
6. Returns a `RawFiling` with metadata and raw HTML
7. Retries 429/503 with exponential backoff (3 attempts, 1s base delay) — **independently for both EFTS and HTML fetch**
8. Non-retryable status codes (400, 403, 404, 500, etc.) throw `EdgarNetworkError` immediately
9. Sends a proper `User-Agent` header on every request

All tests use vitest with globals enabled. The injectable `fetch` option on `EdgarClientOptions` is the primary mechanism for test doubles.

### Key Implementation Files (per design doc)

| File | Purpose |
|------|---------|
| `src/client/accession-number.ts` | `parseAccessionNumber()` — validation and parsing |
| `src/client/fetch-with-retry.ts` | `fetchWithRetry()` — generic retry wrapper |
| `src/client/edgar-client.ts` | `createEdgarClient()` factory, `fetchFiling()`, `resolveFilingMetadata()` |
| `src/client/types.ts` | `EdgarClientOptions`, `RawFiling`, `FormType`, `EdgarNetworkError`, `ParsedAccession`, `FilingMetadata` |

---

## 1. BDD Acceptance Criteria

### AC-1: Fetch a filing by accession number (happy path)

```gherkin
Scenario: Successfully fetch a 10-K filing
  Given an EdgarClient configured with userAgent "TestCo test@example.com"
  And EFTS returns a search-index response for "0000320193-23-000106" with:
    | field     | value                                           |
    | _id       | 0000320193-23-000106:aapl-20230930.htm           |
    | ciks      | ["0000320193"]                                  |
    | form      | 10-K                                            |
    | file_date | 2023-11-03                                      |
    | sequence  | 1                                               |
  And EDGAR Archives returns HTML content for the constructed document URL
  When I call fetchFiling("0000320193-23-000106")
  Then the result should contain:
    | field                    | value                    |
    | accessionNumber          | 0000320193-23-000106     |
    | cik                      | 0000320193               |
    | formType                 | 10-K                     |
    | filingDate               | 2023-11-03 (PlainDate)   |
    | primaryDocumentFilename  | aapl-20230930.htm        |
    | html                     | <non-empty string>       |
    | fetchedAt                | <recent Temporal.Instant>|
  And the User-Agent header "TestCo test@example.com" was sent on all requests
  And the EFTS request URL was "https://efts.sec.gov/LATEST/search-index?q=%220000320193-23-000106%22"
  And the HTML fetch URL was "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm"
```

### AC-2: User-Agent header is required and sent

```gherkin
Scenario: User-Agent header included on every request
  Given an EdgarClient with userAgent "MyCorp admin@mycorp.com"
  When I call fetchFiling with any valid accession number
  Then the EFTS request includes header User-Agent = "MyCorp admin@mycorp.com"
  And the HTML fetch request includes header User-Agent = "MyCorp admin@mycorp.com"
```

### AC-3: Filing not found (EFTS returns 0 hits)

```gherkin
Scenario: Accession number does not exist in EDGAR
  Given EFTS returns a response with hits.total.value = 0
  When I call fetchFiling("9999999999-99-999999")
  Then an EdgarNetworkError is thrown with statusCode 404
  And the error's accessionNumber is "9999999999-99-999999"
```

### AC-4: Rate limited then succeeds (429 retry)

```gherkin
Scenario: EFTS returns 429 on first attempt, succeeds on retry
  Given EFTS returns 429 with Retry-After: 2 on the first request
  And EFTS returns 200 with valid search-index JSON on the second request
  And EDGAR Archives returns 200 with HTML
  When I call fetchFiling("0000320193-23-000106")
  Then the filing is returned successfully
  And exactly 3 fetch calls were made (2 EFTS + 1 HTML)
```

### AC-5: All retries exhausted (persistent 503)

```gherkin
Scenario: EFTS is down — 503 on all attempts
  Given EFTS returns 503 on all 3 attempts
  When I call fetchFiling("0000320193-23-000106")
  Then an EdgarNetworkError is thrown with statusCode 503
  And the error's accessionNumber is "0000320193-23-000106"
```

### AC-6: Accession number validation

```gherkin
Scenario: Empty accession number
  When I call fetchFiling("")
  Then an error is thrown indicating invalid accession number
  And no HTTP requests are made

Scenario: Malformed accession number
  When I call fetchFiling("not-an-accession-number")
  Then an error is thrown indicating invalid accession number
  And no HTTP requests are made

Scenario: Whitespace-padded accession number (trimmed)
  When I call fetchFiling("  0000320193-23-000106  ")
  Then the accession is trimmed and processed normally
```

### AC-7: Filing-agent CIK mismatch

```gherkin
Scenario: Accession prefix CIK differs from company CIK
  Given accession "0000950170-23-035122" (filing agent CIK 0000950170)
  And EFTS returns ciks: ["0000320193"] (Apple's CIK)
  When I call fetchFiling("0000950170-23-035122")
  Then the RawFiling.cik is "0000320193" (from EFTS, not accession prefix)
  And the HTML fetch URL uses CIK "320193" in the path
```

---

## 2. Unit Tests

### 2.1 `parseAccessionNumber` (in `tests/unit/accession-number.test.ts`)

Tests for `parseAccessionNumber()` from `src/client/accession-number.ts`:

| Test | Input | Expected |
|------|-------|----------|
| Valid standard format | `"0000320193-23-000106"` | `{ raw: "0000320193-23-000106", noDashes: "000032019323000106", submitterCik: "0000320193" }` |
| Valid Tesla accession | `"0001318605-24-000046"` | `{ raw: "0001318605-24-000046", noDashes: "000131860524000046", submitterCik: "0001318605" }` |
| Valid filing-agent accession | `"0000950170-23-035122"` | Parsed successfully (submitterCik: `"0000950170"`) |
| Whitespace-padded (trimmed) | `" 0000320193-23-000106 "` | Trims and parses: `raw: "0000320193-23-000106"` |
| Empty string | `""` | Throws `Error` with descriptive message |
| Whitespace-only | `"   "` | Throws (empty after trim) |
| Missing dashes | `"000032019323000106"` | Throws (fails regex) |
| Too few segments | `"0000320193-23"` | Throws |
| Too many segments | `"0000320193-23-000106-extra"` | Throws |
| Non-numeric CIK | `"abcdefghij-23-000106"` | Throws |
| Non-numeric year | `"0000320193-XX-000106"` | Throws |
| Non-numeric sequence | `"0000320193-23-ABCDEF"` | Throws |
| Very long string | `"0".repeat(1000)` | Throws |
| Special characters | `"0000320193-23-00010<script>"` | Throws |
| Unicode characters | `"0000320193-23-00010é"` | Throws |
| Null bytes | `"0000320193-23-\x00000106"` | Throws |
| Path traversal | `"../../etc/passwd"` | Throws |
| Newlines | `"0000320193\n-23-000106"` | Throws |
| Leading/trailing dashes | `"-0000320193-23-000106-"` | Throws |
| Smallest valid CIK | `"0000000001-24-000001"` | Accepted |
| Maximum values | `"9999999999-99-999999"` | Accepted (structurally valid) |
| null/undefined | `null as any` | Throws |

### 2.2 `fetchWithRetry` (in `tests/unit/fetch-with-retry.test.ts`)

Tests for `fetchWithRetry()` from `src/client/fetch-with-retry.ts`:

| Test | Scenario | Expected |
|------|----------|----------|
| Success on first attempt | fetch returns 200 | Returns response, 1 call |
| Retry on 429, success on 2nd | 1st → 429, 2nd → 200 | Returns response, 2 calls |
| Retry on 503, success on 3rd | 1st → 503, 2nd → 503, 3rd → 200 | Returns response, 3 calls |
| Exhaust retries on 429 | 429 × 3 | Throws `EdgarNetworkError(429, accession)`, 3 calls |
| Exhaust retries on 503 | 503 × 3 | Throws `EdgarNetworkError(503, accession)`, 3 calls |
| No retry on 404 | 404 | Throws `EdgarNetworkError(404, accession)` immediately, 1 call |
| No retry on 400 | 400 | Throws immediately, 1 call |
| No retry on 403 | 403 | Throws immediately, 1 call |
| No retry on 500 | 500 | Throws immediately, 1 call |
| Retry-After header honored | 429 + `Retry-After: 5` | `retryAfter` is `5` on error; delay used instead of exponential backoff |
| Exponential backoff timing | 429 × 3 with fake timers | 1st wait ~1s, 2nd wait ~2s |
| Network error (fetch throws) | `TypeError: fetch failed` | Error propagates (not wrapped in `EdgarNetworkError`) |
| Abort error | `DOMException('Aborted', 'AbortError')` | Error propagates |
| User-Agent passed through | Any request | `init.headers` contains `User-Agent` |

### 2.3 EFTS Response Parsing (in `tests/unit/edgar-client.test.ts`)

Tests for the internal `resolveFilingMetadata()` logic:

| Test | EFTS Response | Expected |
|------|--------------|----------|
| Standard response with sequence-1 hit | See MOCK_EFTS_RESPONSE below | `FilingMetadata { cik: "0000320193", formType: "10-K", filingDate: "2023-11-03", primaryDocumentFilename: "aapl-20230930.htm" }` |
| Multiple hits, sequence-1 is not first | Sequence-1 hit at index 2 | Correctly selects the sequence-1 hit |
| Multi-CIK response | `ciks: ["0000320193", "0000950170"]` | Uses `ciks[0]` → `"0000320193"` |
| Zero hits | `hits.total.value: 0, hits.hits: []` | Throws `EdgarNetworkError(404, accession)` |
| Hits present but no sequence-1 | All hits have `sequence > 1` | Throws descriptive `Error` |
| _id without colon separator | `_id: "malformed"` | Throws descriptive `Error` |
| _id with empty filename | `_id: "0000320193-23-000106:"` | Throws descriptive `Error` |
| Missing ciks array | `_source` without `ciks` | Throws descriptive `Error` |
| Empty ciks array | `ciks: []` | Throws descriptive `Error` |
| Missing form field | `_source` without `form` | Throws descriptive `Error` |
| Missing file_date | `_source` without `file_date` | Throws descriptive `Error` |
| Amendment form type | `form: "10-K/A"` | `formType: "10-K/A"` (accepted) |
| Unrecognized form type | `form: "4"` | Cast to `FormType` — passes through (no runtime check) |
| Malformed JSON response | Non-JSON body with 200 status | `response.json()` throws — error propagates |

### 2.4 URL Construction (in `tests/unit/edgar-client.test.ts`)

| Test | Input | Expected URL |
|------|-------|-------------|
| EFTS search URL | accession `0000320193-23-000106` | `https://efts.sec.gov/LATEST/search-index?q=%220000320193-23-000106%22` |
| Document URL, standard CIK | CIK `0000320193`, noDashes `000032019323000106`, filename `aapl-20230930.htm` | `https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm` |
| Document URL, smaller CIK | CIK `0001318605` | path contains `1318605` (leading zeros stripped) |
| Document URL, single-digit CIK | CIK `0000000001` | path contains `1` |
| CIK leading-zero stripping | `"0000320193"` → `"320193"` | Correct for URL path |

### 2.5 `EdgarNetworkError` (in `tests/unit/edgar-network-error.test.ts`)

```typescript
describe('EdgarNetworkError', () => {
  it('should have name "EdgarNetworkError"');
  it('should include statusCode and accessionNumber in message');
  it('should be instanceof Error');
  it('should store optional retryAfter');
  it('should have undefined retryAfter when not provided');
  it('should have readonly statusCode, accessionNumber, retryAfter');
});
```

### 2.6 `RawFiling` Assembly (in `tests/unit/edgar-client.test.ts`)

| Test | Scenario | Expected |
|------|----------|----------|
| filingDate is Temporal.PlainDate | `file_date: "2023-11-03"` | `Temporal.PlainDate.from("2023-11-03")` |
| fetchedAt is Temporal.Instant | After fetch completes | `fetchedAt` is a valid `Temporal.Instant`, close to now |
| cik is zero-padded 10-digit | EFTS returns `ciks: ["0000320193"]` | `cik: "0000320193"` (preserved as-is) |
| html contains full response body | Mock HTML response | `html === MOCK_FILING_HTML` |
| accessionNumber matches input | Input `"0000320193-23-000106"` | `accessionNumber: "0000320193-23-000106"` |

---

## 3. Integration Tests

Location: `tests/integration/edgar-client.integration.test.ts`

These tests exercise the full `fetchFiling` flow using an injected mock `fetch` returning realistic EFTS and EDGAR responses.

### 3.1 Full fetchFiling Flow (Happy Path)

```typescript
describe('fetchFiling integration', () => {
  it('should query EFTS, then fetch HTML document, returning complete RawFiling', async () => {
    // Mock fetch sequence:
    //   1st call → EFTS search-index JSON (realistic structure)
    //   2nd call → HTML content from Archives
    // Assert:
    //   - 1st fetch URL targets efts.sec.gov/LATEST/search-index
    //   - 2nd fetch URL targets www.sec.gov/Archives/edgar/data/...
    //   - User-Agent sent on both requests
    //   - All RawFiling fields populated correctly
    //   - filingDate is Temporal.PlainDate
    //   - fetchedAt is Temporal.Instant close to now
    //   - html matches mock HTML content
  });
});
```

### 3.2 EFTS → URL Construction → HTML Pipeline

```typescript
it('should construct correct Archives URL from EFTS metadata', async () => {
  // EFTS returns ciks: ["0000320193"], _id: "...:aapl-20230930.htm"
  // Verify 2nd fetch URL = https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm
});

it('should use CIK from EFTS response, not from accession prefix', async () => {
  // Accession: 0000950170-23-035122 (filing agent)
  // EFTS returns ciks: ["0000320193"] (Apple)
  // Verify 2nd fetch URL uses 320193 in path, not 950170
});
```

### 3.3 Retry Behavior on Transient Failures

```typescript
describe('retry behavior', () => {
  it('should retry EFTS 429 and succeed on second attempt', async () => {
    // 1st call → 429 with Retry-After: 1
    // 2nd call → 200 EFTS JSON
    // 3rd call → 200 HTML
    // Assert: filing returned, 3 total fetch calls
  });

  it('should retry EFTS 503 and succeed on third attempt', async () => {
    // 1st → 503, 2nd → 503, 3rd → 200 EFTS JSON, 4th → 200 HTML
    // Assert: filing returned, 4 total fetch calls
  });

  it('should retry HTML fetch 503 independently from EFTS', async () => {
    // 1st → 200 EFTS JSON
    // 2nd → 503 HTML
    // 3rd → 200 HTML
    // Assert: filing returned, 3 total fetch calls
  });

  it('should exhaust EFTS retries on persistent 429 and throw', async () => {
    // All 3 EFTS calls → 429
    // Assert: EdgarNetworkError(429), 3 total fetch calls, no HTML fetch attempted
  });

  it('should exhaust HTML retries independently after EFTS succeeds', async () => {
    // 1st → 200 EFTS JSON
    // 2nd, 3rd, 4th → 503 HTML
    // Assert: EdgarNetworkError(503), 4 total fetch calls
  });

  it('should use exponential backoff timing', async () => {
    // Use vi.useFakeTimers()
    // 429 × 3 on EFTS
    // Verify delays: ~1s then ~2s
  });

  it('should use Retry-After header value when present', async () => {
    // EFTS returns 429 with Retry-After: 5
    // Use vi.useFakeTimers()
    // Verify 5s delay instead of 1s exponential
  });
});
```

### 3.4 Multiple Sequential Fetches

```typescript
it('should handle multiple sequential fetchFiling calls with different accessions', async () => {
  // Call fetchFiling twice: once for Apple, once for Tesla
  // Each uses different EFTS response data
  // Verify each returns correct independent RawFiling
});
```

### 3.5 EFTS Edge Cases in Integration Context

```typescript
it('should handle EFTS response with multiple hits selecting sequence-1', async () => {
  // EFTS returns 7 hits (primary doc + exhibits)
  // Only sequence-1 hit used for primary document
  // Verify correct filename extracted from _id
});
```

---

## 4. End-to-End Tests

Location: `tests/e2e/edgar-client.e2e.test.ts`

### 4.1 Fetch Known Apple 10-K (Mock E2E)

```typescript
describe('e2e: fetch Apple 10-K', () => {
  it('should fetch Apple 10-K 0000320193-23-000106 with realistic EFTS mock', async () => {
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: createEftsMockFetch({
        accession: '0000320193-23-000106',
        cik: '0000320193',
        formType: '10-K',
        filingDate: '2023-11-03',
        primaryDocument: 'aapl-20230930.htm',
        html: APPLE_10K_FIXTURE_HTML,
      }),
    });
    const filing = await client.fetchFiling('0000320193-23-000106');
    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.cik).toBe('0000320193');
    expect(filing.formType).toBe('10-K');
    expect(filing.filingDate.toString()).toBe('2023-11-03');
    expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
    expect(filing.html).toContain('Apple');
    expect(Temporal.Instant.compare(filing.fetchedAt, Temporal.Now.instant())).toBeLessThanOrEqual(0);
  });
});
```

### 4.2 Filing-Agent CIK Mismatch

```typescript
it('should handle filing where accession CIK differs from company CIK', async () => {
  // Accession 0000950170-23-035122 (filing agent submitter)
  // EFTS returns ciks: ["0000320193"] (Apple)
  // Verify:
  //   - RawFiling.cik = "0000320193" (from EFTS, not accession prefix)
  //   - HTML fetch URL uses CIK 320193 in path, not 950170
  //   - All other fields populated correctly
});
```

### 4.3 Live E2E Test (Manual / Skipped in CI)

```typescript
describe.skip('live EDGAR e2e (manual only)', () => {
  // WARNING: Hits real SEC EDGAR APIs (efts.sec.gov + www.sec.gov)
  // Run manually: npx vitest run tests/e2e/ --grep "live EDGAR"
  //
  // Prerequisites:
  //   - Network access to efts.sec.gov and www.sec.gov
  //   - Proper User-Agent: "Company email@domain"
  //   - Respect 10 req/s rate limit
  //   - Not in CI (skip by default)

  it('should fetch a real filing from SEC EDGAR', async () => {
    const client = createEdgarClient({
      userAgent: 'EdgarDiffTest admin@example.com',
    });
    const filing = await client.fetchFiling('0000320193-23-000106');

    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.cik).toBe('0000320193');
    expect(filing.formType).toBe('10-K');
    expect(filing.filingDate.toString()).toBe('2023-11-03');
    expect(filing.primaryDocumentFilename).toMatch(/\.htm$/);
    expect(filing.html.length).toBeGreaterThan(10_000);
  }, 30_000);

  it('should fetch a filing-agent-submitted filing', async () => {
    // Use an accession where the submitter CIK ≠ company CIK
    // Verify CIK in result is the company CIK, not the agent CIK
  }, 30_000);
});
```

---

## 5. Boundary Conditions

Location: `tests/unit/accession-number.test.ts` (validation boundary cases)

Covered in section 2.1 above. These all test `parseAccessionNumber()` directly and verify that invalid inputs are rejected before any HTTP calls are made.

Additional integration-level boundary tests in `tests/integration/`:

| # | Condition | Scenario | Expected |
|---|-----------|----------|----------|
| B1 | EFTS returns massive JSON | Response with 100+ hits | Still correctly finds sequence-1 |
| B2 | Very large HTML filing | 15MB HTML response | `html` field contains full content |
| B3 | Empty HTML response | EFTS succeeds, HTML body is empty string | `html: ""` (no error — caller's problem) |
| B4 | Non-HTML content type | HTML fetch returns XML/PDF content | Content returned as-is in `html` field |

---

## 6. Error Conditions

### 6.1 Network Timeout / Abort

```typescript
it('should propagate fetch abort errors (not wrapped in EdgarNetworkError)', async () => {
  const mockFetch = vi.fn().mockRejectedValue(
    new DOMException('The operation was aborted', 'AbortError')
  );
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  await expect(client.fetchFiling('0000320193-23-000106'))
    .rejects.toThrow('aborted');
});
```

### 6.2 EFTS Returns HTTP 404

```typescript
it('should throw EdgarNetworkError on EFTS 404', async () => {
  const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  const err = await client.fetchFiling('9999999999-99-999999').catch(e => e);
  expect(err).toBeInstanceOf(EdgarNetworkError);
  expect(err.statusCode).toBe(404);
  expect(err.accessionNumber).toBe('9999999999-99-999999');
});
```

### 6.3 EFTS Returns 200 but Zero Hits (Filing Not Found)

```typescript
it('should throw EdgarNetworkError(404) when EFTS returns zero hits', async () => {
  const mockFetch = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
    { status: 200 }
  ));
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  const err = await client.fetchFiling('9999999999-99-999999').catch(e => e);
  expect(err).toBeInstanceOf(EdgarNetworkError);
  expect(err.statusCode).toBe(404);
});
```

### 6.4 EFTS Returns 429, Then Succeeds

```typescript
it('should retry EFTS 429 and succeed', async () => {
  const mockFetch = createMockFetchSequence([
    { status: 429, body: '', headers: { 'Retry-After': '1' } },
    { status: 200, body: MOCK_EFTS_JSON },
    { status: 200, body: MOCK_FILING_HTML },
  ]);
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  const filing = await client.fetchFiling('0000320193-23-000106');
  expect(filing.accessionNumber).toBe('0000320193-23-000106');
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
```

### 6.5 EFTS Returns 503 × 3 (Exhausted)

```typescript
it('should exhaust retries on persistent EFTS 503', async () => {
  const mockFetch = vi.fn().mockResolvedValue(
    new Response('Service Unavailable', { status: 503 })
  );
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  await expect(client.fetchFiling('0000320193-23-000106'))
    .rejects.toThrow(EdgarNetworkError);
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
```

### 6.6 EFTS Succeeds but HTML Fetch Returns 404

```typescript
it('should throw EdgarNetworkError when HTML document returns 404', async () => {
  const mockFetch = createMockFetchSequence([
    { status: 200, body: MOCK_EFTS_JSON },
    { status: 404, body: 'Not Found' },
  ]);
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  const err = await client.fetchFiling('0000320193-23-000106').catch(e => e);
  expect(err).toBeInstanceOf(EdgarNetworkError);
  expect(err.statusCode).toBe(404);
});
```

### 6.7 Malformed EFTS JSON

```typescript
it('should throw on malformed EFTS JSON response', async () => {
  const mockFetch = vi.fn().mockResolvedValue(
    new Response('not valid json {{{', { status: 200 })
  );
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
});
```

### 6.8 EFTS Hits Present but No Sequence-1

```typescript
it('should throw when EFTS returns hits but none with sequence 1', async () => {
  const noSeq1Response = JSON.stringify({
    hits: {
      total: { value: 3 },
      hits: [
        { _id: 'acc:exhibit1.htm', _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 2 } },
        { _id: 'acc:exhibit2.htm', _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 3 } },
      ],
    },
  });
  const mockFetch = vi.fn().mockResolvedValue(new Response(noSeq1Response, { status: 200 }));
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
});
```

### 6.9 Non-HTML Content Returned As-Is

```typescript
it('should return non-HTML content in html field without error', async () => {
  const xmlContent = '<?xml version="1.0"?><filing><data>test</data></filing>';
  const mockFetch = createMockFetchSequence([
    { status: 200, body: MOCK_EFTS_JSON },
    { status: 200, body: xmlContent, headers: { 'Content-Type': 'application/xml' } },
  ]);
  const client = createEdgarClient({ userAgent: 'Test test@test.com', fetch: mockFetch });
  const filing = await client.fetchFiling('0000320193-23-000106');
  expect(filing.html).toBe(xmlContent);
});
```

---

## 7. Test Data

### 7.1 Mock EFTS Search-Index Response

The primary mock representing a realistic EFTS response:

```typescript
/** Realistic EFTS search-index response for Apple 10-K. */
const MOCK_EFTS_RESPONSE = {
  hits: {
    total: { value: 7, relation: 'eq' },
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
      {
        _id: '0000320193-23-000106:aapl-20230930_g1.jpg',
        _source: {
          ciks: ['0000320193'],
          root_forms: ['10-K'],
          form: '10-K',
          file_date: '2023-11-03',
          adsh: '0000320193-23-000106',
          sequence: 2,
        },
      },
      // Additional exhibit hits omitted for brevity
    ],
  },
};

const MOCK_EFTS_JSON = JSON.stringify(MOCK_EFTS_RESPONSE);
```

### 7.2 Mock HTML Filing Response

```typescript
const MOCK_FILING_HTML = `<!DOCTYPE html>
<html>
<head><title>APPLE INC - 10-K</title></head>
<body>
<div style="font-weight:bold">UNITED STATES SECURITIES AND EXCHANGE COMMISSION</div>
<div>FORM 10-K</div>
<div>Apple Inc.</div>
<h2>Item 1. Business</h2>
<p>Apple Inc. designs, manufactures, and markets smartphones...</p>
<h2>Item 1A. Risk Factors</h2>
<p>The Company's business, reputation, results of operations...</p>
</body>
</html>`;
```

### 7.3 Factory Functions

```typescript
/** Create EdgarClientOptions with test defaults. */
function createTestOptions(
  overrides: Partial<EdgarClientOptions> = {}
): EdgarClientOptions {
  return {
    userAgent: 'TestCo test@example.com',
    maxRequestsPerSecond: 100, // No throttling in tests
    fetch: vi.fn(),
    ...overrides,
  };
}

/** Create a mock fetch that returns responses in sequence. */
function createMockFetchSequence(
  responses: Array<{ status: number; body: string; headers?: Record<string, string> }>
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve(new Response(resp!.body, {
      status: resp!.status,
      headers: resp!.headers,
    }));
  }) as typeof globalThis.fetch;
}

/** Create a mock fetch for successful EFTS + HTML fetch. */
function createEftsMockFetch(opts?: {
  accession?: string;
  cik?: string;
  formType?: string;
  filingDate?: string;
  primaryDocument?: string;
  html?: string;
  additionalHits?: Array<Record<string, unknown>>;
}): typeof globalThis.fetch {
  const accession = opts?.accession ?? '0000320193-23-000106';
  const cik = opts?.cik ?? '0000320193';
  const primaryDoc = opts?.primaryDocument ?? 'aapl-20230930.htm';

  const eftsResponse = {
    hits: {
      total: { value: 1 + (opts?.additionalHits?.length ?? 0), relation: 'eq' },
      hits: [
        {
          _id: `${accession}:${primaryDoc}`,
          _source: {
            ciks: [cik],
            root_forms: [opts?.formType ?? '10-K'],
            form: opts?.formType ?? '10-K',
            file_date: opts?.filingDate ?? '2023-11-03',
            adsh: accession,
            sequence: 1,
          },
        },
        ...(opts?.additionalHits ?? []),
      ],
    },
  };

  return createMockFetchSequence([
    { status: 200, body: JSON.stringify(eftsResponse), headers: { 'Content-Type': 'application/json' } },
    { status: 200, body: opts?.html ?? MOCK_FILING_HTML, headers: { 'Content-Type': 'text/html' } },
  ]);
}
```

### 7.4 Fixture Files (for integration tests)

Integration test fixtures in `tests/integration/fixtures/`:

| File | Description | Source |
|------|-------------|--------|
| `efts-10k-aapl-2023.json` | Real EFTS search-index response for Apple 10-K | Captured from `efts.sec.gov` |
| `efts-10k-tsla-2023.json` | Real EFTS response for Tesla 10-K | Captured from `efts.sec.gov` |
| `10k-aapl-2023.html` | Truncated Apple 10-K HTML (first 50KB) | Captured from EDGAR |
| `10k-tsla-2023.html` | Truncated Tesla 10-K HTML | Captured from EDGAR |

These fixtures are committed to the repo. Captured once from real EDGAR/EFTS responses.

---

## 8. Test File Structure

```
libs/edgar-diff-lib/tests/
├── unit/
│   ├── accession-number.test.ts       # parseAccessionNumber tests (section 2.1)
│   ├── fetch-with-retry.test.ts       # fetchWithRetry tests (section 2.2)
│   ├── edgar-client.test.ts           # EFTS parsing, URL construction, RawFiling assembly (sections 2.3-2.6)
│   └── edgar-network-error.test.ts    # EdgarNetworkError shape tests (section 2.5)
├── integration/
│   ├── edgar-client.integration.test.ts  # Full flow integration tests (section 3)
│   └── fixtures/
│       ├── efts-10k-aapl-2023.json
│       ├── efts-10k-tsla-2023.json
│       ├── 10k-aapl-2023.html
│       └── 10k-tsla-2023.html
└── e2e/
    └── edgar-client.e2e.test.ts       # E2E tests (section 4)
```

---

## 9. Design Decisions Resolved

All open questions from the initial draft are now answered per the implementation design document:

| Question | Answer |
|----------|--------|
| Metadata lookup mechanism | EFTS `search-index` API at `efts.sec.gov/LATEST/search-index` |
| CIK discovery | From EFTS `_source.ciks[0]`, never from accession prefix |
| Retry scope | Independent retry budgets for EFTS and HTML fetch (3 attempts each) |
| Retryable status codes | Only 429 and 503; all others throw immediately |
| Non-HTML content | Returned as-is in `html` field; no Content-Type validation |
| Accession validation | Regex `/^\d{10}-\d{2}-\d{6}$/` after trim |
| CIK format in RawFiling | Zero-padded 10-digit string (e.g., `"0000320193"`) |
| Network errors (fetch throws) | Propagated as-is, not wrapped in EdgarNetworkError |
| Unrecognized form types | Cast to FormType, no runtime check |

---

## 10. Vitest Configuration Notes

- Use `vi.useFakeTimers()` for retry/backoff timing tests to avoid real delays
- Use `vi.fn()` for mock fetch — enables call count and argument assertions via `mockFetch.mock.calls`
- Import `Temporal` from `@js-temporal/polyfill` for date/time assertions
- Tests run with `globals: true` — no explicit vitest imports needed for `describe`/`it`/`expect` (but `vi` is a global too)
- Async tests use `async/await` pattern
- Test files per-module (`accession-number.test.ts`, `fetch-with-retry.test.ts`, `edgar-client.test.ts`) align with implementation files for easy navigation
