# Implementation Design: US-1.1 — Fetch a Filing by Accession Number

## 1. Approach

### Strategy: Two-Phase Fetch via EFTS Search API

Given only an accession number, we must discover the CIK, form type, filing date, and primary document filename before we can fetch the HTML. We use a two-phase approach:

1. **Phase 1 — Metadata Discovery:** Query the SEC EDGAR Full-Text Search (EFTS) API at `https://efts.sec.gov/LATEST/search-index?q="{accessionNumber}"` to resolve metadata.
2. **Phase 2 — HTML Fetch:** Fetch the primary document from `https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-no-dashes}/{primaryDocumentFilename}`.

### Why EFTS over alternatives?

| Approach | Pros | Cons |
|----------|------|------|
| **EFTS `search-index`** | Works with accession number alone; returns CIK, form type, filing date, primary document filename in one call | Covers filings from 2001 onward |
| Filing directory `index.json` | Simple, fast | Requires knowing the CIK in advance — chicken-and-egg problem |
| Submissions API (`data.sec.gov`) | Rich metadata | Requires CIK; only returns ~1000 recent filings per company |
| Extracting CIK from accession prefix | No extra API call | **Unreliable** — the first 10 digits are the *submitter's* CIK, which may be a filing agent, not the company |

**Decision:** Use EFTS as the metadata discovery mechanism. It's the only API that accepts an accession number alone and returns all required metadata fields.

### EFTS Response Format

```
GET https://efts.sec.gov/LATEST/search-index?q="0000320193-23-000106"
```

Response structure (relevant fields):
```json
{
  "hits": {
    "total": { "value": 7 },
    "hits": [
      {
        "_id": "0000320193-23-000106:aapl-20230930.htm",
        "_source": {
          "ciks": ["0000320193"],
          "root_forms": ["10-K"],
          "form": "10-K",
          "file_date": "2023-11-03",
          "adsh": "0000320193-23-000106",
          "sequence": 1
        }
      },
      // ... more hits for exhibits (EX-4.1, EX-21.1, etc.)
    ]
  }
}
```

**Primary document identification:** The hit with `sequence: 1` is the primary document. The filename is extracted from `_id` using `_id.substring(_id.indexOf(':') + 1)` — this handles filenames that may contain `:` characters (unlike `split(':')[1]` which would break).

**CIK extraction:** `_source.ciks[0]` — zero-padded to 10 digits. **Note:** EFTS does not guarantee ordering of the `ciks` array. In practice, `ciks[0]` is the primary filer for the form type shown. This is a documented assumption (see section 7).

---

## 2. Files to Create/Modify

All paths relative to `libs/edgar-diff-lib/`.

### New Files

| File | Purpose |
|------|---------|
| `src/client/types.ts` | Shared types: `EdgarClientOptions`, `RawFiling`, `FormType`, `EdgarNetworkError` |
| `src/client/edgar-client.ts` | `createEdgarClient()` factory and `fetchFiling()` implementation |
| `src/client/fetch-with-retry.ts` | Generic retry wrapper for fetch with exponential backoff |
| `src/client/accession-number.ts` | Accession number validation and parsing utilities |
| `src/client/index.ts` | Barrel export for `client/` module |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Re-export public API from `src/client/index.ts` |

### Test Files (for tester reference, not implemented in this story's coding phase)

| File | Purpose |
|------|---------|
| `tests/unit/edgar-client.test.ts` | Unit tests per test plan |
| `tests/unit/accession-number.test.ts` | Accession number validation/parsing unit tests |
| `tests/unit/fetch-with-retry.test.ts` | Retry logic unit tests |
| `tests/unit/edgar-network-error.test.ts` | Error class shape tests |
| `tests/integration/edgar-client.integration.test.ts` | Integration tests per test plan |

---

## 3. Interfaces and Types

All types align with the architecture document (`.specs/epic-1-library/architecture.md`, section 5).

### `src/client/types.ts`

```typescript
import { Temporal } from '@js-temporal/polyfill';

// --- Form Types ---

export type FormType =
  | '10-K' | '10-K/A'
  | '10-Q' | '10-Q/A'
  | '8-K'  | '8-K/A'
  | '20-F' | '20-F/A'
  | 'S-1'  | 'S-1/A'
  | 'DEF 14A'
  | 'SC 13D' | 'SC 13D/A';

// --- Client Options ---

export interface EdgarClientOptions {
  /** User-Agent string. Format: "CompanyName email@domain.com" */
  userAgent: string;
  /** Max requests per second. Default: 10. (Rate limiter is US-1.2; stored for future use.) */
  maxRequestsPerSecond?: number;
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

// --- Raw Filing ---

export interface RawFiling {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  html: string;
  fetchedAt: Temporal.Instant;
}

// --- Errors ---

export class EdgarNetworkError extends Error {
  readonly name = 'EdgarNetworkError' as const;

  constructor(
    public readonly statusCode: number,
    public readonly accessionNumber: string,
    public readonly retryAfter?: number,
  ) {
    super(`EDGAR returned ${statusCode} for ${accessionNumber}`);
  }
}

// --- Internal Types (not exported from public API) ---

/** Parsed accession number components. */
export interface ParsedAccession {
  /** Raw accession number string (e.g., "0000320193-23-000106") */
  raw: string;
  /** Accession number with dashes removed (e.g., "000032019323000106") */
  noDashes: string;
  /** Submitter CIK from accession prefix (NOT necessarily the company CIK) */
  submitterCik: string;
}

/** Metadata resolved from EFTS search. */
export interface FilingMetadata {
  cik: string;
  formType: string;
  filingDate: string;
  primaryDocumentFilename: string;
}
```

### `src/client/edgar-client.ts` — Public API

```typescript
export function createEdgarClient(options: EdgarClientOptions): {
  fetchFiling(accessionNumber: string): Promise<RawFiling>;
};
```

---

## 4. Data Flow

### Step-by-step: `fetchFiling("0000320193-23-000106")`

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. VALIDATE accession number                                    │
│    Input: "0000320193-23-000106"                                │
│    Regex: /^\d{10}-\d{2}-\d{6}$/                                │
│    Output: ParsedAccession { raw, noDashes: "000032019323000106"│
│            submitterCik: "0000320193" }                         │
│    Error: throw Error if invalid format                         │
├─────────────────────────────────────────────────────────────────┤
│ 2. FETCH METADATA from EFTS                                     │
│    GET https://efts.sec.gov/LATEST/search-index                 │
│        ?q="0000320193-23-000106"                                │
│    Headers: { User-Agent: options.userAgent }                   │
│    Retry: 429/503 with exponential backoff (3 attempts, 1s)     │
├─────────────────────────────────────────────────────────────────┤
│ 3. PARSE EFTS RESPONSE                                          │
│    Find hit with sequence === 1 (primary document)              │
│    Extract:                                                      │
│      cik = hits[0]._source.ciks[0]       → "0000320193"        │
│      formType = hits[0]._source.form      → "10-K"             │
│      filingDate = hits[0]._source.file_date → "2023-11-03"     │
│      filename = _id.substring(_id.indexOf(':')+1) → "aapl-20230930.htm"│
│    Error: throw EdgarNetworkError(404) if no hits               │
│    Error: throw Error if primary doc not found in results       │
├─────────────────────────────────────────────────────────────────┤
│ 4. CONSTRUCT DOCUMENT URL                                        │
│    CIK without leading zeros: "320193"                          │
│    URL: https://www.sec.gov/Archives/edgar/data/320193/         │
│         000032019323000106/aapl-20230930.htm                    │
├─────────────────────────────────────────────────────────────────┤
│ 5. FETCH HTML DOCUMENT                                           │
│    GET {documentUrl}                                             │
│    Headers: { User-Agent: options.userAgent }                   │
│    Retry: 429/503 with exponential backoff (3 attempts, 1s)     │
├─────────────────────────────────────────────────────────────────┤
│ 6. ASSEMBLE RawFiling                                            │
│    {                                                             │
│      accessionNumber: "0000320193-23-000106",                   │
│      cik: "0000320193",                                         │
│      formType: "10-K",                                          │
│      filingDate: Temporal.PlainDate.from("2023-11-03"),         │
│      primaryDocumentFilename: "aapl-20230930.htm",              │
│      html: "<html>...</html>",                                  │
│      fetchedAt: Temporal.Now.instant()                          │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Retry Logic (in `fetch-with-retry.ts`)

```
fetchWithRetry(url, options, { maxAttempts: 3, baseDelayMs: 1000 })

Attempt 1: fetch(url) → if 429/503, wait 1s
Attempt 2: fetch(url) → if 429/503, wait 2s
Attempt 3: fetch(url) → if 429/503, throw EdgarNetworkError

If Retry-After header is present, use that value instead of calculated backoff.
Non-retryable errors (400, 403, 404, 500) throw immediately.
```

---

## 5. Dependencies

### External (already in `package.json`)

| Dependency | Use |
|-----------|-----|
| `@js-temporal/polyfill` | `Temporal.PlainDate` for filing dates, `Temporal.Instant` for `fetchedAt` |

### No new dependencies needed

- Uses native `fetch` (Node 20+ or injected)
- No HTTP client library required
- No URL construction library needed (template literals suffice)

### Internal module imports

- `src/client/*.ts` files import only from within `client/` (per module boundary rules)
- `src/index.ts` re-exports from `src/client/index.ts`

---

## 6. Edge Cases

### 6.1 Invalid Accession Number

- **Empty/whitespace:** Throw `Error('Invalid accession number: ...')`
- **Wrong format:** Validate against `/^\d{10}-\d{2}-\d{6}$/`
- **Special characters / injection attempts:** Rejected by regex before any URL construction
- **Whitespace-padded input:** Trim before validation (document this behavior)

### 6.2 Filing Not Found

- **EFTS returns 0 hits:** Throw `EdgarNetworkError(404, accessionNumber)` — semantically the filing doesn't exist in the EDGAR index
- **EFTS returns hits but no sequence-1 document:** Throw descriptive `Error` — this would indicate an unusual filing structure

### 6.3 Filing Agent CIK Mismatch

- The EFTS response `ciks` array may contain multiple CIKs (filing agent + company)
- **Strategy:** Use the CIK from the first entry in `ciks[]`. EDGAR creates symlinks, so either CIK works in the Archives URL path. The CIK stored in `RawFiling.cik` will be the value from EFTS (the primary filer).

### 6.4 Network Failures

- **Fetch throws (DNS, timeout, etc.):** Let the error propagate — do not wrap `TypeError` in `EdgarNetworkError`. The caller can distinguish network-level from HTTP-level failures.
- **429 / 503:** Retry with exponential backoff up to 3 attempts
- **Other 4xx/5xx:** Throw `EdgarNetworkError` immediately (no retry)
- **EFTS fails but accession is valid:** The error correctly indicates EDGAR is unreachable, not that the filing is invalid

### 6.5 Non-HTML Primary Documents

- Some filings have XML or PDF primary documents (e.g., XBRL, Form 4 XML)
- **Strategy:** Return the content as-is in the `html` field. The `RawFiling` field is named `html` per the architecture, but the caller (parser) will handle content type detection. We don't check `Content-Type` headers.

### 6.6 Malformed EFTS JSON Response

- If `response.json()` throws (malformed JSON), let it propagate as a parse error
- If required fields are missing from the response, throw a descriptive `Error` with context about what was missing

### 6.7 Unrecognized Form Type

- EFTS may return a form type not in our `FormType` union (e.g., `"4"`, `"SD"`)
- **Strategy:** Accept any string from EFTS and cast to `FormType`. The type is a hint for consumers; the client doesn't filter by form type. Type safety is at the TypeScript level, not runtime enforcement.

### 6.8 Filenames Containing Colons

- EFTS `_id` format is `{accession}:{filename}`. If a filename contains `:`, naive `split(':')[1]` would truncate it.
- **Strategy:** Use `_id.substring(_id.indexOf(':') + 1)` to extract everything after the first colon.

### 6.9 Large Filings

- Some 10-K filings are 10-20MB of HTML
- **Strategy:** No streaming; use `response.text()` to read the full body. Node.js handles this fine for typical filing sizes. Streaming would add complexity without clear benefit for US-1.1.

---

## 7. Open Questions

1. **CIK storage format:** Should `RawFiling.cik` store the zero-padded 10-digit CIK from EFTS (e.g., `"0000320193"`) or the stripped version (e.g., `"320193"`)? **Recommendation:** Store zero-padded (10-digit) to preserve the canonical SEC format. URL construction strips zeros internally.

2. **EFTS API stability:** The EFTS `search-index` endpoint is not in the official SEC EDGAR API documentation — it's an internal Elasticsearch endpoint. It has been stable for years, but SEC could change it. **Mitigations:**
   - The EFTS base URL is defined as a named constant (`EFTS_SEARCH_URL`) in `edgar-client.ts`, making it trivially swappable.
   - All EFTS interaction is isolated in the `resolveFilingMetadata()` function — a single function to replace if the API changes.
   - Integration test fixtures should capture a real EFTS response as a reference snapshot.

3. **Multi-CIK filings:** When EFTS returns multiple CIKs (e.g., filing agent + company), which CIK should be stored in `RawFiling.cik`? **Decision:** Use `ciks[0]`, which is typically the primary filer. **Known assumption:** EFTS does not formally guarantee `ciks` array ordering. In observed responses, `ciks[0]` is the filer associated with the form type. If this proves unreliable, we can cross-reference against the accession number prefix or use heuristics. This assumption is documented and testable.

---

## 8. Out of Scope

| Item | Story |
|------|-------|
| Rate limiting (token bucket, 10 req/s) | US-1.2 |
| Caching / deduplication of fetched filings | Future |
| Batch fetching (multiple accession numbers) | Future |
| Streaming large filing content | Future |
| Parsing HTML into `StructuredDocument` | US-1.3 (parser module) |
| CIK lookup by company name/ticker | Future |
| Filing search by date range / form type | Future |

---

## 9. File-by-File Implementation Details

### `src/client/accession-number.ts`

- `parseAccessionNumber(input: string): ParsedAccession`
  - Trims whitespace
  - Validates against `/^\d{10}-\d{2}-\d{6}$/`
  - Returns `{ raw, noDashes, submitterCik }`
  - Throws `Error` with descriptive message on invalid input

### `src/client/fetch-with-retry.ts`

- `fetchWithRetry(url: string, init: RequestInit, retryOptions: RetryOptions, fetchFn: typeof fetch): Promise<Response>`
  - `RetryOptions = { maxAttempts: number; baseDelayMs: number }`
  - Retries on 429 and 503 only
  - Uses `Retry-After` header value when present (parsed as integer seconds via `parseInt()`; HTTP-date format is NOT supported — SEC sends integer values only), otherwise exponential backoff: `baseDelayMs * 2^(attempt-1)`
  - On final failure, throws `EdgarNetworkError` with the last status code
  - On non-retryable error status (any other 4xx/5xx), throws `EdgarNetworkError` immediately
  - Accepts `accessionNumber` parameter for error context

### `src/client/edgar-client.ts`

- `createEdgarClient(options: EdgarClientOptions): { fetchFiling(accessionNumber: string): Promise<RawFiling> }`
  - Captures `options.fetch ?? globalThis.fetch` and `options.userAgent`
  - `fetchFiling` implementation:
    1. Calls `parseAccessionNumber(accessionNumber)`
    2. Calls internal `resolveFilingMetadata(accessionNumber)` → EFTS lookup
    3. Constructs document URL from metadata
    4. Fetches HTML document with retry
    5. Assembles and returns `RawFiling`
  - Internal `resolveFilingMetadata(accessionNumber: string): Promise<FilingMetadata>`
    - Queries EFTS: `${EFTS_SEARCH_URL}?q="${accessionNumber}"` (constant defined at module level for swappability)
    - Finds the hit with `sequence === 1`
    - Extracts CIK, form type, filing date, filename (using `_id.substring(_id.indexOf(':') + 1)` for filename)
    - Throws `EdgarNetworkError(404, accessionNumber)` if no hits

### `src/client/types.ts`

- All type/interface/class definitions as specified in section 3

### `src/client/index.ts`

```typescript
export { createEdgarClient } from './edgar-client.js';
export { EdgarNetworkError } from './types.js';
export type { EdgarClientOptions, RawFiling, FormType } from './types.js';
```

### `src/index.ts`

```typescript
export {
  createEdgarClient,
  EdgarNetworkError,
} from './client/index.js';
export type {
  EdgarClientOptions,
  RawFiling,
  FormType,
} from './client/index.js';
```

---

## 10. Answers to Test Plan Open Questions

Addressing the open questions from `.specs/us-1-1/test-plan.md` section 9:

1. **Filing index lookup mechanism:** We use EFTS `search-index` (option c). The mock fetch for tests should simulate the EFTS JSON response (not a simplified filing index). The test plan's `MOCK_FILING_INDEX` shape should match the EFTS response format.

2. **CIK discovery:** CIK comes from EFTS `_source.ciks[0]`, never from the accession number prefix.

3. **Retry scope:** Retry applies independently to both the EFTS metadata request and the HTML document fetch. Each request gets its own 3-attempt retry budget.

4. **Non-retryable status codes:** Only 429 and 503 trigger retry. All other error status codes (400, 403, 404, 500, etc.) throw immediately.

5. **Non-HTML content:** Returned as-is in the `html` field. No `Content-Type` validation.
