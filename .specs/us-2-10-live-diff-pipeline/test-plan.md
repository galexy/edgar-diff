# US-2.10: Live Diff Pipeline — Test Plan

## Overview

US-2.10 connects the filing selectors (US-2.9) to the diff library, creating a live pipeline: when both Filing A and Filing B are selected, the app automatically fetches both filings, parses them, computes the diff, and renders the result. The pipeline includes per-stage loading indicators, user-friendly error messages, in-memory caching, and a shared SEC rate limiter.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify hook state machine, pipeline orchestration, caching, error handling, and component integration
2. **Visual validation** (Chrome DevTools MCP) — verify loading indicators, error messages, and end-to-end rendering (see `uat.md`)

### Architecture

The pipeline is orchestrated by a `useDiffPipeline` hook that manages a state machine with stages:

```
idle → fetching → parsing → diffing → done
                                     ↘ error (at any stage)
```

**Key dependencies (mocked in unit tests):**
- `createProxiedEdgarClient()` from `edgar-client-factory.ts` → `{ fetchFiling(accession): Promise<RawFiling>, dispose(): void }`
- `parseFiling(raw, options?)` → `StructuredDocument`
- `diffFilings(oldDoc, newDoc, options?)` → `StructuredDiff`
- `getSharedRateLimiter()` → singleton `TokenBucketRateLimiter` instance

**Hook interface (agreed):**

```typescript
type PipelineStatus = 'idle' | 'fetching' | 'parsing' | 'diffing' | 'done' | 'error';

interface UseDiffPipelineReturn {
  status: PipelineStatus;
  error: string | null;           // User-facing error message (flat string)
  oldDocument: StructuredDocument | null;
  newDocument: StructuredDocument | null;
  diff: StructuredDiff | null;
}

function useDiffPipeline(
  filingA: string | null,  // accession number
  filingB: string | null,  // accession number
): UseDiffPipelineReturn;
```

**Design decisions:**
- **Input**: Accession number strings (not `AvailableFiling` objects) — the hook only needs accession numbers
- **Return**: Flat shape with `error` as plain string — `pipelineStatus` already tells the UI what loading message to show
- **Self-diff**: Allowed — same accession for both A and B runs the pipeline; all sections show as unchanged
- **Cache key**: Ordered `"accA:accB"` (not sorted) — `diffFilings(A,B)` ≠ `diffFilings(B,A)`

### Key Types

```typescript
// From @edgar-diff/lib
interface RawFiling { accessionNumber: string; cik: string; formType: FormType; filingDate: Temporal.PlainDate; primaryDocumentFilename: string; html: string; fetchedAt: Temporal.Instant }
interface StructuredDocument { filing: RawFiling; sections: FilingSection[]; parseWarnings: string[] }
interface StructuredDiff { oldFiling: DiffFilingMetadata; newFiling: DiffFilingMetadata; sectionDiffs: SectionDiff[]; summary: { added, removed, modified, unchanged, reordered }; generatedAt: Temporal.Instant }
class EdgarNetworkError extends Error { statusCode: number; accessionNumber: string; retryAfter?: number }
```

---

## 1. BDD Acceptance Criteria

### AC-1: Happy path — auto pipeline on both filings selected

```gherkin
Scenario: Both Filing A and Filing B are selected and pipeline runs to completion
  Given the user has selected a company with available filings
  And the filing selectors are enabled
  When the user selects Filing A (accession "0000320193-23-000106")
  And the user selects Filing B (accession "0000320193-23-000077")
  Then the pipeline automatically starts
  And both filings are fetched via the proxied EdgarClient
  And both fetched filings are parsed via parseFiling
  And the diff is computed via diffFilings
  And the result is rendered in both FilingPanels
```

### AC-2: Stage loading indicators

```gherkin
Scenario: Loading indicator shows during each pipeline stage
  Given Filing A and Filing B are both selected
  When the pipeline is in the "fetching" stage
  Then a loading indicator shows "Fetching filings from SEC..."
  When the pipeline transitions to "parsing"
  Then the loading indicator shows "Parsing filing content..."
  When the pipeline transitions to "diffing"
  Then the loading indicator shows "Computing differences..."
  When the pipeline completes
  Then the loading indicator is removed and the diff result is displayed
```

### AC-3: Fetch error — user-friendly message

```gherkin
Scenario: Fetch failure shows user-friendly error message
  Given Filing A and Filing B are both selected
  When the fetch for Filing A fails with a 404 error
  Then the pipeline transitions to error state
  And the error message is "Filing not available. It may have been removed from EDGAR."
  And no parse or diff step is attempted
```

### AC-4: Parse error — user-friendly message

```gherkin
Scenario: Parse failure shows user-friendly error message
  Given Filing A and Filing B are both selected
  And both filings are fetched successfully
  When parseFiling throws an error
  Then the pipeline transitions to error state
  And the error message contains "Unable to parse"
  And no diff step is attempted
```

### AC-5: Diff error — user-friendly message

```gherkin
Scenario: Diff failure shows user-friendly error message
  Given Filing A and Filing B are both selected
  And both filings are fetched and parsed successfully
  When diffFilings throws an error
  Then the pipeline transitions to error state
  And the error message is a user-friendly fallback
```

### AC-6: Caching — re-selecting a previously viewed pair

```gherkin
Scenario: Re-selecting a previously diffed pair returns cached result
  Given the user has previously selected Filing A and Filing B and the diff completed
  And the user then selects different filings
  When the user re-selects the original Filing A and Filing B pair
  Then the pipeline does not re-fetch either filing
  And the cached result is returned immediately
  And the status transitions directly to "done"
```

### AC-7: Shared rate limiter

```gherkin
Scenario: Rate limiter is shared across all pipeline fetch requests
  Given the pipeline is about to fetch Filing A and Filing B
  When createProxiedEdgarClient is called
  Then the same TokenBucketRateLimiter instance (from getSharedRateLimiter) is used
  And the rate limiter constrains the total request rate across all fetches
```

### AC-8: Filing change mid-pipeline — abort and restart

```gherkin
Scenario: Changing a filing selection mid-pipeline aborts and restarts
  Given Filing A and Filing B are both selected and the pipeline is fetching
  When the user changes Filing B to a different filing
  Then the in-flight pipeline is aborted (via AbortController)
  And a new pipeline starts with the updated selection
  And the previous pipeline's results are discarded
```

### AC-9: One filing selected — pipeline stays idle

```gherkin
Scenario: Only one filing selected does not trigger the pipeline
  Given only Filing A is selected (Filing B is not selected)
  Then the pipeline status remains "idle"
  And no fetch, parse, or diff operations are triggered
```

### AC-10: Both filings cleared — pipeline returns to idle

```gherkin
Scenario: Clearing both filing selections returns pipeline to idle
  Given the pipeline has completed with a diff result
  When the user clears both filing selections
  Then the pipeline status returns to "idle"
  And diff, oldDocument, newDocument are all cleared to null
```

---

## 2. Unit Tests — `useDiffPipeline` hook

File: `apps/web/src/hooks/useDiffPipeline.test.ts`

### 2.1 Initial State & Preconditions

| ID | Test | Rationale |
|----|------|-----------|
| DP-U1 | No filings selected → status is `'idle'`, `oldDocument`/`newDocument`/`diff` null, `error` null | Initial state (AC-9) |
| DP-U2 | Only Filing A selected (Filing B null) → status is `'idle'` | Need both (AC-9) |
| DP-U3 | Only Filing B selected (Filing A null) → status is `'idle'` | Need both (AC-9) |

### 2.2 Happy Path — Pipeline Stages

| ID | Test | Rationale |
|----|------|-----------|
| DP-U4 | Both selected → status transitions `'idle'` → `'fetching'` → `'parsing'` → `'diffing'` → `'done'` | Full pipeline (AC-1) |
| DP-U5 | In `'fetching'` stage, `fetchFiling` is called for both accession numbers | Verifies fetch calls (AC-1) |
| DP-U6 | In `'parsing'` stage, `parseFiling` is called with both fetched RawFilings | Verifies parse calls (AC-1) |
| DP-U7 | In `'diffing'` stage, `diffFilings` is called with both StructuredDocuments | Verifies diff call (AC-1) |
| DP-U8 | In `'done'` stage, `diff` contains the StructuredDiff result | Result availability (AC-1) |
| DP-U9 | In `'done'` stage, `oldDocument` and `newDocument` contain the parsed documents | Documents available for rendering (AC-1) |
| DP-U10 | Error is null throughout successful pipeline | No spurious errors |

### 2.3 Error Handling

| ID | Test | Rationale |
|----|------|-----------|
| DP-U11 | `fetchFiling` rejects → status `'error'`, `error` is a user-friendly string | Fetch error (AC-3) |
| DP-U12 | `fetchFiling` throws `EdgarNetworkError(404, acc)` → `error` contains "Filing not available" | 404 mapping (AC-3) |
| DP-U13 | `fetchFiling` throws `EdgarNetworkError(429, acc, retryAfter)` → `error` contains "rate limit" | 429 mapping |
| DP-U14 | `fetchFiling` throws generic `TypeError('Failed to fetch')` → `error` is generic fallback | Network error |
| DP-U15 | `parseFiling` throws → status `'error'`, `error` is `'Unable to parse filing'` | Parse error — hardcoded by per-stage try/catch (AC-4) |
| DP-U16 | `diffFilings` throws → status `'error'`, `error` is `'Unable to compute diff'` | Diff error — hardcoded by per-stage try/catch (AC-5) |
| DP-U17 | Error state has `oldDocument: null`, `newDocument: null`, `diff: null` | Clean error state |
| DP-U18 | After error, selecting new valid filings → pipeline restarts and succeeds | Error recovery |

### 2.4 `classifyFetchError` Unit Tests

Exported pure function that only handles fetch-layer errors. Parse and diff errors are handled by per-stage try/catch blocks in the hook itself (hardcoded messages), so `classifyFetchError` is never called for those stages.

| ID | Test | Rationale |
|----|------|-----------|
| CE-U1 | `EdgarNetworkError(404, acc)` → `'Filing not available. It may have been removed from EDGAR.'` | 404 via `instanceof` + `statusCode` |
| CE-U2 | `EdgarNetworkError(429, acc, retryAfter)` → `'SEC rate limit reached. Please wait a moment and try again.'` | 429 via `instanceof` + `statusCode` |
| CE-U3 | `EdgarNetworkError(500, acc)` → generic SEC error fallback | 500 via `instanceof` + `statusCode` |
| CE-U4 | Generic `Error('something unrelated')` → generic fallback message | Catch-all for non-EDGAR errors |
| CE-U5 | Non-Error thrown (string, undefined) → `'An unexpected error occurred'` | Non-Error safety |

**Error handling strategy:** Each pipeline stage wraps its own try/catch:
- **Fetch stage**: catches errors and passes to `classifyFetchError(err)` for status-code-based classification
- **Parse stage**: catches errors and returns hardcoded `'Unable to parse filing'`
- **Diff stage**: catches errors and returns hardcoded `'Unable to compute diff'`

This eliminates fragile string matching entirely. The stage is always known unambiguously from the try/catch scope.

### 2.5 Caching

| ID | Test | Rationale |
|----|------|-----------|
| DP-U19 | Same pair re-selected → `fetchFiling` not called again, result returned from diff cache | Diff cache hit (AC-6) |
| DP-U20 | Cache hit → status transitions directly to `'done'` (no intermediate stages) | Instant cache (AC-6) |
| DP-U21 | Pair (A,B) cached, then (B,A) selected → cache miss, full pipeline runs (ordered key) | Ordered cache key — `diffFilings(A,B)` ≠ `diffFilings(B,A)` |
| DP-U22 | Different pair selected → cache miss, full pipeline runs | Cache miss |
| DP-U23 | Individual RawFiling cached — if Filing A is reused with a new Filing B, only Filing B is re-fetched | Per-filing fetch cache |
| DP-U24 | Individual StructuredDocument cached — if Filing A is reused, `parseFiling` not called again for it | Per-filing parse cache |

### 2.6 Abort & Restart

| ID | Test | Rationale |
|----|------|-----------|
| DP-U25 | Filing A changed mid-pipeline → previous pipeline aborted, new pipeline starts | Abort on change (AC-8) |
| DP-U26 | Filing B changed mid-pipeline → previous pipeline aborted, new pipeline starts | Abort on change (AC-8) |
| DP-U27 | Aborted pipeline's late-resolving results do not update state | Stale result ignored |
| DP-U28 | Both filings cleared mid-pipeline → pipeline aborted, status returns to `'idle'` | Clear mid-pipeline (AC-10) |
| DP-U29 | Rapid filing changes (A→B→C) → only latest pipeline runs | Supersede behavior |

### 2.7 Cleanup & Edge Cases

| ID | Test | Rationale |
|----|------|-----------|
| DP-U30 | Unmount during pipeline → no state-update warnings | React cleanup |
| DP-U31 | Same filing for both A and B → pipeline runs, diff shows all sections unchanged | Self-diff is valid |
| DP-U32 | AbortError from fetch is silently ignored (not treated as error) | Consistent with existing patterns |
| DP-U33 | Company change clears both filings → hook returns to idle, caches retained | Cross-company reuse |

### 2.8 Rate Limiter

| ID | Test | Rationale |
|----|------|-----------|
| DP-U34 | `createProxiedEdgarClient` passes `getSharedRateLimiter()` to `createEdgarClient` | Shared rate limiter (AC-7) |
| DP-U35 | Same rate limiter instance used across multiple hook render cycles | Singleton persistence |

### Test Pattern (following existing conventions)

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the client factory (not the library directly — the hook imports factory)
vi.mock('../services/edgar-client-factory', () => ({
  createProxiedEdgarClient: vi.fn(),
}));

vi.mock('@edgar-diff/lib', () => ({
  parseFiling: vi.fn(),
  diffFilings: vi.fn(),
}));

import { useDiffPipeline } from './useDiffPipeline';
import { createProxiedEdgarClient } from '../services/edgar-client-factory';
import { parseFiling, diffFilings } from '@edgar-diff/lib';

const mockCreateProxiedEdgarClient = vi.mocked(createProxiedEdgarClient);
const mockParseFiling = vi.mocked(parseFiling);
const mockDiffFilings = vi.mocked(diffFilings);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACCESSION_A = '0000320193-23-000106';
const ACCESSION_B = '0000320193-23-000077';
const ACCESSION_C = '0000320193-22-000108';  // For cache miss tests

const MOCK_RAW_FILING_A = {
  accessionNumber: ACCESSION_A,
  cik: '0000320193',
  formType: '10-K',
  filingDate: { toString: () => '2023-11-03' },
  primaryDocumentFilename: 'filing-a.htm',
  html: '<h2>Item 1. Business</h2><p>Content A</p>',
  fetchedAt: { toString: () => '2024-01-01T00:00:00Z' },
};

// ... similar MOCK_RAW_FILING_B, MOCK_STRUCTURED_DOC_A/B, MOCK_DIFF

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useDiffPipeline', () => {
  let mockFetchFiling: ReturnType<typeof vi.fn>;
  let mockDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchFiling = vi.fn();
    mockDispose = vi.fn();
    mockCreateProxiedEdgarClient.mockReturnValue({
      fetchFiling: mockFetchFiling,
      dispose: mockDispose,
    });
    mockParseFiling.mockReset();
    mockDiffFilings.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DP-U1: no filings selected → idle', () => {
    const { result } = renderHook(() => useDiffPipeline(null, null));
    expect(result.current.status).toBe('idle');
    expect(result.current.oldDocument).toBeNull();
    expect(result.current.newDocument).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('DP-U4: both selected → full pipeline', async () => {
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_B);
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B)
    );

    expect(result.current.status).toBe('fetching');

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.diff).toEqual(MOCK_DIFF);
    expect(result.current.oldDocument).toEqual(MOCK_STRUCTURED_DOC_A);
    expect(result.current.newDocument).toEqual(MOCK_STRUCTURED_DOC_B);
    expect(result.current.error).toBeNull();
  });

  it('DP-U31: same filing for both → pipeline runs (self-diff)', async () => {
    mockFetchFiling.mockResolvedValue(MOCK_RAW_FILING_A);
    mockParseFiling.mockReturnValue(MOCK_STRUCTURED_DOC_A);
    mockDiffFilings.mockReturnValue(MOCK_DIFF_IDENTICAL);

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_A)
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // fetchFiling may be called once (cached) or twice — either is fine
    expect(result.current.error).toBeNull();
  });
});
```

---

## 3. Unit Tests — `edgar-client-factory.ts`

File: `apps/web/src/services/edgar-client-factory.test.ts`

### 3.1 `createProxiedFetch` — URL Rewriting

| ID | Test | Rationale |
|----|------|-----------|
| ECF-U1 | `https://efts.sec.gov/LATEST/search-index?q=...` → `/api/sec/efts/search-index?q=...` | EFTS proxy rewrite |
| ECF-U2 | `https://www.sec.gov/Archives/edgar/data/320193/...` → `/api/sec/archives/edgar/data/320193/...` | Archives proxy rewrite |
| ECF-U3 | Non-SEC URL (e.g., `https://example.com/foo`) → unchanged | No rewrite for other URLs |
| ECF-U4 | User-Agent header is stripped from the outgoing request | Browser forbids UA; Worker proxy adds it |
| ECF-U5 | Other headers (Accept, etc.) are passed through | Only UA stripped |

### 3.2 `getSharedRateLimiter` — Singleton

| ID | Test | Rationale |
|----|------|-----------|
| ECF-U6 | First call creates a `TokenBucketRateLimiter` | Lazy initialization |
| ECF-U7 | Second call returns the same instance (referential equality) | Singleton guarantee (AC-7) |

### 3.3 `createProxiedEdgarClient` — Integration

| ID | Test | Rationale |
|----|------|-----------|
| ECF-U8 | Calls `createEdgarClient` with `rateLimiter` from `getSharedRateLimiter()` | Rate limiter injection |
| ECF-U9 | Calls `createEdgarClient` with a `fetch` option (the proxied fetch) | Custom fetch injection |
| ECF-U10 | Returns the client object from `createEdgarClient` | Passthrough |

---

## 4. Integration Tests — Pipeline Orchestration

File: `apps/web/src/hooks/useDiffPipeline.test.ts` (same file, separate `describe` block)

These tests verify the pipeline calls library functions with correct arguments and in correct order.

| ID | Test | Rationale |
|----|------|-----------|
| DP-I1 | `fetchFiling` called with Filing A's accession number | Correct argument |
| DP-I2 | `fetchFiling` called with Filing B's accession number | Correct argument |
| DP-I3 | Both fetches happen concurrently via `Promise.all` (not sequentially) | Performance: parallel fetch |
| DP-I4 | `parseFiling` called with the fetched RawFiling for Filing A | Correct parse input |
| DP-I5 | `parseFiling` called with the fetched RawFiling for Filing B | Correct parse input |
| DP-I6 | `diffFilings` called with (docA, docB) — docA is Filing A, docB is Filing B | Correct diff input and order |
| DP-I7 | `dispose()` called on EdgarClient when component unmounts | Resource cleanup |
| DP-I8 | EdgarClient is created once (via `useRef`) and reused across renders | No redundant client creation |

---

## 5. Component Integration Tests

File: `apps/web/src/App.test.tsx` (extends existing file)

These tests mock `useDiffPipeline` at the module level (consistent with existing `useFilingList` mock pattern) to verify App-level integration.

### 5.1 Pipeline Activation

| ID | Test | Rationale |
|----|------|-----------|
| APP-P1 | No company selected → pipeline not triggered (status `'idle'`) | No pipeline without context |
| APP-P2 | Company selected, no filings selected → pipeline stays `'idle'` | Needs both filings |
| APP-P3 | Company selected, both filings selected → pipeline runs, FilingPanels receive document data | End-to-end happy path |

### 5.2 Loading States

| ID | Test | Rationale |
|----|------|-----------|
| APP-P4 | Pipeline status `'fetching'` → loading indicator with "Fetching filings from SEC..." visible | Stage indicator (AC-2) |
| APP-P5 | Pipeline status `'parsing'` → loading indicator with "Parsing filing content..." visible | Stage indicator (AC-2) |
| APP-P6 | Pipeline status `'diffing'` → loading indicator with "Computing differences..." visible | Stage indicator (AC-2) |
| APP-P7 | Pipeline status `'done'` → no loading indicator, diff content rendered | Completion |

### 5.3 Error States

| ID | Test | Rationale |
|----|------|-----------|
| APP-P8 | Pipeline status `'error'` → error message displayed in `role="alert"` region | Error display (AC-3–5) |
| APP-P9 | Error message text matches `error` string from hook | Correct message forwarding |
| APP-P10 | Error state → FilingPanels do not show diff content (no `FilingContent` rendered) | Clean error UI |

### 5.4 Data Flow

| ID | Test | Rationale |
|----|------|-----------|
| APP-P11 | Pipeline `'done'` → SectionNav receives sections derived from `diff.sectionDiffs` | Nav integration |
| APP-P12 | Pipeline `'done'` → Filing A panel renders `oldDocument` content | Panel A data |
| APP-P13 | Pipeline `'done'` → Filing B panel renders `newDocument` content | Panel B data |
| APP-P14 | Pipeline `'done'` → change count badges update from `diff.sectionDiffs` | Badge integration |
| APP-P15 | Pipeline `'done'` → diff summary bar shows counts from `diff.summary` (with reordered folded into modified) | Summary bar |

### Test Pattern

```typescript
// Extends existing App.test.tsx mock pattern using vi.hoisted()
const { mockPipelineState, resetPipelineMock } = vi.hoisted(() => {
  const mockPipelineState = {
    status: 'idle' as string,
    error: null as string | null,
    oldDocument: null as StructuredDocument | null,
    newDocument: null as StructuredDocument | null,
    diff: null as StructuredDiff | null,
  };

  function resetPipelineMock() {
    mockPipelineState.status = 'idle';
    mockPipelineState.error = null;
    mockPipelineState.oldDocument = null;
    mockPipelineState.newDocument = null;
    mockPipelineState.diff = null;
  }

  return { mockPipelineState, resetPipelineMock };
});

vi.mock('./hooks/useDiffPipeline', () => ({
  useDiffPipeline: () => mockPipelineState,
}));
```

---

## 6. Component Tests — FilingPanel Loading/Error States

File: `apps/web/src/components/FilingPanel.test.tsx` (extends existing file)

| ID | Test | Rationale |
|----|------|-----------|
| FP-P1 | `pipelineStatus='fetching'` → spinner + "Fetching filings from SEC..." text rendered | Stage loading (AC-2) |
| FP-P2 | `pipelineStatus='parsing'` → spinner + "Parsing filing content..." text rendered | Stage loading (AC-2) |
| FP-P3 | `pipelineStatus='diffing'` → spinner + "Computing differences..." text rendered | Stage loading (AC-2) |
| FP-P4 | `pipelineStatus='done'` + document provided → `FilingContent` rendered | Normal rendering |
| FP-P5 | `pipelineStatus='error'` + `pipelineError` string → error message text rendered | Error display |
| FP-P6 | Loading indicator has `role="status"` with `aria-label` | Accessibility (A11Y-1) |
| FP-P7 | Error message has `role="alert"` | Accessibility (A11Y-2) |
| FP-P8 | `pipelineStatus='idle'` + no document → placeholder text rendered | Empty state |

---

## 7. Worker Proxy Tests

### 7.1 EFTS Proxy (`handle-efts-proxy.ts`)

File: `apps/web/worker/handle-efts-proxy.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| WP-E1 | `/api/sec/efts/search-index?q=apple` → proxies to `https://efts.sec.gov/LATEST/search-index?q=apple` | URL construction |
| WP-E2 | SEC User-Agent header added from `env.SEC_USER_AGENT` | EDGAR compliance |
| WP-E3 | Response body passed through | Transparent proxy |
| WP-E4 | CORS headers added to response | Browser compatibility |
| WP-E5 | SEC 404 → 404 forwarded to client | Error passthrough |
| WP-E6 | SEC 429 → 429 forwarded to client | Rate limit passthrough |

### 7.2 Archives Proxy (`handle-archives-proxy.ts`)

File: `apps/web/worker/handle-archives-proxy.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| WP-A1 | `/api/sec/archives/edgar/data/320193/000032019323000106/aapl.htm` → proxies to correct SEC URL | URL construction |
| WP-A2 | SEC User-Agent header added from `env.SEC_USER_AGENT` | EDGAR compliance |
| WP-A3 | Response body passed through with correct Content-Type | Transparent proxy |
| WP-A4 | CORS headers added to response | Browser compatibility |
| WP-A5 | Invalid path (e.g., `../../../etc/passwd`) → 400 error | Path validation security |
| WP-A6 | Path not matching `edgar/data/{digits}/{accession}/{filename}` → 400 | Path validation |

### 7.3 Worker Router

File: `apps/web/worker/index.test.ts` (extends existing)

| ID | Test | Rationale |
|----|------|-----------|
| WP-R1 | `GET /api/sec/efts/search-index` → routes to EFTS handler | Route matching |
| WP-R2 | `GET /api/sec/archives/edgar/data/...` → routes to Archives handler | Route matching |
| WP-R3 | `GET /api/sec/efts/` prefix matches any sub-path | Wildcard routing |
| WP-R4 | `GET /api/sec/archives/` prefix matches any sub-path | Wildcard routing |

---

## 8. Boundary Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| BC-1 | Filing with empty HTML (`html: ''`) → parseFiling returns document with no sections | Pipeline completes; diff has empty sectionDiffs |
| BC-2 | Filing with no sections (valid HTML but no Item headings) | Pipeline completes; diff summary shows all zeros |
| BC-3 | Very large filing HTML (>2MB) — synchronous parse/diff may block main thread | Pipeline completes (may be slow); no crash. Noted as future Web Worker optimization |
| BC-4 | Rapid filing changes (A₁→A₂→A₃ in quick succession) | Only the latest pair runs; intermediates aborted via AbortController |
| BC-5 | Zero section diffs (identical filings from different dates) | Pipeline completes; diff.sectionDiffs has all unchanged entries |
| BC-6 | One filing has many sections, the other has few | Pipeline completes; diff includes added/removed sections |
| BC-7 | Same filing for both A and B (self-diff) | Pipeline runs; diff shows all sections unchanged (valid use case) |
| BC-8 | Filing A and Filing B are from different companies (10-K vs 10-K) | Pipeline completes (library handles cross-company diff) |
| BC-9 | Cache grows over many pair comparisons — no LRU eviction | Memory grows unbounded; acceptable for MVP (page reload clears) |
| BC-10 | Company changed → both filings reset to null → pipeline idle, caches retained | Caches survive company switch for cross-company reuse |
| BC-11 | `StructuredDiff.summary.reordered` count in diff summary | Fold into "modified" for display in SectionNav/summary bar |

---

## 9. Error Conditions

| ID | Condition | Error message | Rationale |
|----|-----------|---------------|-----------|
| EC-1 | `EdgarNetworkError(404, acc)` from EDGAR | `'Filing not available. It may have been removed from EDGAR.'` | Filing removed or invalid accession |
| EC-2 | `EdgarNetworkError(429, acc, retryAfter)` from EDGAR | `'SEC rate limit reached. Please wait a moment and try again.'` | Rate limiting |
| EC-3 | `EdgarNetworkError(500, acc)` from EDGAR | Generic SEC error fallback | Server error |
| EC-4 | `TypeError('Failed to fetch')` (network failure) | Generic fallback | Offline / connectivity |
| EC-5 | `parseFiling` throws | `'Unable to parse filing'` (hardcoded in parse-stage try/catch) | Malformed HTML |
| EC-6 | `diffFilings` throws | `'Unable to compute diff'` (hardcoded in diff-stage try/catch) | Diff engine error |
| EC-7 | One filing fetch succeeds, other fails (`Promise.all` rejects) | Error from failed fetch | Partial failure |
| EC-8 | `AbortError` / `DOMException('AbortError')` from cancelled fetch | Silently ignored — no state update | Abort is not an error |
| EC-9 | Non-Error thrown (string, undefined) | `'An unexpected error occurred'` | Safety fallback |

---

## 10. Test Data / Fixtures

File: `apps/web/src/test-fixtures/diff-pipeline-fixtures.ts`

### 10.1 Accession Number Constants

| Fixture | Purpose |
|---------|---------|
| `ACCESSION_A` | `'0000320193-23-000106'` — AAPL 2023 10-K |
| `ACCESSION_B` | `'0000320193-23-000077'` — AAPL 2023 10-Q |
| `ACCESSION_C` | `'0000320193-22-000108'` — AAPL 2022 10-K (for cache miss tests) |

### 10.2 Mock RawFiling Fixtures

| Fixture | Purpose |
|---------|---------|
| `MOCK_RAW_FILING_A` | Base 10-K filing with minimal valid HTML (Item 1, Item 1A, Item 2) |
| `MOCK_RAW_FILING_B` | Comparison 10-Q filing with different content |
| `MOCK_RAW_FILING_EMPTY` | Filing with `html: '<html><body></body></html>'` (no sections) |

### 10.3 Mock StructuredDocument Fixtures

| Fixture | Purpose |
|---------|---------|
| `MOCK_STRUCTURED_DOC_A` | Parsed version of MOCK_RAW_FILING_A with 3 sections |
| `MOCK_STRUCTURED_DOC_B` | Parsed version of MOCK_RAW_FILING_B with 3 sections (modified content) |
| `MOCK_STRUCTURED_DOC_EMPTY` | Document with empty sections array |

### 10.4 Mock StructuredDiff Fixtures

| Fixture | Purpose |
|---------|---------|
| `MOCK_DIFF` | Complete diff with modified/added/unchanged sections |
| `MOCK_DIFF_IDENTICAL` | Diff where all sections are unchanged (for self-diff tests) |
| `MOCK_DIFF_EMPTY` | Diff with empty sectionDiffs |

### 10.5 EdgarClient Mock Helper

```typescript
function createMockEdgarClient(overrides?: {
  fetchFiling?: (accession: string) => Promise<RawFiling>;
  dispose?: () => void;
}) {
  return {
    fetchFiling: overrides?.fetchFiling ?? vi.fn(),
    dispose: overrides?.dispose ?? vi.fn(),
  };
}
```

### 10.6 Error Fixtures

```typescript
import { EdgarNetworkError } from '@edgar-diff/lib';

const MOCK_404_ERROR = new EdgarNetworkError(404, '0000320193-23-000106');
const MOCK_429_ERROR = new EdgarNetworkError(429, '0000320193-23-000106', 10);
const MOCK_500_ERROR = new EdgarNetworkError(500, '0000320193-23-000106');
const MOCK_NETWORK_ERROR = new TypeError('Failed to fetch');
const MOCK_PARSE_ERROR = new Error('Unexpected token in HTML');
const MOCK_DIFF_ERROR = new Error('Section alignment failure');
```

### 10.7 Fixture Design Principles

Following existing conventions (from `company-search-fixtures.ts` and `filing-list-fixtures.ts`):
- Fixtures use minimal but valid data (tiny HTML, few sections)
- Temporal values use mock objects with `toString()` (matching `App.test.tsx` pattern)
- Fixtures are exported as named constants
- Helper functions create customizable instances for edge-case tests

---

## 11. Test File Organization

```
apps/web/src/
  hooks/
    useDiffPipeline.ts               # New: pipeline hook (takes string accession numbers)
    useDiffPipeline.test.ts          # Unit tests (DP-U*, DP-I*, CE-U*)
  services/
    edgar-client-factory.ts          # New: proxied EdgarClient factory
    edgar-client-factory.test.ts     # Unit tests (ECF-U*)
  test-fixtures/
    diff-pipeline-fixtures.ts        # New: mock RawFiling, StructuredDocument, StructuredDiff
  components/
    FilingPanel.tsx                   # Extended: pipelineStatus/pipelineError props
    FilingPanel.test.tsx             # Extended: loading/error state tests (FP-P*)
  App.tsx                            # Extended: wires useDiffPipeline, removes fixture imports
  App.test.tsx                       # Extended: integration tests (APP-P*)

apps/web/worker/
  handle-efts-proxy.ts              # New: EFTS proxy handler
  handle-efts-proxy.test.ts         # Tests (WP-E*)
  handle-archives-proxy.ts          # New: Archives proxy handler
  handle-archives-proxy.test.ts     # Tests (WP-A*)
  index.ts                          # Extended: new routes
  index.test.ts                     # Extended: route tests (WP-R*)

.specs/us-2-10-live-diff-pipeline/
  test-plan.md                       # This file
  uat.md                             # Visual validation scenarios (future)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 12. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No real network | Cannot test actual EDGAR fetch | Mock `createProxiedEdgarClient`; library has its own integration tests |
| No CSS animation | Cannot verify spinner animation | Verify loading indicator element presence and text; UAT for visual |
| No `Temporal` polyfill in jsdom | Mock Temporal objects may behave differently | Use `toString()` mock pattern from App.test.tsx |
| No actual parsing/diffing | Cannot verify library correctness | Library has its own test suite; UI tests verify orchestration |
| No memory profiling | Cannot verify cache memory bounds | Verify cache-hit behavior; manual profiling for BC-9 |
| No Worker runtime | Cannot test proxy handlers in browser context | Test handlers as pure functions with mock Request/Response |

### What jsdom CAN verify (and we test thoroughly)

- Hook state machine transitions (`idle` → `fetching` → `parsing` → `diffing` → `done`)
- Error state transitions with user-friendly string messages
- `classifyFetchError` logic (via `instanceof EdgarNetworkError` + `statusCode`)
- Mock function call sequences and arguments
- 3-tier cache hit detection (filing, document, diff — with ordered keys)
- Abort behavior (stale results ignored, AbortError swallowed)
- Component rendering based on pipeline state (loading indicators, error messages, diff content)
- Accessibility (`role="status"` for loading, `role="alert"` for errors)
- Cleanup behavior (no state-update warnings on unmount, `dispose()` called)
- Rate limiter injection (singleton via `getSharedRateLimiter`)
- URL rewriting in `createProxiedFetch`
- Worker proxy handlers (URL construction, path validation, header forwarding)

---

## 13. Accessibility Tests

| ID | Test | Rationale |
|----|------|-----------|
| A11Y-1 | Loading indicator has `role="status"` with descriptive `aria-label` | Screen readers announce stage changes |
| A11Y-2 | Error message has `role="alert"` | Screen readers announce errors immediately |
| A11Y-3 | Loading indicator includes descriptive text (not just a spinner icon) | WCAG: information not conveyed by visual alone |
| A11Y-4 | Error message includes actionable guidance (not just "Error") | Usability for all users |

---

## 14. UAT — Visual Acceptance Tests (Tier 2)

Manual visual checks executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These complement the automated Tier 1 tests above by verifying visual layout, animations, and browser-rendered behavior that jsdom cannot test.

Full UAT steps are in the companion document: `.specs/us-2-10-live-diff-pipeline/uat.md`

### UAT Coverage Summary

| Area | Steps | What's Verified |
|------|-------|-----------------|
| Loading indicators | UAT-1 through UAT-3 | Spinner + stage-specific text visible during fetching/parsing/diffing |
| Diff rendering | UAT-4, UAT-5 | Both panels show parsed content; section nav updates with change badges |
| Error display | UAT-6, UAT-7 | 404 error, parse error → user-friendly message in alert region |
| Cache behavior | UAT-8 | Re-selecting same pair → instant result, no spinner |
| Section nav integration | UAT-9 | Buttons, badges, scroll-to-section, diff summary bar |
| Responsive layout | UAT-10, UAT-11 | Loading/error/diff states at 768px and 375px viewports |
| Console cleanliness | UAT-12 | No JS errors, React warnings, or CORS failures |
| Worker proxy | UAT-13 | Network requests route through /api/sec/ proxy, no direct SEC calls |
