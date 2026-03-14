# US-2.8: Company Search — Implementation Design

## Overview

Transform the disabled placeholder `SearchBar` into a functional company search that resolves tickers, names, and CIKs against SEC EDGAR data, displaying the resolved company as confirmation.

---

## Approach

### 1. CORS Proxy: Vite Dev Server Proxy

The SEC EDGAR API does not support CORS. For development, we use Vite's built-in proxy (`server.proxy` in `vite.config.ts`) to forward requests from `/api/sec/*` to `data.sec.gov`. This is the simplest option — zero new dependencies, no extra process to manage.

**Production note:** A real proxy (e.g., Cloudflare Worker, Express server, or API gateway) will be needed for deployment. That's out of scope for US-2.8.

**Configuration:**
- `/api/sec/submissions/*` → `https://data.sec.gov/submissions/*`
- The proxy adds the required `User-Agent` header server-side

### 2. Ticker → CIK Resolution: Bundled `company_tickers.json`

The SEC publishes `https://www.sec.gov/files/company_tickers.json` — a ~2 MB JSON mapping every ticker and company name to its CIK. We bundle a copy as a static asset and load it on demand (lazy, cached in memory).

**Why bundled over runtime:**
- Eliminates an extra API call on every search
- Sub-millisecond lookups after initial load
- The file changes infrequently (new IPOs, delistings); a quarterly refresh is sufficient
- Vite can serve it from `public/` with zero config

**Lookup strategy:**
1. Exact ticker match (case-insensitive) → immediate CIK
2. CIK match (if input is numeric) → immediate lookup
3. Company name prefix/substring match → return top matches for disambiguation

If the bundled file doesn't contain the company (edge case), the user can enter a CIK directly and we fall through to the submissions API.

### 3. State Management: Custom Hook (`useCompanySearch`)

No Redux, no context provider. A single custom hook encapsulates all search state and logic. The hook is consumed directly by `SearchBar` and passes the resolved company up to `App` via a callback prop (`onCompanySelect`).

**Why callback prop over context:**
- Only `SearchBar` needs the search state (query, loading, error, results)
- Only `App` needs the selected company (to pass to filing selectors later in US-2.9)
- Adding context for one piece of state is over-engineering

### 4. Debouncing: Custom `useDebouncedValue` Hook

A lightweight hook that delays emitting a value until the user stops typing (300ms default). No external library needed — it's ~10 lines with `useEffect` + `setTimeout`.

**Why custom over lodash.debounce:**
- Zero dependencies
- Idiomatic React (effect-based, handles cleanup)
- Tiny implementation, easy to test

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/hooks/use-debounced-value.ts` | Generic debounce hook |
| `apps/web/src/hooks/use-company-search.ts` | Search orchestration hook |
| `apps/web/src/services/company-resolver.ts` | Ticker/name/CIK → Company resolution using bundled tickers file |
| `apps/web/src/services/sec-submissions.ts` | Fetch company details from SEC submissions API via proxy |
| `apps/web/src/services/types.ts` | Shared service types (`Company`, `CompanySearchResult`, etc.) |
| `apps/web/public/data/company_tickers.json` | Bundled SEC tickers file (static asset) |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/components/SearchBar.tsx` | Remove `disabled`, add state, wire to `useCompanySearch`, render results/errors |
| `apps/web/src/components/SearchBar.test.tsx` | Replace placeholder tests with functional tests |
| `apps/web/src/App.tsx` | Add `selectedCompany` state, pass `onCompanySelect` callback to `SearchBar` |
| `apps/web/vite.config.ts` | Add `server.proxy` rules for SEC API |

---

## Interfaces and Types

### `apps/web/src/services/types.ts`

```typescript
/** A resolved SEC company identity. */
export interface Company {
  /** Central Index Key (zero-padded to 10 digits for API calls) */
  cik: string;
  /** Official company name from SEC */
  name: string;
  /** Stock ticker symbol (may be empty for private filers) */
  ticker: string;
  /** Stock exchange code (e.g., "NYSE", "Nasdaq") */
  exchange: string;
}

/** A candidate match from the bundled tickers file. */
export interface CompanyMatch {
  cik: string;
  name: string;
  ticker: string;
  exchange: string;
}

/** Result of a company search operation. */
export interface CompanySearchResult {
  /** Matching companies (may be multiple for name search) */
  matches: CompanyMatch[];
  /** The resolved company (set after user selects or unique match) */
  selected: Company | null;
}

/** States the search can be in. */
export type SearchStatus = 'idle' | 'searching' | 'resolved' | 'error';
```

### `apps/web/src/hooks/use-debounced-value.ts`

```typescript
export function useDebouncedValue<T>(value: T, delayMs?: number): T;
// Default delayMs: 300
```

### `apps/web/src/hooks/use-company-search.ts`

```typescript
import type { Company, CompanyMatch, SearchStatus } from '../services/types';

export interface UseCompanySearchReturn {
  /** Current query text (bound to input) */
  query: string;
  /** Update query text */
  setQuery: (q: string) => void;
  /** Current search status */
  status: SearchStatus;
  /** Matching companies from bundled tickers */
  matches: CompanyMatch[];
  /** Resolved company (after selection or unique match) */
  selectedCompany: Company | null;
  /** Error message, if any */
  error: string | null;
  /** Select a company from the matches list */
  selectMatch: (match: CompanyMatch) => void;
  /** Clear the search and reset state */
  clear: () => void;
}

export function useCompanySearch(): UseCompanySearchReturn;
```

### `apps/web/src/services/company-resolver.ts`

```typescript
import type { CompanyMatch } from './types';

/** Load and search the bundled company_tickers.json. */
export function searchCompanies(query: string): Promise<CompanyMatch[]>;

/** Find exact match by ticker. */
export function findByTicker(ticker: string): Promise<CompanyMatch | null>;

/** Find by CIK number. */
export function findByCik(cik: string): Promise<CompanyMatch | null>;
```

### `apps/web/src/services/sec-submissions.ts`

```typescript
import type { Company } from './types';

/** Fetch full company details from SEC submissions API. */
export function fetchCompanySubmissions(cik: string): Promise<Company>;
```

### SearchBar Props Update

```typescript
interface SearchBarProps {
  onCompanySelect?: (company: Company) => void;
}
```

---

## Data Flow

```
User types in SearchBar
       │
       ▼
  query state updates
       │
       ▼
  useDebouncedValue (300ms)
       │
       ▼
  useCompanySearch effect fires
       │
       ├─ Input < 2 chars → clear matches, status='idle'
       │
       ├─ Input is numeric → findByCik(query)
       │     └─ Found → single match shown
       │
       ├─ Input is short uppercase → findByTicker(query)
       │     └─ Found → single match shown
       │
       └─ Otherwise → searchCompanies(query)
             └─ Fuzzy name/ticker prefix search → multiple matches shown
                    │
                    ▼
              User clicks a match (or auto-selects if unique)
                    │
                    ▼
              selectMatch(match) called
                    │
                    ▼
              fetchCompanySubmissions(cik) via Vite proxy
                    │
                    ├─ Success → status='resolved', Company displayed
                    │
                    └─ Failure → status='error', error message shown
                    │
                    ▼
              onCompanySelect(company) callback to App
                    │
                    ▼
              App.selectedCompany state updated
              (available for US-2.9 Filing Selectors)
```

### Why Two Stages?

1. **Local resolution** (bundled tickers file): Fast, offline-capable, handles ticker/CIK/name lookup. No API call needed.
2. **API confirmation** (submissions API): Confirms the company exists, gets the canonical name, and later (US-2.9) provides the filing list. Only called once per selection.

This avoids hammering the SEC API during typeahead — all search-as-you-type is local.

---

## Component Architecture

### SearchBar Evolution

The current `SearchBar` is a disabled input. It evolves to:

```
SearchBar (container)
├── Search input (text, enabled, with aria-label)
├── Clear button (shown when query is non-empty)
├── SearchResults dropdown (shown when matches.length > 0)
│   └── CompanyMatchItem × N (clickable rows: ticker, name, exchange)
├── CompanyDisplay (shown when status='resolved')
│   └── "Apple Inc. (AAPL) — CIK 0000320193"
├── Loading indicator (shown when status='searching')
└── Error message (shown when status='error')
```

### New Sub-components (inline in SearchBar.tsx)

These are small enough to stay in `SearchBar.tsx` rather than being separate files:

- **SearchResults**: A `<ul>` dropdown positioned below the input. Each item shows ticker, company name, and exchange. Keyboard-navigable (arrow keys + Enter).
- **CompanyDisplay**: A confirmation bar showing the resolved company name, ticker, and CIK.
- **Error display**: An inline `<p>` with the error message.

### SearchBar Accessibility

- Input: `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `aria-autocomplete="list"`
- Dropdown: `role="listbox"` with `role="option"` items
- Keyboard: Arrow keys navigate, Enter selects, Escape closes dropdown
- Clear button: `aria-label="Clear search"`

---

## Vite Proxy Configuration

```typescript
// vite.config.ts — additions to server config
server: {
  proxy: {
    '/api/sec': {
      target: 'https://data.sec.gov',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/sec/, ''),
      headers: {
        'User-Agent': 'edgar-diff research@example.com',
      },
    },
  },
}
```

The `sec-submissions.ts` service calls `/api/sec/submissions/CIK{cik}.json`, which Vite proxies to `https://data.sec.gov/submissions/CIK{cik}.json`.

---

## Bundled Tickers File

### Format

The SEC's `company_tickers.json` has this structure:

```json
{
  "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
  "1": {"cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP"},
  ...
}
```

### Loading Strategy

1. Placed in `apps/web/public/data/company_tickers.json`
2. Fetched lazily on first search via `fetch('/data/company_tickers.json')`
3. Parsed once and cached in a module-level variable
4. Indexed into two `Map`s for O(1) lookup:
   - `tickerIndex: Map<string, CompanyMatch>` (lowercase ticker → match)
   - `cikIndex: Map<string, CompanyMatch>` (CIK string → match)
5. Name search uses a linear scan with `includes()` (fast enough for ~10K entries, filtered to top 10 results)

### Refresh Strategy

The file is committed to the repo. To update: download a fresh copy from `https://www.sec.gov/files/company_tickers.json` and commit. No runtime refresh mechanism needed for v1.

---

## Dependencies

**Zero new runtime dependencies.** Everything uses:
- React 19 built-in hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Native `fetch` API (via Vite proxy)
- Existing `@edgar-diff/lib` types (for `FormType` if needed later)

**Zero new test dependencies.** Existing `vitest` + `@testing-library/react` + `@testing-library/user-event` cover all test needs.

---

## Edge Cases

### Input Handling
- **Empty input / < 2 chars**: Clear results, return to idle. No API calls.
- **Whitespace-only input**: Trim and treat as empty.
- **Very rapid typing**: Debounce (300ms) ensures only the final value triggers a search. In-flight fetches are aborted via `AbortController` when the query changes.

### Resolution Ambiguity
- **Multiple matches**: Show dropdown list (max 10 results). User must click to select.
- **Single exact ticker match**: Auto-select without requiring a click.
- **CIK input** (all digits): Look up directly in CIK index. If not found, attempt submissions API directly (CIK might be valid but not in the bundled file).
- **Company not in bundled file**: If the user enters a valid CIK that's not in the bundled tickers file, the submissions API call will still work (CIK is used directly). Show an appropriate message.

### Network Failures
- **Submissions API returns 404**: "Company not found. Check the CIK and try again."
- **Submissions API returns 429 (rate limited)**: "SEC rate limit reached. Please wait a moment and try again." (The Vite proxy doesn't use the library's rate limiter; rate limiting at the proxy level isn't needed for single-user dev. For production, this would be handled differently.)
- **Network error / timeout**: "Unable to reach SEC. Check your connection."
- **Tickers file fails to load**: Fall back to CIK-only mode. Show a warning that ticker/name search is unavailable.

### State Transitions
- **User clears search after selecting a company**: Reset `selectedCompany` to `null`, notify `App` via `onCompanySelect(null)`.
- **User searches again after a resolved company**: Clear the resolved state, show new results.
- **Component unmounts during fetch**: `AbortController` cancels in-flight requests. `useEffect` cleanup prevents state updates on unmounted components.

---

## Rate Limiting Considerations

The bundled tickers file means the only SEC API call during search is the submissions fetch after the user selects a company. This is a single request per company selection — well within the 10 req/s limit even without explicit rate limiting.

For US-2.10 (Live Diff Pipeline), a shared `TokenBucketRateLimiter` instance will be created at the app level and passed to both the company search service and the `createEdgarClient` instance. That's future work — US-2.8 doesn't need it.

---

## Open Questions

1. **User-Agent value**: The SEC requires `"CompanyName email@example.com"` format. For dev, we'll use a placeholder in the Vite proxy config. Should we make this configurable via env var for production? (Tentative answer: yes, but out of scope for US-2.8.)

2. **Exchange data**: The SEC's `company_tickers.json` has a sibling file `company_tickers_exchange.json` that includes exchange information. Should we use this richer file instead? (Tentative answer: yes — the exchange column adds useful context in search results with minimal extra data.)

3. **Submissions response caching**: Should we cache the full submissions API response (which includes the filing list needed by US-2.9)? (Tentative answer: yes — store the full response in the `Company` object or a parallel cache so US-2.9 doesn't re-fetch. But the cache design is US-2.9/US-2.10 scope.)
