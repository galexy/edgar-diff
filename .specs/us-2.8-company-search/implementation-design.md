# US-2.8: Company Search — Implementation Design

## Overview

Transform the disabled placeholder `SearchBar` into a functional company search that resolves tickers, names, and CIKs against SEC EDGAR data, displaying the resolved company as confirmation.

---

## Approach

### 1. Cloudflare Worker: SEC API Proxy + Ticker Resolution

The SEC EDGAR API does not support CORS. We use a **Cloudflare Worker** to handle both the CORS proxy and ticker data serving. The Worker runs locally via `@cloudflare/vite-plugin` during development and deploys to Cloudflare's edge in production.

**Worker routes:**

| Route | Purpose |
|-------|---------|
| `GET /api/tickers` | Fetch, cache, and serve `company_tickers.json` from SEC |
| `GET /api/sec/submissions/:cik` | Proxy requests to `data.sec.gov/submissions/` with required `User-Agent` header |
| `OPTIONS /api/*` | Handle CORS preflight requests |

**Why a single Worker for both concerns:**
- One deployment unit, one config file, one local dev process
- Both routes need the same CORS handling and `User-Agent` injection
- Keeps the architecture simple — no service-to-service calls

### 2. Vite + Cloudflare Integration: `@cloudflare/vite-plugin`

The `@cloudflare/vite-plugin` integrates the Worker directly into the Vite dev server. Running `vite dev` starts both the React SPA and the Worker — no separate `wrangler dev` process needed.

**How it works:**
- The plugin uses the Vite Environment API to run Worker code in `workerd` (the Cloudflare runtime)
- API routes (`/api/*`) are handled by the Worker
- All other routes are served as SPA static assets
- Hot module replacement works for both frontend and Worker code

**Configuration:**
- `wrangler.jsonc` defines the Worker entry point, bindings, and asset routing
- `vite.config.ts` adds the `cloudflare()` plugin alongside `react()` and `tailwindcss()`

### 3. Ticker Data: Worker-Served with Edge Caching

Instead of bundling `company_tickers.json` as a static asset, the Worker fetches it from the SEC and caches it using the Workers Cache API.

**Why Worker-served over bundled:**
- Data stays fresh — no manual downloads or commits to update the tickers file
- Cache TTL controls staleness (24-hour default, configurable)
- Eliminates a ~2 MB static asset from the repo and build
- Same client-side resolution logic — the Worker just changes where the data comes from

**Caching strategy:**
1. Client requests `GET /api/tickers`
2. Worker checks the Cache API for a cached response
3. Cache miss → Worker fetches from `https://www.sec.gov/files/company_tickers.json`, stores in cache with `Cache-Control: max-age=86400`, returns response
4. Cache hit → returns cached response immediately

**Client-side behavior:**
- `company-resolver.ts` fetches from `/api/tickers` (instead of `/data/company_tickers.json`)
- Parsed once and cached in a module-level variable (same as before)
- Indexed into `Map`s for O(1) ticker/CIK lookup
- Name search uses linear scan with `includes()` (fast for ~10K entries)

### 4. State Management: Custom Hook (`useCompanySearch`)

No Redux, no context provider. A single custom hook encapsulates all search state and logic. The hook is consumed directly by `SearchBar` and passes the resolved company up to `App` via a callback prop (`onCompanySelect`).

**Why callback prop over context:**
- Only `SearchBar` needs the search state (query, loading, error, results)
- Only `App` needs the selected company (to pass to filing selectors later in US-2.9)
- Adding context for one piece of state is over-engineering

### 5. Debouncing: Custom `useDebouncedValue` Hook

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
| `apps/web/worker/index.ts` | Cloudflare Worker entry point — routes `/api/tickers` and `/api/sec/submissions/*` |
| `apps/web/wrangler.jsonc` | Worker configuration — entry point, asset routing, environment variables |
| `apps/web/src/hooks/use-debounced-value.ts` | Generic debounce hook |
| `apps/web/src/hooks/use-company-search.ts` | Search orchestration hook |
| `apps/web/src/services/company-resolver.ts` | Ticker/name/CIK → Company resolution (fetches from Worker API) |
| `apps/web/src/services/sec-submissions.ts` | Fetch company details from SEC submissions API via Worker proxy |
| `apps/web/src/services/types.ts` | Shared service types (`Company`, `CompanySearchResult`, etc.) |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/components/SearchBar.tsx` | Remove `disabled`, add state, wire to `useCompanySearch`, render results/errors |
| `apps/web/src/components/SearchBar.test.tsx` | Replace placeholder tests with functional tests |
| `apps/web/src/App.tsx` | Add `selectedCompany` state, pass `onCompanySelect` callback to `SearchBar` |
| `apps/web/vite.config.ts` | Add `cloudflare()` plugin from `@cloudflare/vite-plugin` |
| `apps/web/package.json` | Add `@cloudflare/vite-plugin`, `wrangler`, `@cloudflare/workers-types` dev dependencies |

### Removed Files

| File | Reason |
|------|--------|
| ~~`apps/web/public/data/company_tickers.json`~~ | No longer bundled — served by Worker from SEC with edge caching |

---

## Cloudflare Worker Implementation

### `apps/web/worker/index.ts`

```typescript
interface Env {
  SEC_USER_AGENT: string; // e.g., "edgar-diff research@example.com"
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Route: Ticker data
    if (url.pathname === '/api/tickers') {
      return handleTickers(request, env);
    }

    // Route: SEC submissions proxy
    if (url.pathname.startsWith('/api/sec/submissions/')) {
      return handleSubmissionsProxy(request, env, url);
    }

    // Not an API route — let assets/SPA handle it
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function handleOptions(request: Request): Response {
  const origin = request.headers.get('Origin') ?? '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function handleTickers(request: Request, env: Env): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/api/tickers');

  // Check cache first
  const cached = await cache.match(cacheKey);
  if (cached) {
    return addCorsHeaders(cached, request);
  }

  // Fetch from SEC
  const secResponse = await fetch(
    'https://www.sec.gov/files/company_tickers.json',
    { headers: { 'User-Agent': env.SEC_USER_AGENT } }
  );

  if (!secResponse.ok) {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Failed to fetch tickers' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
      request
    );
  }

  // Cache for 24 hours
  const response = new Response(secResponse.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    },
  });

  // Store in cache (non-blocking)
  const responseToCache = response.clone();
  cache.put(cacheKey, responseToCache);

  return addCorsHeaders(response, request);
}

async function handleSubmissionsProxy(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Extract path after /api/sec/submissions/
  const secPath = url.pathname.replace('/api/sec/submissions/', '');
  const secUrl = `https://data.sec.gov/submissions/${secPath}`;

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: { 'Content-Type': 'application/json' },
    }),
    request
  );
}

function addCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin') ?? '*';
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', origin);
  newResponse.headers.set('Vary', 'Origin');
  return newResponse;
}
```

### `apps/web/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "edgar-diff-api",
  "compatibility_date": "2025-04-01",
  "main": "./worker/index.ts",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "vars": {
    "SEC_USER_AGENT": "edgar-diff research@example.com"
  }
}
```

**Key config:**
- `main` → Worker entry point
- `assets.not_found_handling` → SPA routing (all non-API paths serve `index.html`)
- `assets.run_worker_first` → API routes hit the Worker before asset serving
- `vars` → Environment variables (overridable per environment)

---

## Vite Configuration

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

The `cloudflare()` plugin:
- Automatically locates `wrangler.jsonc` in the app directory
- Runs the Worker in `workerd` during `vite dev`
- Routes `/api/*` requests to the Worker
- Handles build output for both SPA and Worker

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

/** A candidate match from the tickers data. */
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
  /** Matching companies from tickers data */
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

/** Load and search company tickers from Worker API (/api/tickers). */
export function searchCompanies(query: string): Promise<CompanyMatch[]>;

/** Find exact match by ticker. */
export function findByTicker(ticker: string): Promise<CompanyMatch | null>;

/** Find by CIK number. */
export function findByCik(cik: string): Promise<CompanyMatch | null>;
```

### `apps/web/src/services/sec-submissions.ts`

```typescript
import type { Company } from './types';

/** Fetch full company details from SEC submissions API via Worker proxy. */
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
              fetchCompanySubmissions(cik) via Worker proxy
                    │
                    ├─ Client: fetch('/api/sec/submissions/CIK{cik}.json')
                    │
                    ├─ Worker: fetch('https://data.sec.gov/submissions/CIK{cik}.json')
                    │           with User-Agent header
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

### Request Flow Detail

```
Browser (SPA)                 Worker (workerd/Cloudflare)           SEC EDGAR
     │                              │                                  │
     │  GET /api/tickers            │                                  │
     │─────────────────────────────>│                                  │
     │                              │  Check Cache API                 │
     │                              │  (cache hit → return cached)     │
     │                              │                                  │
     │                              │  GET company_tickers.json        │
     │                              │─────────────────────────────────>│
     │                              │<─────────────────────────────────│
     │                              │  Cache response (24h TTL)        │
     │  <───────────────────────────│                                  │
     │  (JSON + CORS headers)       │                                  │
     │                              │                                  │
     │  GET /api/sec/submissions/   │                                  │
     │      CIK0000320193.json      │                                  │
     │─────────────────────────────>│                                  │
     │                              │  GET /submissions/               │
     │                              │      CIK0000320193.json          │
     │                              │─────────────────────────────────>│
     │                              │<─────────────────────────────────│
     │  <───────────────────────────│                                  │
     │  (JSON + CORS headers)       │                                  │
```

### Why Two Stages?

1. **Ticker resolution** (via Worker `/api/tickers`): Fast after initial load, handles ticker/CIK/name lookup client-side. Data cached at the edge for 24 hours.
2. **API confirmation** (via Worker `/api/sec/submissions/*`): Confirms the company exists, gets the canonical name, and later (US-2.9) provides the filing list. Only called once per selection.

This avoids hammering the SEC API during typeahead — all search-as-you-type happens client-side against cached ticker data.

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

## Dependencies

### New Dev Dependencies (`apps/web/package.json`)

```json
{
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "wrangler": "^4.0.0"
  }
}
```

### Existing (no changes)

- React 19 built-in hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Native `fetch` API (via Worker proxy)
- Existing `@edgar-diff/lib` types (for `FormType` if needed later)
- `vitest` + `@testing-library/react` + `@testing-library/user-event` for testing

### Zero New Runtime Dependencies

All new dependencies are dev/build-time only. The Worker runs on Cloudflare's runtime; `wrangler` and the Vite plugin are build tools.

---

## Local Development

### Dev Workflow

```bash
# Start dev server (Vite + Worker in workerd)
pnpm nx run web:dev

# The cloudflare() Vite plugin automatically:
# 1. Starts the React SPA dev server on port 5173
# 2. Runs the Worker in workerd (Cloudflare's runtime)
# 3. Routes /api/* requests to the Worker
# 4. HMR works for both SPA and Worker code
```

No separate `wrangler dev` process is needed. The Vite plugin handles everything.

### Build & Preview

```bash
# Build for production
pnpm nx run web:build
# Output: dist/client (SPA assets) + dist/worker (Worker bundle)

# Preview locally in workerd
pnpm nx run web:preview
# Runs the full production build in the Workers runtime

# Deploy to Cloudflare
pnpm exec wrangler deploy --config apps/web/wrangler.jsonc
```

---

## Edge Cases

### Input Handling
- **Empty input / < 2 chars**: Clear results, return to idle. No API calls.
- **Whitespace-only input**: Trim and treat as empty.
- **Very rapid typing**: Debounce (300ms) ensures only the final value triggers a search. In-flight fetches are aborted via `AbortController` when the query changes.

### Resolution Ambiguity
- **Multiple matches**: Show dropdown list (max 10 results). User must click to select.
- **Single exact ticker match**: Auto-select without requiring a click.
- **CIK input** (all digits): Look up directly in CIK index. If not found, attempt submissions API directly (CIK might be valid but not in the cached tickers data).
- **Company not in cached tickers**: If the user enters a valid CIK that's not in the tickers data, the submissions API call via Worker will still work (CIK is used directly). Show an appropriate message.

### Network Failures
- **Submissions API returns 404**: "Company not found. Check the CIK and try again."
- **Submissions API returns 429 (rate limited)**: "SEC rate limit reached. Please wait a moment and try again."
- **Network error / timeout**: "Unable to reach SEC. Check your connection."
- **Tickers API fails** (`/api/tickers` returns error): Fall back to CIK-only mode. Show a warning that ticker/name search is unavailable.
- **Worker returns 502** (SEC upstream error): "SEC data temporarily unavailable. Try again shortly."

### Worker-Specific Edge Cases
- **Cold start latency**: Cloudflare Workers have near-zero cold starts (~0ms). Not a concern in practice, but the first `/api/tickers` request may be slow due to the upstream SEC fetch (~500ms). Subsequent requests are cached.
- **Cache staleness**: Tickers data is cached for 24 hours. New IPOs or delistings within that window won't appear. Acceptable tradeoff — users can enter CIKs directly for very new companies.
- **Local dev parity**: The `@cloudflare/vite-plugin` runs Worker code in `workerd`, the same runtime used in production. The Cache API works locally. Environment variables are read from `wrangler.jsonc` `vars`.
- **Worker size limit**: The Worker is a simple proxy (~2 KB). Well within Cloudflare's 1 MB free-tier limit.

### State Transitions
- **User clears search after selecting a company**: Reset `selectedCompany` to `null`, notify `App` via `onCompanySelect(null)`.
- **User searches again after a resolved company**: Clear the resolved state, show new results.
- **Component unmounts during fetch**: `AbortController` cancels in-flight requests. `useEffect` cleanup prevents state updates on unmounted components.

---

## Rate Limiting Considerations

The Worker-cached tickers data means the only SEC API call during search is the submissions fetch after the user selects a company. This is a single request per company selection — well within the 10 req/s limit even without explicit rate limiting.

The tickers data fetch happens at most once per 24-hour cache window, regardless of how many users are searching.

For US-2.10 (Live Diff Pipeline), a shared `TokenBucketRateLimiter` instance will be created at the app level and passed to both the company search service and the `createEdgarClient` instance. That's future work — US-2.8 doesn't need it.

---

## Open Questions

1. **User-Agent value**: The SEC requires `"CompanyName email@example.com"` format. Currently set in `wrangler.jsonc` `vars`. Should this be a Cloudflare secret instead of a plain var? (Tentative answer: it's not sensitive — email is standard practice — but can be moved to `wrangler secret` if desired.)

2. **Exchange data**: The SEC's `company_tickers.json` has a sibling file `company_tickers_exchange.json` that includes exchange information. Should we use this richer file instead? (Tentative answer: yes — the exchange column adds useful context in search results with minimal extra data.)

3. **Submissions response caching**: Should the Worker also cache submissions API responses? (Tentative answer: not for US-2.8. The submissions data changes frequently as new filings are added. Caching at the Worker level could serve stale filing lists. Better to handle caching in US-2.9/US-2.10 with explicit invalidation.)

4. **Multiple Workers vs. single Worker**: Should we split the proxy and tickers into separate Workers? (Tentative answer: no. A single Worker is simpler to configure, deploy, and reason about. Split only if the concerns diverge significantly in the future.)
