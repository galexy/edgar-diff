# US-2.9: Filing Selectors — Implementation Design

## Overview

After a company is selected (US-2.8), both Filing A and Filing B panels show dropdown selectors populated with the company's available filings. Each dropdown lists filings with form type and filing date, filtered to supported types (10-K, 10-K/A, 10-Q, 10-Q/A), sorted by date descending. Selecting a filing fires a callback consumed by US-2.10.

---

## Approach

The existing `fetchCompanySubmissions` in `sec-submissions.ts` already hits `/api/sec/submissions/CIK{cik}.json` but currently discards the `filings.recent` data. We extend the submissions service to also extract and return the filing list, then build a hook and component to surface it in the UI.

**Strategy:**

1. **Extend the submissions service** — Add a `fetchFilingList` function that parses `filings.recent` parallel arrays, filters to supported form types, and sorts by date descending
2. **Add a React hook** (`useFilingList`) — Calls the service when `selectedCompany` changes, manages loading/error/data states with abort-on-reselect
3. **Build a FilingSelector component** — A `<select>` dropdown that renders the filing list and fires `onSelect`
4. **Wire into FilingPanel** — Replace the disabled `<select>` placeholder with FilingSelector
5. **Wire into App** — Pass `selectedCompany` through to trigger filing list fetch, pass filing list + selection state to each FilingPanel

**What's NOT in scope:**
- Fetching filing HTML content (US-2.10)
- Error handling beyond basic fetch failures (US-2.10)
- Fiscal period display (US-2.12 — SEC API doesn't provide it)
- Pagination of filings beyond `filings.recent` (MVP constraint)

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/services/filing-list.ts` | Parse submissions response `filings.recent` parallel arrays into `AvailableFiling[]`, filter to supported form types, sort by date descending |
| `apps/web/src/services/filing-list.test.ts` | Unit tests for parsing, filtering, sorting, and edge cases |
| `apps/web/src/hooks/useFilingList.ts` | React hook: fetches filing list when company changes, manages loading/error/data, aborts on company change |
| `apps/web/src/hooks/useFilingList.test.ts` | Hook tests: state transitions, abort-on-reselect, error handling |
| `apps/web/src/components/FilingSelector.tsx` | Dropdown `<select>` component rendering the filing list |
| `apps/web/src/components/FilingSelector.test.tsx` | Component tests: renders options, fires onSelect, disabled states |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/services/types.ts` | Add `AvailableFiling` type and `FilingListStatus` |
| `apps/web/src/services/sec-submissions.ts` | Widen `SubmissionsResponse` to include `filings.recent` arrays; optionally export the raw response type for `filing-list.ts` |
| `apps/web/src/components/FilingPanel.tsx` | Accept optional `filings`, `selectedFiling`, `onFilingSelect` props; render `FilingSelector` instead of disabled `<select>` |
| `apps/web/src/components/FilingPanel.test.tsx` | Add tests for filing selector rendering and interaction |
| `apps/web/src/App.tsx` | Wire `selectedCompany` → `useFilingList` → pass filings to each FilingPanel; add `selectedFilingA`/`selectedFilingB` state |
| `apps/web/src/test-fixtures/company-search-fixtures.ts` | Expand `MOCK_AAPL_SUBMISSIONS` and `MOCK_MSFT_SUBMISSIONS` with multiple filings of different types for testing |

---

## Interfaces and Types

### `AvailableFiling` (in `services/types.ts`)

```typescript
/** A filing available for selection in the dropdown. */
export interface AvailableFiling {
  /** SEC accession number (e.g., "0000320193-23-000106") */
  accessionNumber: string;
  /** Form type (e.g., "10-K", "10-Q/A") */
  formType: string;
  /** Filing date as ISO string (e.g., "2023-11-03") */
  filingDate: string;
}
```

**Design note:** `filingDate` is kept as an ISO string rather than `Temporal.PlainDate` because:
- It comes from the SEC API as a string
- It's used as a display value and for sorting (ISO strings sort correctly)
- Avoids the `@js-temporal/polyfill` dependency in the web app's service layer
- The dropdown label is built with simple string formatting

### `FilingListStatus` (in `services/types.ts`)

```typescript
/** States the filing list fetch can be in. */
export type FilingListStatus = 'idle' | 'loading' | 'loaded' | 'error';
```

### `fetchFilingList` (in `services/filing-list.ts`)

```typescript
import type { AvailableFiling } from './types';

/** Supported form types for the filing selector. */
export const SUPPORTED_FORM_TYPES = ['10-K', '10-K/A', '10-Q', '10-Q/A'] as const;

/**
 * Fetch and parse available filings for a company.
 * Hits the same submissions endpoint as fetchCompanySubmissions,
 * but extracts the filings.recent parallel arrays.
 */
export async function fetchFilingList(
  cik: string,
  signal?: AbortSignal,
): Promise<AvailableFiling[]>;
```

### `useFilingList` hook (in `hooks/useFilingList.ts`)

```typescript
import type { Company } from '../services/types';
import type { AvailableFiling } from '../services/types';
import type { FilingListStatus } from '../services/types';

export interface UseFilingListReturn {
  /** Available filings for the selected company */
  filings: AvailableFiling[];
  /** Current fetch status */
  status: FilingListStatus;
  /** Error message, if any */
  error: string | null;
}

export function useFilingList(company: Company | null): UseFilingListReturn;
```

### `FilingSelector` component (in `components/FilingSelector.tsx`)

```typescript
import type { AvailableFiling } from '../services/types';

interface FilingSelectorProps {
  /** Available filings to show in the dropdown */
  filings: AvailableFiling[];
  /** Currently selected filing (by accession number) */
  selectedAccession: string | null;
  /** Called when user selects a filing */
  onSelect: (filing: AvailableFiling) => void;
  /** Disabled when no filings are available or still loading */
  disabled?: boolean;
  /** Accessible label (e.g., "Select Filing A") */
  'aria-label': string;
}

export function FilingSelector(props: FilingSelectorProps): JSX.Element;
```

### Updated `FilingPanel` props

```typescript
interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
  sectionDiffs?: SectionDiff[];
  side?: Side;
  // New props for US-2.9:
  filings?: AvailableFiling[];
  selectedFiling?: string | null;
  onFilingSelect?: (filing: AvailableFiling) => void;
  filingListStatus?: FilingListStatus;
}
```

---

## Data Flow

```
User selects company in SearchBar (US-2.8)
       │
       ▼
App.selectedCompany state updates
       │
       ▼
useFilingList(selectedCompany) hook fires
       │
       ├─ company is null → status='idle', filings=[]
       │
       └─ company is set → status='loading'
              │
              ▼
        fetchFilingList(company.cik, signal)
              │
              ├─ GET /api/sec/submissions/CIK{cik}.json
              │   (same endpoint as US-2.8, but we parse filings.recent)
              │
              ├─ Parse parallel arrays:
              │   accessionNumber[i], filingDate[i], form[i]
              │   → AvailableFiling[]
              │
              ├─ Filter: only SUPPORTED_FORM_TYPES
              │
              ├─ Sort: by filingDate descending
              │
              ├─ Success → status='loaded', filings=[...]
              │
              └─ Failure → status='error', error message
              │
              ▼
App passes filings to both FilingPanels
              │
              ▼
FilingPanel renders FilingSelector
              │
              ├─ No filings → disabled <select> "Select a filing..."
              │
              └─ Has filings → enabled <select> with options
                     │
                     ▼
              User selects a filing from dropdown
                     │
                     ▼
              onFilingSelect(filing) → App.selectedFilingA or B state
                     │
                     ▼
              (US-2.10 will consume selectedFilingA + selectedFilingB
               to trigger the diff pipeline)
```

### Filing Label Format

Each `<option>` displays: `"10-K | 2023-11-03"` (form type + filing date).

Fiscal period display (e.g., "(FY 2021)") is deferred to US-2.12 since the SEC submissions API doesn't provide it. Adding it later requires either XBRL parsing or a separate API call — out of scope for MVP.

---

## Service Layer: `filing-list.ts`

### Parsing Strategy

The SEC submissions API returns `filings.recent` as **parallel arrays** (not an array of objects):

```json
{
  "filings": {
    "recent": {
      "accessionNumber": ["0000320193-23-000106", "0000320193-23-000077", ...],
      "filingDate": ["2023-11-03", "2023-08-04", ...],
      "form": ["10-K", "10-Q", ...]
    }
  }
}
```

The service zips these into `AvailableFiling[]`, filters, and sorts:

```typescript
export async function fetchFilingList(
  cik: string,
  signal?: AbortSignal,
): Promise<AvailableFiling[]> {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
  const url = `/api/sec/submissions/CIK${paddedCik}.json`;

  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error('Unable to load filings. Try again shortly.');
  }

  const data = await response.json();
  const recent = data?.filings?.recent;
  if (!recent) return [];

  const { accessionNumber = [], filingDate = [], form = [] } = recent;
  const len = Math.min(accessionNumber.length, filingDate.length, form.length);

  const filings: AvailableFiling[] = [];
  for (let i = 0; i < len; i++) {
    if (SUPPORTED_FORM_TYPES.includes(form[i])) {
      filings.push({
        accessionNumber: accessionNumber[i],
        formType: form[i],
        filingDate: filingDate[i],
      });
    }
  }

  // Already date-descending from SEC, but sort explicitly to guarantee
  filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  return filings;
}
```

### Why a Separate Function (Not Extending `fetchCompanySubmissions`)

- **Single Responsibility:** `fetchCompanySubmissions` returns `Company` (identity). `fetchFilingList` returns `AvailableFiling[]` (filing metadata). Different consumers, different shapes.
- **Independent Caching:** US-2.10 may cache filings differently from company identity.
- **Testability:** Each function has a focused test suite.

### Duplicate Fetch Concern

Both `fetchCompanySubmissions` (US-2.8) and `fetchFilingList` hit the same endpoint. This means two requests for the same CIK on company selection. This is acceptable for MVP because:
- The response is cached by the Cloudflare Worker (or browser HTTP cache)
- The second request should be a cache hit
- Merging them would couple the company search flow to the filing list flow

If this becomes a performance concern, a shared cache layer can be added in US-2.10.

---

## Hook: `useFilingList`

Follows the same patterns as `useCompanySearch`:

```typescript
export function useFilingList(company: Company | null): UseFilingListReturn {
  const [filings, setFilings] = useState<AvailableFiling[]>([]);
  const [status, setStatus] = useState<FilingListStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset when company changes or clears
    setFilings([]);
    setError(null);

    if (!company) {
      setStatus('idle');
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');

    fetchFilingList(company.cik, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setFilings(result);
          setStatus('loaded');
        }
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Failed to load filings');
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [company]);

  return { filings, status, error };
}
```

**Key behaviors:**
- Fires on `company` change (effect dependency)
- Aborts in-flight request when company changes (abort controller)
- Resets state when company is null (cleared)
- Ignores AbortError silently (same pattern as `useCompanySearch`)

---

## Component: `FilingSelector`

A thin wrapper around a native `<select>` element:

```typescript
export function FilingSelector({
  filings,
  selectedAccession,
  onSelect,
  disabled,
  'aria-label': ariaLabel,
}: FilingSelectorProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const filing = filings.find((f) => f.accessionNumber === e.target.value);
    if (filing) onSelect(filing);
  }

  return (
    <select
      value={selectedAccession ?? ''}
      onChange={handleChange}
      disabled={disabled || filings.length === 0}
      aria-label={ariaLabel}
      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm
                 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
                 bg-white text-gray-900"
    >
      <option value="">Select a filing...</option>
      {filings.map((f) => (
        <option key={f.accessionNumber} value={f.accessionNumber}>
          {f.formType} | {f.filingDate}
        </option>
      ))}
    </select>
  );
}
```

**Why native `<select>` over a custom dropdown:**
- Keyboard-accessible by default (no custom aria work)
- Mobile-friendly (native OS picker)
- Filing list is small (typically <20 entries) — no virtualization needed
- Matches the existing disabled `<select>` already in FilingPanel

---

## App Wiring

### `App.tsx` Changes

```typescript
export function App() {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const { filings, status: filingListStatus } = useFilingList(selectedCompany);
  const [selectedFilingA, setSelectedFilingA] = useState<AvailableFiling | null>(null);
  const [selectedFilingB, setSelectedFilingB] = useState<AvailableFiling | null>(null);

  // Reset filing selections when company changes
  useEffect(() => {
    setSelectedFilingA(null);
    setSelectedFilingB(null);
  }, [selectedCompany]);

  // ... existing sampleDiffs/sections/refs/handlers ...

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar onCompanySelect={setSelectedCompany} />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav ... />
        <FilingPanel
          ref={oldPanelRef}
          label="Filing A"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="old"
          filings={filings}
          selectedFiling={selectedFilingA?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingA}
          filingListStatus={filingListStatus}
        />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel
          ref={newPanelRef}
          label="Filing B"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="new"
          filings={filings}
          selectedFiling={selectedFilingB?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingB}
          filingListStatus={filingListStatus}
        />
      </main>
    </div>
  );
}
```

**Key decisions:**
- Both panels share the same `filings` list (both are from the same company)
- Each panel has independent selection state (`selectedFilingA`, `selectedFilingB`)
- Filing selections reset when company changes
- `selectedFilingA`/`selectedFilingB` are ready for US-2.10 to consume

### `FilingPanel.tsx` Changes

Replace the disabled `<select>` with `FilingSelector`:

```typescript
export const FilingPanel = forwardRef<HTMLDivElement, FilingPanelProps>(
  function FilingPanel({ label, document, sectionDiffs, side, filings, selectedFiling, onFilingSelect, filingListStatus }, ref) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">{label}</h2>
          {filings && onFilingSelect ? (
            <FilingSelector
              filings={filings}
              selectedAccession={selectedFiling ?? null}
              onSelect={onFilingSelect}
              disabled={filingListStatus === 'loading'}
              aria-label={`Select ${label}`}
            />
          ) : (
            <select disabled className="w-full px-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm cursor-not-allowed">
              <option>Select a filing...</option>
            </select>
          )}
        </div>
        {/* ... content area unchanged ... */}
      </div>
    );
  }
);
```

**Backward compatibility:** When `filings`/`onFilingSelect` are not provided, the disabled placeholder renders (matching current behavior). This keeps all existing tests passing without modification.

---

## Test Fixtures

### Expanded `MOCK_AAPL_SUBMISSIONS`

The existing fixture has a single filing. Expand it with multiple filings of different types for comprehensive testing:

```typescript
export const MOCK_AAPL_SUBMISSIONS = {
  cik: '320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: [
        '0000320193-23-000106',
        '0000320193-23-000077',
        '0000320193-23-000064',
        '0000320193-22-000108',
        '0000320193-23-000050',  // 8-K (should be filtered out)
      ],
      filingDate: [
        '2023-11-03',
        '2023-08-04',
        '2023-05-05',
        '2022-10-28',
        '2023-09-15',
      ],
      form: [
        '10-K',
        '10-Q',
        '10-Q',
        '10-K',
        '8-K',  // unsupported — should be filtered out
      ],
    },
  },
};
```

### Additional Test Fixture

```typescript
/** Company with no supported filings (only 8-K) */
export const MOCK_NO_SUPPORTED_FILINGS = {
  cik: '999999',
  name: 'Only 8K Corp',
  tickers: ['ONLY8K'],
  exchanges: ['NYSE'],
  filings: {
    recent: {
      accessionNumber: ['0000999999-23-000001'],
      filingDate: ['2023-06-15'],
      form: ['8-K'],
    },
  },
};
```

---

## Dependencies

### Existing (no new dependencies)

- React 19 hooks (`useState`, `useEffect`, `useRef`, `useCallback`)
- Native `fetch` API (via Worker proxy)
- Vitest + `@testing-library/react` + `@testing-library/user-event`
- Existing `services/types.ts` types

### Internal Imports

- `services/filing-list.ts` → imports from `services/types.ts`
- `hooks/useFilingList.ts` → imports from `services/filing-list.ts`, `services/types.ts`
- `components/FilingSelector.tsx` → imports from `services/types.ts`
- `components/FilingPanel.tsx` → imports `FilingSelector`, types from `services/types.ts`
- `App.tsx` → imports `useFilingList` hook

---

## Edge Cases

### Data Edge Cases

| Case | Behavior |
|------|----------|
| Company with no supported filings (only 8-K, DEF 14A, etc.) | Dropdown shows "Select a filing..." and is disabled. `filings` array is empty. |
| Company with empty `filings.recent` | Same as above — empty array, disabled dropdown. |
| `filings.recent` missing from response | `fetchFilingList` returns `[]`. No error — treat as company with no filings. |
| Parallel arrays of different lengths | Use `Math.min` of all array lengths to avoid index-out-of-bounds. |
| Duplicate accession numbers | Pass through — SEC data shouldn't have duplicates, but `<option key>` handles it. |

### Interaction Edge Cases

| Case | Behavior |
|------|----------|
| Company changes while filing list is loading | Abort in-flight request via AbortController. Reset filings and selections. |
| Company cleared (search cleared) | `company=null` → reset to idle, empty filings, clear selections. |
| User selects same filing in both A and B | Allowed — comparing a filing to itself is a valid (if unusual) action. |
| Filing selected, then company changes | Both `selectedFilingA` and `selectedFilingB` reset to null via the `useEffect` in App. |

### Network Edge Cases

| Case | Behavior |
|------|----------|
| Fetch fails (network error, 500, etc.) | `status='error'`, user-friendly message. Dropdown stays disabled. |
| Fetch returns 404 | "Unable to load filings. Try again shortly." |
| Fetch returns 429 (rate limited) | Same error message. No retry logic in US-2.9 scope. |
| AbortError (from company change) | Silently ignored (same pattern as `useCompanySearch`). |

---

## Open Questions

1. **Caching the submissions response:** Both `fetchCompanySubmissions` (US-2.8) and `fetchFilingList` (US-2.9) hit the same endpoint. Should we share a response cache? **Tentative answer:** No for MVP. The Worker/browser HTTP cache handles deduplication. A shared in-memory cache can be added in US-2.10 if needed.

2. **Loading indicator in dropdown:** Should we show "Loading filings..." text in the dropdown while fetching? **Tentative answer:** The dropdown is disabled during loading. A loading spinner or text next to the dropdown could be added in US-2.12 polish.

3. **Default selection:** Should the most recent filing auto-select for Filing A and the second-most-recent for Filing B? **Tentative answer:** No — require explicit user selection. Auto-selection would trigger the diff pipeline (US-2.10) without user intent. Can revisit in polish.
