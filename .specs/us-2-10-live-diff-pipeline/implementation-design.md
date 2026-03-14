# US-2.10: Live Diff Pipeline — Implementation Design

## Overview

When both Filing A and Filing B are selected, the app automatically executes a fetch→parse→diff pipeline and renders the result. Loading indicators show per stage, errors are user-friendly, results are cached in memory, and the SEC rate limiter is shared across all requests.

---

## Approach

The core abstraction is a `useDiffPipeline` hook that serves as a **thin React binding** around framework-agnostic pipeline logic. The hook manages a finite state machine (`idle → fetching → parsing → diffing → done | error`) and returns the pipeline outputs directly (status, documents, diff, error) for UI consumption. The pipeline orchestration itself — fetching, parsing, diffing, caching, abort handling — uses only plain async functions and `Map` objects, with no React dependencies. This separation is intentional: it allows the pipeline logic to be extracted into a standalone service or moved to a Web Worker without changing its core behavior (see [Alternatives Considered](#alternatives-considered)).

**Strategy:**

1. **Create a `ProxiedEdgarClient` factory** — Wraps `createEdgarClient` with a custom `fetch` that rewrites SEC URLs to route through the Worker proxy. The library hits `efts.sec.gov` and `www.sec.gov/Archives/...` directly; we intercept these to go through `/api/sec/efts/...` and `/api/sec/archives/...` proxy routes.

2. **Add Worker proxy routes** — Two new routes: `/api/sec/efts/*` → `efts.sec.gov` and `/api/sec/archives/*` → `www.sec.gov/Archives/*`. These follow the same pattern as the existing `/api/sec/submissions/*` proxy.

3. **Build the `useDiffPipeline` hook** — Reacts to `selectedFilingA` + `selectedFilingB` changes, runs the pipeline stages with granular status tracking, caches results by accession-number pair, and aborts in-flight work if selections change.

4. **Wire into App.tsx** — Replace `sampleDocument`/`buildSampleDiffs()` with live pipeline data. Pass `oldDoc`/`newDoc` and `sectionDiffs` from the pipeline result to each `FilingPanel`.

5. **Add loading/error states to FilingPanel** — Show stage-aware loading indicators and user-friendly error messages in the content area.

**What's NOT in scope:**
- Persistent/disk caching (memory cache only for MVP)
- Prefetching filings before selection
- Web Worker offloading for parse/diff (noted as future optimization)

---

## Alternatives Considered

### Why a React hook?

The `useDiffPipeline` hook is intentionally a **thin React binding layer** around framework-agnostic pipeline logic. The core orchestration — fetching, parsing, diffing, caching, abort — uses only plain async functions, `Map` objects, and `AbortController`. None of this requires React. The hook's React-specific surface is minimal (~20 lines): `useState` for exposing status/results, `useEffect` for triggering on input changes and cleanup, and `useRef` for cache/client persistence across renders.

This separation is deliberate: the pipeline logic can be extracted into a standalone module (e.g., `DiffPipelineService`) without changing its behavior. The hook would then become a subscriber that calls the service and forwards state to React.

### Alternatives evaluated

| Alternative | Pros | Cons | Why not chosen |
|-------------|------|------|----------------|
| **Standalone service class** (`DiffPipelineService` with EventEmitter/callback pattern) | Framework-agnostic from day one; trivially movable to Web Worker | Requires a subscription mechanism (EventEmitter, Observable, or callback) to push state updates to React; more boilerplate for MVP; event-based patterns add indirection without immediate benefit | Over-engineering for current scope. The hook's internal `runPipeline()` function is already a plain async function that can be extracted verbatim into a service class when needed. |
| **State machine library** (XState, Zag) | Formal FSM with guaranteed valid transitions; visual state charts; built-in support for parallel states | Adds a dependency; learning curve for contributors; our FSM is linear (`idle→fetching→parsing→diffing→done\|error`) with no parallel/nested states — XState's power isn't needed | Complexity mismatch. A linear pipeline with per-stage try/catch is simpler and equally correct. XState would be warranted if we had branching/parallel states. |
| **TanStack Query (React Query)** | Built-in caching, deduplication, stale-while-revalidate, devtools | Designed for single-request data fetching, not multi-stage pipelines; no native concept of "stages" for loading indicators; our 3-tier cache (filing → document → diff) doesn't map to its key-based model; would need to split into 3 separate queries and manually orchestrate sequencing | Wrong abstraction level. TanStack Query manages individual data fetches; our pipeline orchestrates a sequence of fetch→parse→diff with shared caches across stages. |
| **Zustand / Jotai store** | Global state accessible anywhere; no prop drilling; good devtools | Introduces external state management for a single feature; the pipeline state is inherently scoped to the App component tree (not needed globally); adds a dependency | Premature. If multiple components need independent access to pipeline state, a store becomes justified. Currently only `App` consumes it and passes data down via props (matching existing patterns like `useFilingList`). |

### Web Worker migration path

The design explicitly supports future Web Worker offloading. Here's how:

**Step 1: Extract service (no Worker yet)**
```
useDiffPipeline hook
  └── calls runPipeline() directly (current)

↓ refactor to ↓

useDiffPipeline hook
  └── calls DiffPipelineService.run(accA, accB)
        └── returns { status, oldDocument, newDocument, diff, error }
```

The `runPipeline()` async function, caches, and `classifyFetchError()` move into `DiffPipelineService` unchanged. The hook becomes a thin caller that sets React state from the service's return value.

**Step 2: Move service to Web Worker**
```
useDiffPipeline hook (main thread)
  └── Comlink.wrap(new Worker('./diff-pipeline.worker.ts'))
        └── DiffPipelineService.run(accA, accB)  ← runs in Worker
              └── posts status updates via Comlink proxy
```

Key design choices that enable this migration:
- **Per-stage try/catch** → maps to discrete worker message types (`{ type: 'status', stage: 'parsing' }`)
- **Caches are plain `Map` objects** → transferable to a Worker context (no React refs needed)
- **`EdgarClient` accepts custom `fetch`** → Worker can use its own `fetch` or the main thread's via proxy
- **Abort via `AbortController`** → Worker can receive abort signals via `postMessage`
- **No React APIs in pipeline logic** → `parseFiling` and `diffFilings` are pure functions, fully Worker-compatible

The only non-trivial aspect is the `EdgarClient` creation (which currently uses a browser `fetch` with URL rewriting). In a Worker context, the Worker would either create its own client or receive a `MessagePort` for proxied fetches. Both approaches are straightforward.

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/services/edgar-client-factory.ts` | Creates a proxied `EdgarClient` with shared rate limiter and custom fetch that rewrites SEC URLs to Worker proxy routes |
| `apps/web/src/services/edgar-client-factory.test.ts` | Tests URL rewriting, rate limiter sharing, dispose behavior |
| `apps/web/src/hooks/useDiffPipeline.ts` | React hook: orchestrates fetch→parse→diff, manages stage status, caches results, aborts on selection change |
| `apps/web/src/hooks/useDiffPipeline.test.ts` | Hook tests: stage transitions, caching, abort, error handling, edge cases |
| `apps/web/worker/handle-efts-proxy.ts` | Worker handler for `/api/sec/efts/*` → `efts.sec.gov` proxy |
| `apps/web/worker/handle-archives-proxy.ts` | Worker handler for `/api/sec/archives/*` → `www.sec.gov/Archives/*` proxy |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/services/types.ts` | Add `PipelineStatus` type |
| `apps/web/src/App.tsx` | Replace sample data with `useDiffPipeline` hook; pass live data to panels and SectionNav; remove fixture imports |
| `apps/web/src/components/FilingPanel.tsx` | Add `pipelineStatus` and `pipelineError` (string) props; render loading/error states in content area |
| `apps/web/src/components/FilingPanel.test.tsx` | Tests for loading indicator per stage and error message rendering |
| `apps/web/worker/index.ts` | Add routing for `/api/sec/efts/*` and `/api/sec/archives/*` |
| `apps/web/worker/index.test.ts` | Tests for new proxy routes |

---

## Interfaces and Types

### Pipeline Types (in `services/types.ts`)

```typescript
/** Overall pipeline status. */
export type PipelineStatus = 'idle' | 'fetching' | 'parsing' | 'diffing' | 'done' | 'error';
```

### Hook Return Type

```typescript
export interface UseDiffPipelineReturn {
  status: PipelineStatus;
  error: string | null;              // User-friendly error message
  oldDocument: StructuredDocument | null;
  newDocument: StructuredDocument | null;
  diff: StructuredDiff | null;
}
```

### Hook Signature

```typescript
export function useDiffPipeline(
  filingA: string | null,   // accession number
  filingB: string | null,   // accession number
): UseDiffPipelineReturn;
```

### Cache Key Strategy

```typescript
// Cache is a Map keyed by ordered accession number pair.
// (A,B) and (B,A) are DIFFERENT cache keys because diffFilings(A,B)
// produces a different result than diffFilings(B,A) (old/new sides swap).
type CacheKey = `${string}:${string}`;  // "accA:accB" (ordered, not sorted)

function makeCacheKey(accA: string, accB: string): CacheKey {
  return `${accA}:${accB}`;
}
```

**Note:** Individual `RawFiling` and `StructuredDocument` results are also cached independently by accession number. This means if the user changes only Filing B, Filing A doesn't need to be re-fetched or re-parsed. And if the user swaps A↔B, the individual filings are already cached — only the diff needs recomputation.

### Individual Caches

```typescript
// Per-filing caches (shared across pipeline invocations via ref)
const filingCache = useRef(new Map<string, RawFiling>());
const documentCache = useRef(new Map<string, StructuredDocument>());
// Full diff results (keyed by ordered pair)
const diffCache = useRef(new Map<CacheKey, DiffCacheEntry>());

interface DiffCacheEntry {
  oldDocument: StructuredDocument;
  newDocument: StructuredDocument;
  diff: StructuredDiff;
}
```

### Edgar Client Factory

```typescript
// services/edgar-client-factory.ts

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
    userAgent: '',  // Worker proxy injects the real User-Agent
    rateLimiter: getSharedRateLimiter(),
    fetch: createProxiedFetch(),
  });
}
```

---

## Data Flow

### Pipeline Sequence

```
User selects Filing A + Filing B
           │
           ▼
    useDiffPipeline(filingA, filingB)
           │
           ├── Check diffCache (accA:accB) → HIT → return cached result (status: 'done')
           │
           ├── MISS → status: 'fetching'
           │     │
           │     ├── Check filingCache[accA] → HIT → use cached RawFiling
           │     ├── Check filingCache[accB] → HIT → use cached RawFiling
           │     ├── MISS → edgarClient.fetchFiling(accA)  ─┐
           │     └── MISS → edgarClient.fetchFiling(accB)  ─┤ (parallel, rate-limited)
           │                                                 │
           │     ◄───────────── RawFiling A, RawFiling B ────┘
           │     │
           │     ├── Store in filingCache
           │     │
           │     ▼ status: 'parsing'
           │     │
           │     ├── Check documentCache[accA] → HIT → use cached
           │     ├── Check documentCache[accB] → HIT → use cached
           │     ├── MISS → parseFiling(rawA)  ─┐
           │     └── MISS → parseFiling(rawB)  ─┤ (sequential, synchronous)
           │                                     │
           │     ◄──── StructuredDocument A, B ──┘
           │     │
           │     ├── Store in documentCache
           │     │
           │     ▼ status: 'diffing'
           │     │
           │     └── diffFilings(docA, docB)
           │              │
           │              ▼
           │         StructuredDiff
           │              │
           │     ├── Store in diffCache
           │     │
           │     ▼ status: 'done'
           │
           └── return { status, error, oldDocument, newDocument, diff }
```

### App Integration

```
App.tsx
  │
  ├── selectedCompany → useFilingList(company) → filings[]
  ├── selectedFilingA (state)
  ├── selectedFilingB (state)
  │
  ├── useDiffPipeline(filingA?.accessionNumber, filingB?.accessionNumber)
  │     │
  │     └── { status, error, oldDocument, newDocument, diff }
  │
  ├── SectionNav
  │     └── sections derived from diff?.sectionDiffs (or empty)
  │
  ├── FilingPanel "Filing A"
  │     ├── document = oldDocument
  │     ├── sectionDiffs = diff?.sectionDiffs
  │     ├── side = "old"
  │     └── pipelineStatus / pipelineError (string)
  │
  └── FilingPanel "Filing B"
        ├── document = newDocument
        ├── sectionDiffs = diff?.sectionDiffs
        ├── side = "new"
        └── pipelineStatus / pipelineError (string)
```

### Worker Proxy Routes (new)

```
Browser                          Worker                             SEC
  │                                │                                │
  │ GET /api/sec/efts/search-index │                                │
  │ ─────────────────────────────► │ GET efts.sec.gov/LATEST/       │
  │                                │  search-index?q=...            │
  │                                │ ──────────────────────────────►│
  │                                │ ◄──────────────────────────────│
  │ ◄───────────────────────────── │                                │
  │                                │                                │
  │ GET /api/sec/archives/edgar/   │                                │
  │   data/{cik}/{acc}/{file}      │ GET www.sec.gov/Archives/      │
  │ ─────────────────────────────► │   edgar/data/{cik}/{acc}/{file}│
  │                                │ ──────────────────────────────►│
  │                                │ ◄──────────────────────────────│
  │ ◄───────────────────────────── │                                │
```

---

## Hook Implementation Sketch

```typescript
// hooks/useDiffPipeline.ts

import { useState, useEffect, useRef } from 'react';
import { parseFiling, diffFilings, EdgarNetworkError } from '@edgar-diff/lib';
import type { RawFiling, StructuredDocument, StructuredDiff } from '@edgar-diff/lib';
import { createProxiedEdgarClient } from '../services/edgar-client-factory';
import type { PipelineStatus } from '../services/types';

type CacheKey = `${string}:${string}`;

function makeCacheKey(a: string, b: string): CacheKey {
  return `${a}:${b}`;
}

interface DiffCacheEntry {
  oldDocument: StructuredDocument;
  newDocument: StructuredDocument;
  diff: StructuredDiff;
}

export interface UseDiffPipelineReturn {
  status: PipelineStatus;
  error: string | null;
  oldDocument: StructuredDocument | null;
  newDocument: StructuredDocument | null;
  diff: StructuredDiff | null;
}

export function useDiffPipeline(
  filingA: string | null,  // accession number
  filingB: string | null,  // accession number
): UseDiffPipelineReturn {
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [oldDocument, setOldDocument] = useState<StructuredDocument | null>(null);
  const [newDocument, setNewDocument] = useState<StructuredDocument | null>(null);
  const [diff, setDiff] = useState<StructuredDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Caches persist across renders (but not across unmounts)
  const filingCache = useRef(new Map<string, RawFiling>());
  const documentCache = useRef(new Map<string, StructuredDocument>());
  const diffCache = useRef(new Map<CacheKey, DiffCacheEntry>());

  // Stable client reference (create once, reuse)
  const clientRef = useRef(createProxiedEdgarClient());

  useEffect(() => {
    // Reset if either filing is deselected
    if (!filingA || !filingB) {
      setStatus('idle');
      setOldDocument(null);
      setNewDocument(null);
      setDiff(null);
      setError(null);
      return;
    }

    const cacheKey = makeCacheKey(filingA, filingB);

    // Check diff cache first
    const cached = diffCache.current.get(cacheKey);
    if (cached) {
      setOldDocument(cached.oldDocument);
      setNewDocument(cached.newDocument);
      setDiff(cached.diff);
      setStatus('done');
      setError(null);
      return;
    }

    // Abort any in-flight pipeline
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Run pipeline
    const runPipeline = async () => {
      const signal = controller.signal;
      const client = clientRef.current;

      // === FETCH STAGE ===
      setStatus('fetching');
      setError(null);
      setOldDocument(null);
      setNewDocument(null);
      setDiff(null);

      let rawA: RawFiling, rawB: RawFiling;
      try {
        const fetchOne = async (acc: string): Promise<RawFiling> => {
          const c = filingCache.current.get(acc);
          if (c) return c;
          const raw = await client.fetchFiling(acc);
          if (!signal.aborted) filingCache.current.set(acc, raw);
          return raw;
        };

        [rawA, rawB] = await Promise.all([fetchOne(filingA), fetchOne(filingB)]);
      } catch (err: unknown) {
        if (signal.aborted) return;
        setStatus('error');
        setError(classifyFetchError(err));
        return;
      }
      if (signal.aborted) return;

      // === PARSE STAGE ===
      setStatus('parsing');

      let docA: StructuredDocument, docB: StructuredDocument;
      try {
        const parseOne = (raw: RawFiling): StructuredDocument => {
          const c = documentCache.current.get(raw.accessionNumber);
          if (c) return c;
          const doc = parseFiling(raw);
          documentCache.current.set(raw.accessionNumber, doc);
          return doc;
        };

        docA = parseOne(rawA);
        docB = parseOne(rawB);
      } catch {
        if (signal.aborted) return;
        setStatus('error');
        setError('Unable to parse filing');
        return;
      }
      if (signal.aborted) return;

      // === DIFF STAGE ===
      setStatus('diffing');

      let diffResult: StructuredDiff;
      try {
        diffResult = diffFilings(docA, docB);
      } catch {
        if (signal.aborted) return;
        setStatus('error');
        setError('Unable to compute diff');
        return;
      }
      if (signal.aborted) return;

      // === DONE ===
      const entry: DiffCacheEntry = {
        oldDocument: docA,
        newDocument: docB,
        diff: diffResult,
      };
      diffCache.current.set(cacheKey, entry);
      setOldDocument(docA);
      setNewDocument(docB);
      setDiff(diffResult);
      setStatus('done');
    };

    runPipeline();

    return () => {
      controller.abort();
    };
  }, [filingA, filingB]);

  // Cleanup client on unmount
  useEffect(() => {
    return () => {
      clientRef.current.dispose();
    };
  }, []);

  return { status, error, oldDocument, newDocument, diff };
}

/**
 * Map fetch errors to user-friendly messages.
 * Uses instanceof EdgarNetworkError for reliable status code detection
 * instead of fragile string matching on error messages.
 */
export function classifyFetchError(err: unknown): string {
  // Typed library errors with HTTP status codes
  if (err instanceof EdgarNetworkError) {
    if (err.statusCode === 404) return 'Filing not available';
    if (err.statusCode === 429) return 'SEC rate limit exceeded. Please wait and try again.';
    return 'SEC service temporarily unavailable';
  }

  // Network-level failures (offline, timeout, CORS)
  if (err instanceof TypeError) {
    return 'Unable to fetch filing. Check your connection.';
  }

  return 'Unable to fetch filing';
}
```

---

## App.tsx Integration Sketch

```typescript
// Key changes to App.tsx:

import { useDiffPipeline } from './hooks/useDiffPipeline';
// Remove: import { sampleDocument } from './fixtures/sample-filing';
// Remove: import { buildSampleDiffs } from './fixtures/sample-diff';

export function App() {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const { filings, status: filingListStatus } = useFilingList(selectedCompany);
  const [selectedFilingA, setSelectedFilingA] = useState<AvailableFiling | null>(null);
  const [selectedFilingB, setSelectedFilingB] = useState<AvailableFiling | null>(null);

  // Live pipeline replaces sample data
  const {
    status: pipelineStatus,
    error: pipelineError,
    oldDocument,
    newDocument,
    diff,
  } = useDiffPipeline(
    selectedFilingA?.accessionNumber ?? null,
    selectedFilingB?.accessionNumber ?? null,
  );

  // Derive sections from live diff (was from sampleDiffs)
  const sections = useMemo(() => {
    if (!diff) return [];
    return diff.sectionDiffs.map((sd) => ({
      id: sd.id,
      heading: sd.heading,
      changeType: sd.changeType,
      changeCount: countChanges(sd),
    }));
  }, [diff]);

  const diffSummary = useMemo(() => {
    if (!diff) return { added: 0, removed: 0, modified: 0, unchanged: 0 };
    return diff.summary;
  }, [diff]);

  // ... rest of component

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar onCompanySelect={setSelectedCompany} />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav sections={sections} ... diffSummary={diffSummary} />
        <FilingPanel
          ref={oldPanelRef}
          label="Filing A"
          document={oldDocument}
          sectionDiffs={diff?.sectionDiffs}
          side="old"
          filings={filings}
          selectedFiling={selectedFilingA?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingA}
          filingListStatus={filingListStatus}
          pipelineStatus={pipelineStatus}
          pipelineError={pipelineError}
        />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel
          ref={newPanelRef}
          label="Filing B"
          document={newDocument}
          sectionDiffs={diff?.sectionDiffs}
          side="new"
          filings={filings}
          selectedFiling={selectedFilingB?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingB}
          filingListStatus={filingListStatus}
          pipelineStatus={pipelineStatus}
          pipelineError={pipelineError}
        />
      </main>
    </div>
  );
}
```

---

## FilingPanel Loading/Error States

```typescript
// Updated FilingPanel content area (replaces the simple conditional):

<div ref={ref} className="flex-1 overflow-y-auto p-4">
  {pipelineStatus === 'error' && pipelineError ? (
    <div className="flex items-center justify-center h-full" role="alert">
      <p className="text-sm text-red-600 font-medium">{pipelineError}</p>
    </div>
  ) : pipelineStatus === 'fetching' || pipelineStatus === 'parsing' || pipelineStatus === 'diffing' ? (
    <div className="flex items-center justify-center h-full" role="status" aria-live="polite">
      <div className="text-center">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-gray-500 mt-3">
          {pipelineStatus === 'fetching' && 'Fetching filings...'}
          {pipelineStatus === 'parsing' && 'Parsing filings...'}
          {pipelineStatus === 'diffing' && 'Computing diff...'}
        </p>
      </div>
    </div>
  ) : document ? (
    <FilingContent document={document} sectionDiffs={sectionDiffs} side={side} />
  ) : (
    <p className="text-sm text-gray-400 italic">Filing content will appear here</p>
  )}
</div>
```

---

## Worker Proxy Handlers

### EFTS Proxy (`/api/sec/efts/*`)

```typescript
// worker/handle-efts-proxy.ts

export async function handleEftsProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // /api/sec/efts/search-index?q=... → https://efts.sec.gov/LATEST/search-index?q=...
  const secPath = url.pathname.replace('/api/sec/efts/', '');
  const secUrl = `https://efts.sec.gov/LATEST/${secPath}${url.search}`;

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: { 'Content-Type': secResponse.headers.get('Content-Type') ?? 'application/json' },
    }),
    request,
  );
}
```

### Archives Proxy (`/api/sec/archives/*`)

```typescript
// worker/handle-archives-proxy.ts

export async function handleArchivesProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // /api/sec/archives/edgar/data/{cik}/{acc}/{file}
  //   → https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{file}
  const secPath = url.pathname.replace('/api/sec/archives/', '');

  // Basic path validation: must match edgar/data/{digits}/{accession}/{filename}
  if (!/^edgar\/data\/\d+\/\d+\/[\w.-]+$/.test(secPath)) {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Invalid archives path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  const secUrl = `https://www.sec.gov/Archives/${secPath}`;

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: {
        'Content-Type': secResponse.headers.get('Content-Type') ?? 'text/html',
      },
    }),
    request,
  );
}
```

### Worker Router Update

```typescript
// In worker/index.ts, add after the submissions route:

if (url.pathname.startsWith('/api/sec/efts/')) {
  console.log(`[Worker] GET ${url.pathname}`);
  return handleEftsProxy(request, env, url);
}

if (url.pathname.startsWith('/api/sec/archives/')) {
  console.log(`[Worker] GET ${url.pathname}`);
  return handleArchivesProxy(request, env, url);
}
```

---

## Edge Cases

### Same filing selected for both A and B
Self-diff is allowed — the pipeline runs normally and produces a diff where all sections are `unchanged`. This is simpler (no special-case code) and can serve as a useful sanity check. The per-filing caches ensure the filing is only fetched and parsed once even though it's used for both sides.

### Filing changed mid-pipeline (abort previous)
The `useEffect` cleanup function calls `controller.abort()`. Each async step checks `signal.aborted` before updating state. The `fetchFiling` calls will throw `AbortError` which is silently ignored (matching the `useFilingList` pattern). React state updates after abort are skipped.

### Rate limiting / 429 handling
The shared `TokenBucketRateLimiter` (capacity: 10, refillRate: 10/sec) is used across all `EdgarClient` instances. Since both filing fetches share the same limiter, they naturally stay within SEC's 10 req/sec limit. The library's `fetchWithRetry` handles transient 429s with exponential backoff (3 attempts, 1s base delay). The Worker proxy also surfaces 429 errors which are classified as user-friendly messages.

### Very large filings and UI blocking
`parseFiling` and `diffFilings` are synchronous and CPU-bound. For very large filings (10-K > 5MB HTML), these could block the main thread for noticeable periods. The design accepts this for MVP. **Future optimization:** Move parse/diff to a Web Worker using `Comlink` or `postMessage`.

Setting status to `'parsing'` and `'diffing'` before these operations ensures the loading indicator renders before the blocking work begins (React will flush the state update via the preceding `await`).

### Cache invalidation
Memory cache has no TTL — it lives for the lifetime of the component. This is acceptable because:
- SEC filings are immutable once filed
- The cache is cleared on page reload
- There is no staleness concern for comparing historical filings

### Company change
When `selectedCompany` changes, `App.tsx` already resets both `selectedFilingA` and `selectedFilingB` to `null`. This causes `useDiffPipeline` to reset to `idle`, which aborts any in-flight work and clears the result. The caches are intentionally NOT cleared on company change — a user might switch companies and come back, and previously fetched filings remain valid.

### Network errors
Errors from `fetchFiling` (network failures, timeouts, CORS issues) are caught and classified into user-friendly messages by `classifyError()`. The error includes the stage where failure occurred so the UI can show contextual messages.

### AbortController and EdgarClient interaction
The library's `fetchWithRetry` uses the injected `fetch` function, which in turn uses `globalThis.fetch`. To support abort, the hook creates an `AbortController` per pipeline run, but the library's `fetchFiling` doesn't accept an `AbortSignal`. Instead, the abort check happens between stages. If the fetch itself is in-flight when abort fires, the fetch will complete but its result will be discarded (checked via `signal.aborted`). **This is a known limitation** — the actual HTTP request is not cancelled, only the pipeline processing. For MVP, this is acceptable since individual fetch calls are short-lived and rate-limited.

---

## Open Questions

1. **AbortSignal threading into EdgarClient** — The library's `fetchFiling` doesn't accept an `AbortSignal`. For MVP, checking `signal.aborted` between stages is sufficient. Future library enhancement could add `signal` support. **Decision: accepted for MVP.**

2. **Cache size limits** — The memory cache grows unbounded. In practice, a user session is unlikely to compare more than ~20 filing pairs, and each filing is O(5-10MB). Should we add an LRU eviction policy? **Decision: no, MVP — page reload clears everything.**

3. **`diffSummary` shape mismatch** — `StructuredDiff.summary` includes `reordered` count, but the current `SectionNav` receives `{ added, removed, modified, unchanged }`. The `reordered` count should fold into `modified` for display purposes, matching the existing `countChanges` behavior.

4. **Worker proxy path validation** — The EFTS proxy is more permissive than the submissions proxy (which only allows `CIK\d{10}\.json`). Should we restrict EFTS proxy to only `search-index` paths? What about potential future EFTS endpoints?

## Design Decisions Log

Decisions made during coder/tester alignment:

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Hook takes `string \| null` accession numbers, not `AvailableFiling` objects | Hook only needs accession numbers for `fetchFiling()`. Avoids over-coupling and object-identity re-render issues. |
| D2 | Flat return shape `{ status, error, oldDocument, newDocument, diff }` | Simpler to consume in App/tests. `PipelineError` struct was over-engineered — status already provides stage context. |
| D3 | Self-diff allowed (no guard for same accession on both sides) | Simpler (no special-case code). Self-diff producing all-unchanged is a useful sanity check. Per-filing caches avoid double-fetch. |
| D4 | Ordered cache keys (not sorted) | `diffFilings(A,B)` ≠ `diffFilings(B,A)` — old/new metadata and source mappings differ. Flipping a cached diff is fragile. Per-filing/document caches still avoid redundant work on A↔B swap. |
| D5 | Per-stage try/catch instead of single catch + `classifyError` | Eliminates fragile string matching. Each stage catches its own errors and sets the appropriate user-friendly message directly. Fetch errors use `instanceof EdgarNetworkError` for reliable status code detection. |
| D6 | Unified pipeline status (not per-panel) | Per-panel granularity would significantly complicate hook and tests. Loading messages use plural ("Fetching filings..."). Enhancement opportunity if users request it. |
| D7 | Synchronous parse/diff on main thread | Acceptable for MVP. `setStatus` before sync work ensures loading indicator renders. Future optimization: Web Worker via Comlink. |
