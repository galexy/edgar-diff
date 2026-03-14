# US-2.8: Company Search — Test Plan

## Overview

This test plan covers the Company Search feature, which transforms the placeholder `SearchBar` into a functional combobox that resolves companies by ticker, name, or CIK. The architecture uses a **two-stage search flow** backed by a **Cloudflare Worker**:

1. **Stage 1 (Local):** User types → debounce (300ms) → fetch ticker data from Worker (`/api/tickers`) → search client-side → show dropdown matches
2. **Stage 2 (API):** User selects a match from dropdown → fetch SEC submissions API via Worker proxy (`/api/sec/submissions/*`) → confirm company → display resolved name + CIK

The Worker handles CORS, `User-Agent` injection, and edge caching (24-hour TTL for ticker data). During development, the Worker runs locally via `@cloudflare/vite-plugin` inside `workerd`.

**Test file locations:**
- `apps/web/src/services/company-resolver.test.ts` — Local ticker/name/CIK resolution against Worker-served data
- `apps/web/src/services/sec-submissions.test.ts` — SEC submissions API fetch via Worker proxy + error handling
- `apps/web/src/hooks/use-debounced-value.test.ts` — Debounce hook with fake timers
- `apps/web/src/hooks/use-company-search.test.ts` — Orchestrating hook: state transitions, match selection, API integration
- `apps/web/src/components/SearchBar.test.tsx` — Component rendering, combobox interaction, keyboard navigation
- `apps/web/src/App.test.tsx` — Integration tests (additions to existing file)
- `apps/web/worker/index.test.ts` — Worker route matching, CORS headers, caching, error handling

**Test stack:** Vitest + React Testing Library (jsdom) for client-side tests, following existing patterns in `FilingPanel.test.tsx` and `App.test.tsx`. Worker tests use Vitest with mocked `fetch` and `caches` APIs.

---

## 1. BDD Acceptance Criteria (Given/When/Then)

### AC-1: Search by ticker symbol

```gherkin
Given the search bar is displayed and enabled
When the user types "AAPL" and waits for debounce
Then a dropdown appears showing "Apple Inc." (AAPL) as a match
When the user selects the match
Then the app fetches SEC submissions for CIK "0000320193"
And displays "Apple Inc." with CIK "0000320193" as confirmation
```

### AC-2: Search by company name

```gherkin
Given the search bar is displayed and enabled
When the user types "Microsoft" and waits for debounce
Then a dropdown appears showing "Microsoft Corporation" (MSFT) as a match
When the user selects the match
Then the app fetches SEC submissions and displays "Microsoft Corporation" with CIK "0000789019"
```

### AC-3: Search by CIK number

```gherkin
Given the search bar is displayed and enabled
When the user types "320193" and waits for debounce
Then a dropdown appears showing the company matching CIK 320193
When the user selects the match
Then "Apple Inc." with CIK "0000320193" is displayed as confirmation
```

### AC-4: Company not found (no local matches)

```gherkin
Given the search bar is displayed
When the user types "XYZNOTREAL" and waits for debounce
Then the dropdown shows "No matches found" (or is empty)
And no API call is made
```

### AC-5: Network failure on selection

```gherkin
Given the search bar displays dropdown matches for "AAPL"
When the user selects "Apple Inc."
And the SEC submissions API is unreachable or returns a server error
Then an error message indicating the failure is displayed
And the user can retry by selecting again or searching differently
```

### AC-6: Debounced input (local search)

```gherkin
Given the search bar is displayed
When the user types "A", then "AP", then "APP", then "AAPL" rapidly (within 300ms)
Then only one local search executes (for "AAPL") after the debounce delay
And the dropdown shows matches for "AAPL"
```

### AC-7: Loading state on selection

```gherkin
Given the user has selected a match from the dropdown
When the SEC submissions API call is in progress
Then a loading indicator is shown
And the loading indicator disappears when the result or error arrives
```

### AC-8: New search clears previous result

```gherkin
Given a successful company result is displayed (e.g., "Apple Inc.")
When the user types a new query (e.g., "MSFT")
Then the previous result is cleared
And the dropdown shows new matches
```

### AC-9: Clearing input clears everything

```gherkin
Given a successful company result is displayed
When the user clears the search input
Then the dropdown closes, the company result disappears, and any error messages are cleared
```

### AC-10: Multiple matches require disambiguation

```gherkin
Given the user types "Alphabet" and waits for debounce
When the local search returns multiple matches (GOOGL, GOOG)
Then the dropdown lists all matches for the user to choose from
And no API call is made until the user selects one
```

### AC-11: Keyboard navigation of dropdown

```gherkin
Given the dropdown is open with matches visible
When the user presses ArrowDown
Then the next match is highlighted
When the user presses Enter
Then the highlighted match is selected and the API call is triggered
When the user presses Escape
Then the dropdown closes without selecting
```

---

## 2. Unit Tests

### 2.1 Company Resolver Service (`company-resolver.test.ts`)

Tests the local resolution logic against ticker data fetched from the Worker (`/api/tickers`). Uses a small fixture subset (not the full SEC file).

#### Ticker Lookup (O(1) Map)

| Test | Input | Expected |
|------|-------|----------|
| Resolves uppercase ticker | `"AAPL"` | `[{ cik: 320193, ticker: 'AAPL', title: 'Apple Inc.' }]` |
| Resolves lowercase ticker (case-insensitive) | `"aapl"` | Same as above |
| Resolves mixed-case ticker | `"Aapl"` | Same as above |
| Unknown ticker returns empty | `"XYZNOTREAL"` | `[]` |
| Multi-ticker company (GOOGL/GOOG) | `"GOOG"` | Returns Alphabet entry |

#### CIK Lookup (O(1) Map)

| Test | Input | Expected |
|------|-------|----------|
| Recognizes numeric-only as CIK | `"320193"` | Returns Apple entry |
| Handles zero-padded CIK | `"0000320193"` | Returns Apple entry (strips leading zeros for lookup) |
| Unknown CIK returns empty | `"9999999"` | `[]` |

#### Name Search (linear scan)

| Test | Input | Expected |
|------|-------|----------|
| Finds by exact name | `"Apple Inc."` | Returns Apple entry |
| Finds by partial name (substring) | `"Apple"` | Returns Apple entry |
| Case-insensitive name search | `"apple"` | Returns Apple entry |
| Returns multiple matches | `"Inc"` | Returns multiple entries containing "Inc" |
| No matches | `"Nonexistent Corp"` | `[]` |

#### Lazy Loading

| Test | Scenario | Expected |
|------|----------|----------|
| Loads tickers data on first search | Call `resolve("AAPL")` | Fetches `/api/tickers` once |
| Caches after first load | Call `resolve` twice | Only one fetch call |
| Builds ticker Map and CIK Map on load | After load | O(1) lookups work |

#### Input Classification

| Test | Input | Expected Classification |
|------|-------|------------------------|
| All digits → CIK | `"320193"` | CIK lookup path |
| Letters → ticker first, then name | `"AAPL"` | Ticker lookup, falls through to name if no match |
| Mixed alphanumeric → name search | `"10-K"` | Name search path |
| Empty string | `""` | Returns `[]` immediately, no fetch |
| Whitespace only | `"   "` | Returns `[]` immediately |

### 2.2 SEC Submissions Service (`sec-submissions.test.ts`)

Tests the API call to `/api/sec/submissions/CIK{cik}.json` via the Worker proxy. Uses mocked `fetch`.

| Test | Scenario | Expected |
|------|----------|----------|
| Fetches correct URL | CIK `320193` | Calls `/api/sec/submissions/CIK0000320193.json` |
| Pads CIK to 10 digits | CIK `320193` | URL contains `CIK0000320193` |
| Extracts company name from response | Valid JSON | Returns `{ name: "Apple Inc.", cik: "0000320193", tickers: ["AAPL"] }` |
| Handles 404 | API returns 404 | Throws/returns structured error: "Company not found" |
| Handles 429 (rate limited) | API returns 429 | Throws rate limit error |
| Handles 500 (server error) | API returns 500 | Throws network error |
| Handles malformed JSON | Invalid body | Throws parse error |
| Handles network timeout | Fetch rejects | Throws network error |
| Handles AbortError gracefully | Signal aborted | Does not throw user-facing error |
| Accepts AbortSignal | Pass signal | Forwards to fetch call |

### 2.3 `useDebouncedValue` Hook (`use-debounced-value.test.ts`)

~10-line hook; small test surface.

| Test | Action | Expected |
|------|--------|----------|
| Returns initial value immediately | `useDebouncedValue("", 300)` | Returns `""` |
| Debounces value changes | Update value, check before 300ms | Still old value |
| Returns new value after delay | Update value, advance 300ms | Returns new value |
| Resets timer on rapid changes | Update 3 times in 100ms, advance 300ms from last | Only final value returned |
| Cleans up on unmount | Unmount during pending | No state update, no warnings |

### 2.4 `useCompanySearch` Hook (`use-company-search.test.ts`)

Orchestrating hook. Mock both `company-resolver` and `sec-submissions` modules.

#### State Shape & Transitions

| Test | Action | Expected State |
|------|--------|----------------|
| Initial state | Hook renders | `{ query: '', matches: [], selectedCompany: null, error: null, status: 'idle' }` |
| Short query stays idle | `setQuery("A")` + advance debounce | `{ matches: [], status: 'idle' }` (query < 2 chars) |
| Typing populates matches | `setQuery("AAPL")` + advance debounce | `{ matches: [{...Apple}], status: 'searching' }` (local search) |
| Local search completes | Matches resolved | `{ matches: [{...Apple}], status: 'idle' }` |
| No matches found | `setQuery("XYZFAKE")` + advance debounce | `{ matches: [], status: 'idle' }` |
| Select match triggers API loading | `selectMatch(appleMatch)` | `{ status: 'searching' }` (API in-flight) |
| Successful API resolution | API resolves | `{ selectedCompany: { name: "Apple Inc.", cik: "..." }, status: 'resolved', error: null }` |
| Failed API resolution | API rejects | `{ selectedCompany: null, status: 'error', error: "..." }` |
| Clear resets all state | `clear()` | Back to initial state |
| New query clears selected company | `setQuery("MSFT")` after resolved | `{ selectedCompany: null, status: 'idle' }` |

> **Note:** `status: 'searching'` covers both local match search and API confirmation. Both stages use the same status value for simplicity.

#### Concurrency & Cleanup

| Test | Action | Expected |
|------|--------|----------|
| Abort in-flight on new selection | Select "AAPL", then select "MSFT" before AAPL resolves | Only MSFT result displayed |
| Abort in-flight on clear | Select match, then `clear()` | No stale result |
| No state update after unmount | Select match, then unmount | No React warnings |

### 2.5 SearchBar Component (`SearchBar.test.tsx`)

Replaces the current placeholder tests. SearchBar evolves into a combobox with dropdown.

#### Rendering

| Test | Scenario | Expected |
|------|----------|----------|
| Renders enabled text input | Default render | Input is enabled (not disabled) |
| Input has search placeholder text | Default | Placeholder includes "ticker", "name", or "CIK" |
| Wraps input in search landmark | Default | `role="search"` container present |
| Has combobox role | Default | Input has `role="combobox"` |
| Has autocomplete ARIA attributes | Default | `aria-expanded`, `aria-controls`, `aria-autocomplete` present |

#### Dropdown Behavior

| Test | Action | Expected |
|------|--------|----------|
| Dropdown hidden initially | Render | No listbox visible |
| Dropdown appears with matches | Type "AAPL" + debounce | Listbox with options visible |
| Dropdown shows match details | Matches present | Each option shows ticker, company name, and exchange (e.g., "AAPL — Apple Inc. (Nasdaq)") |
| Dropdown closes on selection | Click option | Listbox hidden |
| Dropdown closes on Escape | Press Escape | Listbox hidden |
| Dropdown shows "no matches" | Type "XYZFAKE" + debounce | Empty state or "no matches" text |

#### Keyboard Navigation (ARIA Combobox)

| Test | Action | Expected |
|------|--------|----------|
| ArrowDown highlights first option | Press ArrowDown | First option has `aria-selected="true"` |
| ArrowDown cycles through options | Press ArrowDown multiple times | Selection moves down |
| ArrowUp moves selection up | Press ArrowUp | Selection moves up |
| Enter selects highlighted option | Press Enter on highlighted | `onCompanySelect` callback fires |
| Escape closes dropdown | Press Escape | Dropdown closes, focus stays on input |
| Tab closes dropdown | Press Tab | Dropdown closes |

#### Result Display

| Test | Action | Expected |
|------|--------|----------|
| Displays resolved company name | After selection + API success | Company name text visible |
| Displays CIK | After selection + API success | CIK visible |
| Company result has live region | Result displayed | `aria-live="polite"` region |

#### Loading State

| Test | Scenario | Expected |
|------|----------|----------|
| Shows loading indicator during API call | After match selection, API pending | Loading indicator visible |
| Loading has accessible role | During loading | `role="status"` or `aria-busy` |
| Loading clears on success | API resolves | Loading indicator removed |
| Loading clears on error | API rejects | Loading indicator removed |

#### Error Display

| Test | Scenario | Expected |
|------|----------|----------|
| Displays error message | API fails | Error text visible |
| Error has alert role | On error | `role="alert"` for screen readers |
| Error clears on new search | Start typing again | Error removed |

#### Callback Integration

| Test | Action | Expected |
|------|--------|----------|
| Calls `onCompanySelect` on successful resolution | Select match + API succeeds | Callback called with `{ name, cik }` |
| Calls `onCompanySelect(null)` on clear | Clear input | Callback called with `null` (so App can reset downstream state e.g. filing selectors) |

### 2.6 Cloudflare Worker (`worker/index.test.ts`)

Tests the Worker's route matching, CORS handling, caching, and error propagation. Worker tests mock `globalThis.fetch` (for upstream SEC calls) and `caches.default` (for the Workers Cache API).

#### Route Matching

| Test | Request | Expected |
|------|---------|----------|
| Handles ticker data route | `GET /api/tickers` | Returns JSON with tickers data |
| Handles submissions proxy route | `GET /api/sec/submissions/CIK0000320193.json` | Proxies to `data.sec.gov/submissions/CIK0000320193.json` |
| Handles CORS preflight | `OPTIONS /api/tickers` | Returns 204 with CORS headers |
| Returns 404 for unknown API routes | `GET /api/unknown` | Returns 404 |
| Non-API routes fall through | `GET /` | Returns 404 (assets handled separately) |

#### CORS Headers

| Test | Scenario | Expected |
|------|----------|----------|
| Preflight includes Allow-Origin | `OPTIONS` with `Origin: http://localhost:5173` | `Access-Control-Allow-Origin: http://localhost:5173` |
| Preflight includes Allow-Methods | `OPTIONS` request | `Access-Control-Allow-Methods: GET, OPTIONS` |
| Preflight includes Allow-Headers | `OPTIONS` request | `Access-Control-Allow-Headers: Content-Type` |
| Preflight includes Max-Age | `OPTIONS` request | `Access-Control-Max-Age: 86400` |
| Data responses include Allow-Origin | `GET /api/tickers` | Response has `Access-Control-Allow-Origin` header |
| Varies by Origin | `GET /api/tickers` with Origin | Response has `Vary: Origin` header |
| Falls back to wildcard | Request without `Origin` header | `Access-Control-Allow-Origin: *` |

#### Tickers Caching (`/api/tickers`)

| Test | Scenario | Expected |
|------|----------|----------|
| Cache miss → fetches from SEC | First request, cache empty | Fetches `https://www.sec.gov/files/company_tickers.json` with `User-Agent` |
| Cache miss → stores response | First request, cache empty | Calls `cache.put()` with 24h TTL (`max-age=86400`) |
| Cache hit → returns cached | Subsequent request, cache has entry | Returns cached response, no upstream fetch |
| Sets Content-Type JSON | Any request | Response has `Content-Type: application/json` |
| Upstream SEC failure → returns 502 | SEC returns 500 | Returns 502 with `{ error: "Failed to fetch tickers" }` |
| Upstream SEC timeout → returns 502 | Fetch rejects | Returns 502 error |

#### Submissions Proxy (`/api/sec/submissions/*`)

| Test | Scenario | Expected |
|------|----------|----------|
| Proxies to correct SEC URL | `GET /api/sec/submissions/CIK0000320193.json` | Fetches `https://data.sec.gov/submissions/CIK0000320193.json` |
| Injects User-Agent header | Any submission request | Upstream fetch includes `User-Agent: edgar-diff research@example.com` |
| Forwards SEC status code | SEC returns 404 | Worker returns 404 |
| Forwards SEC response body | SEC returns valid JSON | Worker returns same JSON body |
| Handles SEC 429 (rate limit) | SEC returns 429 | Worker returns 429 |
| Handles SEC 500 | SEC returns 500 | Worker returns 500 |

---

## 3. Integration Tests

### 3.1 SearchBar Full Flow (mocked fetch at boundary)

Render SearchBar with real hooks wired up; only mock `globalThis.fetch` for the Worker tickers endpoint (`/api/tickers`) and Worker submissions proxy (`/api/sec/submissions/*`).

| Test | Scenario | Expected |
|------|----------|----------|
| Type → debounce → local matches → select → API → display | Type "AAPL", wait, select, resolve | Company name and CIK visible |
| Type → debounce → local matches → select → API error → display error | Type "AAPL", select, reject | Error message visible |
| Type → no local matches → no dropdown | Type "XYZFAKE", wait | "No matches" or empty dropdown |
| Rapid type → single local search | Type "A", "AP", "APP", "AAPL" in <300ms | Local search runs once for "AAPL" |
| Type → select → type new → clears previous | Select Apple, then type "MSFT" | Apple result cleared, new matches shown |
| Keyboard flow: type → ArrowDown → Enter → resolve | Full keyboard-only flow | Company resolved and displayed |

### 3.2 App-Level Integration (`App.test.tsx`)

Additions to verify SearchBar wiring in the app.

| Test | Scenario | Expected |
|------|----------|----------|
| Search bar is enabled (not disabled) | Render App | Input is interactive |
| `onCompanySelect` wired to App state | Search + select + resolve | App receives company state |

### 3.3 Worker Integration (UAT only)

The Cloudflare Worker runs in `workerd` via `@cloudflare/vite-plugin` and cannot be tested in Vitest (jsdom doesn't run `workerd`). Worker unit tests (section 2.6) cover route matching and logic in isolation. End-to-end Worker verification is done via UAT.

| Check | How |
|-------|-----|
| Worker routes `/api/tickers` serve ticker data | UAT: type real ticker, dropdown shows matches |
| Worker proxies `/api/sec/submissions/*` to `data.sec.gov` | UAT: select match, see real company resolve |
| Worker injects CORS headers | UAT: no CORS errors in console |
| Worker injects User-Agent | UAT: check network tab for successful SEC responses |

---

## 4. End-to-End Scenarios

Full user journeys. In Vitest: integration tests with mocked fetch. In UAT: against the running dev server with Worker (`@cloudflare/vite-plugin`) and real SEC data.

### E2E-1: Successful ticker search

1. User opens the app
2. Types "AAPL" in the search bar
3. Dropdown appears with "Apple Inc. (AAPL)"
4. User clicks/selects the match
5. Loading indicator appears briefly
6. "Apple Inc. (CIK: 0000320193)" displayed as confirmation

### E2E-2: Successful company name search

1. User types "Microsoft" in the search bar
2. Dropdown appears with "Microsoft Corporation (MSFT)"
3. User selects the match
4. "Microsoft Corporation (CIK: 0000789019)" displayed

### E2E-3: No local matches

1. User types "XYZNOTREAL" in the search bar
2. Dropdown shows "No matches" or remains empty
3. No API call is triggered

### E2E-4: API failure after selection

1. User types "AAPL", selects from dropdown
2. SEC API returns 500
3. Error message displayed: "Unable to confirm company. Please try again."

### E2E-5: Rapid typing (debounce verification)

1. User types "A", "AP", "APP", "AAPL" quickly
2. Dropdown appears only after debounce fires for "AAPL"
3. Only one local search executes

### E2E-6: Sequential searches

1. User searches "AAPL" → selects → sees Apple result
2. User clears and types "MSFT" → Apple result disappears, MSFT matches appear
3. User selects MSFT → Microsoft result displayed
4. User clears input → everything resets

### E2E-7: Keyboard-only flow

1. User focuses search bar with Tab
2. Types "AAPL"
3. Presses ArrowDown to highlight first match
4. Presses Enter to select
5. Sees resolved company displayed

---

## 5. Boundary Conditions

| Condition | Input | Expected Behavior |
|-----------|-------|-------------------|
| Empty input | `""` | No local search, dropdown hidden, no matches |
| Whitespace only | `"   "` | Treated as empty — no search |
| Single character | `"A"` | Local search runs (may return many matches or none depending on min-length policy) |
| Very long input | 200+ chars | No crash; no local matches |
| Numeric-only input | `"320193"` | Classified as CIK, CIK Map lookup |
| Zero-padded CIK | `"0000320193"` | Strips leading zeros, CIK Map lookup |
| Special characters | `"AAPL!@#$"` | No crash; no matches (treated as name search) |
| HTML/script in input | `"<script>alert(1)</script>"` | Escaped safely, no XSS, no matches |
| Unicode characters | `"日本語"` | No crash; no matches |
| Leading/trailing whitespace | `" AAPL "` | Trimmed before search |
| Company with multiple tickers | Search for `"GOOG"` | Shows Alphabet; `"GOOGL"` also works |
| Ambiguous query matching ticker AND name | `"A"` | Returns all matches (ticker "A" + names containing "A") |

---

## 6. Error Conditions

| Condition | Stage | Trigger | Expected Behavior |
|-----------|-------|---------|-------------------|
| Worker tickers endpoint fails | Stage 1 | `GET /api/tickers` returns error or Worker 502 | Error message: "Unable to load company data". Falls back to CIK-only mode |
| No local matches | Stage 1 | Query doesn't match any ticker/name/CIK | Dropdown shows "no matches" — no API call |
| Network timeout | Stage 2 | Worker proxy fetch rejects | Error message: "Network error. Please try again." |
| SEC API 404 | Stage 2 | CIK not found in submissions | Error message: "Company not found" |
| SEC API 429 | Stage 2 | Rate limited by SEC (forwarded by Worker) | Error message: "Rate limited. Please wait." |
| SEC API 500 | Stage 2 | Server error (forwarded by Worker) | Error message: "SEC service unavailable." |
| Worker 502 | Stage 2 | Worker fails to reach upstream SEC | Error message: "SEC data temporarily unavailable. Try again shortly." |
| Malformed JSON | Stage 2 | Invalid response body | Error message: "Unexpected error" |
| CORS error | Stage 2 | Worker CORS misconfigured | Error message: "Network error" (TypeError) |
| AbortError | Stage 2 | User starts new search during API call | Silently ignored (not shown as error) |

---

## 7. Performance Criteria

| Criterion | Target | How to Test |
|-----------|--------|-------------|
| Debounce delay | 300ms | Vitest fake timers: local search not called before 300ms |
| Local search speed | < 10ms for 10K entries | Linear scan is fast enough; no test needed (perf regression unlikely) |
| Bundled tickers loaded once | 1 fetch call | Spy on fetch, verify single call across multiple searches |
| No unnecessary re-renders | ≤ 2 renders per search cycle | Render count spy in hook tests |
| UI responsive during API call | Input accepts typing during fetch | Type during pending fetch → input updates immediately |
| AbortController cleanup | Cancel in-flight on new selection | Verify signal aborted on concurrent selectMatch calls |
| No memory leaks | Unmount during pending | No React state-update-on-unmounted warnings |

---

## 8. Test Data & Fixtures

### Mock Worker Tickers Response (small fixture subset)

```typescript
// apps/web/src/test-fixtures/company-search-fixtures.ts

/** Small subset of /api/tickers response for unit/integration tests */
export const MOCK_COMPANY_TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.', exchange: 'Nasdaq' },
  '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corporation', exchange: 'Nasdaq' },
  '2': { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.', exchange: 'Nasdaq' },
  '3': { cik_str: 1652044, ticker: 'GOOG', title: 'Alphabet Inc.', exchange: 'Nasdaq' },
  '4': { cik_str: 1318605, ticker: 'TSLA', title: 'Tesla, Inc.', exchange: 'Nasdaq' },
};

export const MOCK_COMPANIES = {
  AAPL: { name: 'Apple Inc.', cik: '0000320193', tickers: ['AAPL'] },
  MSFT: { name: 'Microsoft Corporation', cik: '0000789019', tickers: ['MSFT'] },
  GOOGL: { name: 'Alphabet Inc.', cik: '0001652044', tickers: ['GOOGL', 'GOOG'] },
  TSLA: { name: 'Tesla, Inc.', cik: '0001318605', tickers: ['TSLA'] },
} as const;
```

### Mock SEC Submissions API Response (via Worker proxy)

```typescript
// Shape of /api/sec/submissions/CIK0000320193.json (Worker proxies to data.sec.gov)
export const MOCK_AAPL_SUBMISSIONS = {
  cik: '320193',
  entityType: 'operating',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  ein: '942404110',
  category: 'Large accelerated filer',
  filings: {
    recent: {
      accessionNumber: ['0000320193-23-000106'],
      filingDate: ['2023-11-03'],
      form: ['10-K'],
      // ... additional fields omitted for search tests
    },
  },
};

export const MOCK_MSFT_SUBMISSIONS = {
  cik: '789019',
  entityType: 'operating',
  name: 'Microsoft Corporation',
  tickers: ['MSFT'],
  exchanges: ['Nasdaq'],
  // ...
};
```

### Error Response Fixtures

```typescript
export function mockResponse(status: number, body: unknown = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const MOCK_404 = () => mockResponse(404, { error: 'Not Found' });
export const MOCK_429 = () => mockResponse(429, { error: 'Rate limit exceeded' });
export const MOCK_500 = () => mockResponse(500, { error: 'Internal Server Error' });
export const MOCK_NETWORK_ERROR = new TypeError('Failed to fetch');
```

### Mock Fetch Helper

```typescript
/** Creates a fetch mock that responds based on URL pattern */
export function createMockFetch(responses: Record<string, Response | (() => Response)>) {
  return vi.fn((url: string) => {
    const match = Object.entries(responses).find(([pattern]) => url.includes(pattern));
    if (!match) return Promise.reject(new Error(`Unmocked URL: ${url}`));
    const response = typeof match[1] === 'function' ? match[1]() : match[1];
    return Promise.resolve(response);
  });
}
```

---

## 9. UAT Scenarios (Chrome DevTools MCP)

Visual and interaction checks performed against the running dev server (with Worker via `@cloudflare/vite-plugin`) after all automated tests pass.

**Full UAT document:** See [uat.md](uat.md) for the complete 17-step UAT plan with prerequisites, detailed verify steps, reference screenshot placeholders, and pass/fail criteria.

**Summary of UAT coverage:**

| UAT Step | What it covers |
|----------|----------------|
| UAT-1 | Search bar default appearance |
| UAT-2 | Focus state and focus ring |
| UAT-3 | Dropdown with matches (type "AAPL") |
| UAT-4 | Dropdown hover interaction |
| UAT-5 | Keyboard navigation (ArrowDown/Up) |
| UAT-6 | Loading state after selection |
| UAT-7 | Successful resolution display (company + CIK) |
| UAT-8 | No matches empty state |
| UAT-9 | Error state display |
| UAT-10 | Sequential search — previous result clears |
| UAT-11 | Clear input — full reset |
| UAT-12 | Keyboard-only full flow (Tab, type, ArrowDown, Enter) |
| UAT-13 | Responsive at 768px |
| UAT-14 | Responsive at 375px |
| UAT-15 | Accessibility — ARIA combobox semantics |
| UAT-16 | No console errors during interaction |
| UAT-17 | Worker endpoint verification (CORS, routing) |

---

## 10. Test Configuration Notes

### Vitest Setup

- Environment: `jsdom` (per `vitest.config.ts`)
- Globals: enabled (`describe`, `it`, `expect` available without import)
- Setup: `@testing-library/jest-dom/vitest` for DOM matchers
- Timer control: Use `vi.useFakeTimers()` / `vi.advanceTimersByTime(300)` for debounce tests
- Hook testing: `renderHook` from `@testing-library/react` for `useDebouncedValue` and `useCompanySearch`

### Mock Strategy

- **Worker tickers endpoint:** Mock the fetch call to `/api/tickers` returning `MOCK_COMPANY_TICKERS` fixture
- **Worker submissions proxy:** Mock fetch calls to `/api/sec/submissions/CIK*.json` returning `MOCK_*_SUBMISSIONS` fixtures
- **Worker Cache API:** Mock `caches.default` for Worker unit tests (cache hit/miss scenarios)
- **Timer mocking:** `vi.useFakeTimers()` for debounce delay verification; `vi.advanceTimersByTime(300)` to fire debounce
- **Module mocking:** `vi.mock()` for `company-resolver` and `sec-submissions` when testing the hook and component in isolation
- **No real API calls:** All automated tests use mocked responses. Real SEC API calls via the Worker are verified via UAT only.
- **Worker tests:** Worker unit tests (section 2.6) mock upstream `fetch` and `caches.default`. They test the Worker handler function directly — no HTTP server or `workerd` needed.

### Test Isolation

- Each test renders a fresh component instance
- Mock fetch reset between tests (`vi.restoreAllMocks()` in `afterEach`)
- Fake timers restored after use (`vi.useRealTimers()` in `afterEach`)
- AbortController state cleaned up between tests

---

## 11. Coverage Matrix

| Acceptance Criterion (PRD) | Unit | Integration | E2E/UAT |
|----------------------------|------|-------------|---------|
| Search bar accepts free text input | SearchBar component tests | App integration | UAT-1, UAT-2 |
| Queries SEC submissions API via Worker | sec-submissions unit tests, Worker unit tests | Full-flow integration | UAT-7, UAT-17 |
| Displays resolved company name and CIK | SearchBar result display tests | App integration | UAT-7 |
| Shows error if company not found | company-resolver + component tests | Error flow integration | UAT-9 |
| Handles SEC rate limit (10 req/s) | sec-submissions 429 handling, Worker 429 forwarding | — | — |
| Debounces input | use-debounced-value tests | Rapid-type integration | E2E-5 |
| Worker-served ticker resolution | company-resolver tests, Worker tickers caching tests | Full-flow integration | UAT-3, UAT-17 |
| Combobox keyboard navigation | SearchBar keyboard tests | Keyboard flow integration | UAT-5, UAT-12 |
| `onCompanySelect` callback | SearchBar callback tests | App integration | — |
| Worker CORS handling | Worker CORS header tests | — | UAT-17 |
| Worker tickers caching (24h TTL) | Worker cache hit/miss tests | — | — |
| Responsive layout | — | — | UAT-13, UAT-14 |
| Accessibility (ARIA combobox) | SearchBar ARIA tests | — | UAT-15 |
