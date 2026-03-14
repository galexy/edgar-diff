# US-2.9: Filing Selectors — Test Plan

## Overview

This test plan covers the Filing Selectors feature, which enables filing dropdown selectors in both Filing A and Filing B panels after a company is selected (US-2.8). Each dropdown lists available filings filtered to supported form types (10-K, 10-K/A, 10-Q, 10-Q/A), sorted by filing date descending (most recent first).

The architecture follows the same service → hook → component pattern established by US-2.8:

1. **Service layer (`filing-list.ts`):** Fetches SEC submissions for a CIK via Worker proxy, parses parallel arrays into `AvailableFiling` objects, filters to supported form types, sorts by date descending.
2. **Hook (`useFilingList.ts`):** Wraps the service, manages loading/error state, handles abort on company change.
3. **Component (`FilingSelector.tsx`):** Renders a `<select>` dropdown with filing options, fires `onSelect` callback when a filing is chosen.
4. **Integration:** `App` calls `useFilingList(selectedCompany)` and passes `filings`, `selectedFiling`, `onFilingSelect`, `filingListStatus` props to each `FilingPanel`. `FilingPanel` renders `FilingSelector` when these props are provided, falling back to the disabled `<select>` placeholder otherwise.

**Test file locations:**
- `apps/web/src/services/filing-list.test.ts` — Parse, filter, sort filings from SEC submissions
- `apps/web/src/hooks/useFilingList.test.ts` — Hook state transitions, abort, error handling
- `apps/web/src/components/FilingSelector.test.tsx` — Component rendering, interaction, ARIA, callbacks
- `apps/web/src/components/FilingPanel.test.tsx` — Integration additions (selector wiring)
- `apps/web/src/App.test.tsx` — App-level integration (company → filings flow)

**Test stack:** Vitest + React Testing Library (jsdom), following existing patterns in `SearchBar.test.tsx` and `useCompanySearch.test.ts`.

---

## 1. BDD Acceptance Criteria (Given/When/Then)

### AC-1: Filing selectors appear after company selection

```gherkin
Given both Filing A and Filing B panels are displayed with disabled selectors
When the user selects a company via the SearchBar (e.g., "AAPL")
Then both filing dropdowns become enabled
And each dropdown lists available filings for that company
```

### AC-2: Filing list shows form type and filing date

```gherkin
Given a company with multiple filings is selected
When the filing dropdown is opened
Then each option displays the form type and filing date
  (e.g., "10-K | 2023-11-03")
And options are sorted by filing date, most recent first
```

### AC-3: Only supported form types are shown

```gherkin
Given a company has filings of types 10-K, 10-Q, 8-K, S-1, DEF 14A
When the filing list is loaded
Then only 10-K, 10-K/A, 10-Q, and 10-Q/A filings appear in the dropdown
And 8-K, S-1, DEF 14A, and other unsupported types are excluded
```

### AC-4: Filing A and Filing B are independent selectors

```gherkin
Given both filing selectors are populated with the same list of filings
When the user selects "10-K | 2023-11-03" in Filing A
And selects "10-Q | 2023-08-04" in Filing B
Then each selector retains its own selection independently
And neither selection affects the other
```

### AC-5: Selecting a filing triggers callback

```gherkin
Given a filing selector is populated and enabled
When the user selects a filing from the dropdown
Then the onSelect callback fires with the filing metadata
  (accession number, form type, filing date)
```

### AC-6: Selectors disable when no company is selected

```gherkin
Given no company is selected (initial state or after clearing search)
When the user views the filing panels
Then both filing selectors are disabled
And each shows placeholder text "Select a filing..."
```

### AC-7: Company change reloads filing list

```gherkin
Given "Apple Inc." is selected and filing selectors are populated
When the user clears the search and selects "Microsoft Corporation"
Then the previous filing selections are cleared
And both selectors reload with Microsoft's filings
```

### AC-8: Empty result after filtering

```gherkin
Given a company has only 8-K filings (no supported form types)
When the filing list is loaded and filtered
Then the dropdown shows no options (or a "No supported filings" message)
And the selector remains disabled or shows empty state
```

---

## 2. Unit Tests

### 2.1 Filing List Service (`filing-list.test.ts`)

Parses SEC submissions response parallel arrays into structured filing objects, filters to supported types, and sorts by date.

#### Parsing Parallel Arrays

| Test | Input | Expected |
|------|-------|----------|
| Parses single filing from parallel arrays | `{ accessionNumber: ['0000320193-23-000106'], filingDate: ['2023-11-03'], form: ['10-K'] }` | `[{ accessionNumber: '0000320193-23-000106', filingDate: '2023-11-03', formType: '10-K' }]` |
| Parses multiple filings | 3 entries across arrays | 3 `AvailableFiling` objects |
| Handles mismatched array lengths gracefully | `accessionNumber` has 3, `form` has 2 | Uses shortest length (no crash) |

#### Filtering to Supported Form Types

| Test | Input Form Types | Expected |
|------|-----------------|----------|
| Keeps 10-K | `['10-K']` | 1 filing |
| Keeps 10-K/A | `['10-K/A']` | 1 filing |
| Keeps 10-Q | `['10-Q']` | 1 filing |
| Keeps 10-Q/A | `['10-Q/A']` | 1 filing |
| Removes 8-K | `['8-K']` | 0 filings |
| Removes S-1 | `['S-1']` | 0 filings |
| Removes DEF 14A | `['DEF 14A']` | 0 filings |
| Mixed: keeps supported, removes others | `['10-K', '8-K', '10-Q', 'S-1', 'DEF 14A']` | 2 filings (10-K, 10-Q) |
| All unsupported → empty result | `['8-K', '8-K/A', 'S-1', 'DEF 14A']` | `[]` |

#### Sorting by Date Descending

| Test | Input Dates | Expected Order |
|------|------------|----------------|
| Already sorted → no change | `['2023-11-03', '2023-08-04', '2023-02-03']` | Same |
| Unsorted → sorted descending | `['2023-02-03', '2023-11-03', '2023-08-04']` | `['2023-11-03', '2023-08-04', '2023-02-03']` |
| Same date → stable order | `['2023-11-03', '2023-11-03']` | Both present, original order preserved |

#### Edge Cases

| Test | Input | Expected |
|------|-------|----------|
| Empty arrays | `{ accessionNumber: [], filingDate: [], form: [] }` | `[]` |
| All entries filtered out | Only `8-K` filings | `[]` |
| Single filing passes through | 1 supported filing | `[filing]` |
| Large input (50+ filings) | 50 mixed filings | Only supported types, sorted |

### 2.2 `useFilingList` Hook (`useFilingList.test.ts`)

Wraps the filing list service. Mock the `filing-list` service module. Use `renderHook` from `@testing-library/react`.

#### State Shape & Transitions

| Test | Action | Expected State |
|------|--------|----------------|
| Initial state (no company) | Hook renders with `company = null` | `{ filings: [], status: 'idle', error: null }` |
| Company provided → loading | Set `company = { cik: '0000320193', ... }` | `{ filings: [], status: 'loading', error: null }` |
| Fetch succeeds → filings populated | Service resolves with filings | `{ filings: [...], status: 'loaded', error: null }` |
| Fetch fails → error | Service rejects | `{ filings: [], status: 'error', error: 'Failed to load filings' }` |
| Company cleared → reset | Set `company = null` | `{ filings: [], status: 'idle', error: null }` |
| Company changes → reload | Change from AAPL to MSFT | Previous filings cleared, new filings fetched |

#### Concurrency & Cleanup

| Test | Action | Expected |
|------|--------|----------|
| Aborts in-flight fetch on company change | Select AAPL, then MSFT before AAPL resolves | Only MSFT filings displayed |
| Aborts in-flight fetch on company clear | Select AAPL, then clear | No stale filings |
| No state update after unmount | Select company, then unmount | No React warnings |
| AbortError not treated as error | Abort during fetch | Status not set to 'error' |

### 2.3 FilingSelector Component (`FilingSelector.test.tsx`)

`FilingSelector` is a **pure presentational component** — it receives props directly, no hook mocking needed. Test by rendering with different prop combinations.

#### Test Setup

```typescript
import type { AvailableFiling } from '../services/types';

const sampleFilings: AvailableFiling[] = [
  { accessionNumber: '0000320193-23-000106', formType: '10-K', filingDate: '2023-11-03' },
  { accessionNumber: '0000320193-23-000077', formType: '10-Q', filingDate: '2023-08-04' },
  { accessionNumber: '0000320193-23-000064', formType: '10-Q', filingDate: '2023-05-05' },
];

const defaultProps: FilingSelectorProps = {
  filings: [],
  selectedAccession: null,
  onSelect: vi.fn(),
  disabled: false,
  'aria-label': 'Select Filing A',
};
```

#### Rendering

| Test | Props | Expected |
|------|-------|----------|
| Renders a select element | Default props | `<select>` present |
| Disabled when no filings | `filings: []` | Select is disabled (component disables when `filings.length === 0`) |
| Disabled when `disabled` prop is true | `disabled: true, filings: sampleFilings` | Select is disabled |
| Enabled when filings provided and not disabled | `filings: sampleFilings` | Select is enabled |
| Shows placeholder option | Default | First option is "Select a filing..." with empty value |
| Renders filing options | `filings: sampleFilings` | 3 `<option>` elements (plus placeholder) |
| Option text shows form type and date | Filing: `{ formType: '10-K', filingDate: '2023-11-03' }` | Option text: `"10-K | 2023-11-03"` |
| Option value is accession number | `filings: sampleFilings` | Each `<option>` has `value={accessionNumber}` |
| Options render in provided order | `filings: sampleFilings` | DOM order matches array order (service pre-sorts) |

#### Interaction

| Test | Action | Expected |
|------|--------|----------|
| Calls onSelect with filing data on change | `userEvent.selectOptions(select, accessionNumber)` | `onSelect` called with matching `AvailableFiling` object |
| Does not call onSelect for placeholder | Select the empty-value placeholder option | `onSelect` not called |
| Reflects selectedAccession in value | `selectedAccession: '0000320193-23-000106'` | Select element value matches |
| Resets to placeholder when selectedAccession is null | `selectedAccession: null` | Select shows placeholder |

#### Accessibility

| Test | Props | Expected |
|------|-------|----------|
| Has aria-label | `aria-label: 'Select Filing A'` | `<select>` has `aria-label="Select Filing A"` |
| Disabled state is accessible | `disabled: true` | `<select>` has `disabled` attribute |
| Options are selectable via keyboard | Standard props + filings | Native `<select>` keyboard behavior works |

---

## 3. Integration Tests

### 3.1 FilingPanel + FilingSelector Integration

Additions to `FilingPanel.test.tsx`. Verify that FilingPanel renders FilingSelector when filing props are provided, and falls back to the disabled placeholder otherwise.

| Test | Scenario | Expected |
|------|----------|----------|
| FilingPanel renders FilingSelector when filings prop provided | Render with `filings`, `onFilingSelect` props | FilingSelector component present with options |
| FilingPanel without filing props shows disabled placeholder | No `filings`/`onFilingSelect` props (backward compat) | Disabled `<select>` with "Select a filing..." |
| FilingPanel with empty filings shows disabled selector | `filings: []` | FilingSelector present but disabled |
| FilingPanel passes aria-label based on label | `label="Filing A"` | FilingSelector has `aria-label="Select Filing A"` |
| FilingPanel disabled during loading | `filingListStatus: 'loading'` | FilingSelector is disabled |
| onFilingSelect callback wired through | Select a filing in FilingSelector | Parent `onFilingSelect` callback receives filing data |

### 3.2 App-Level Integration (`App.test.tsx`)

Verify that company selection flows through to filing selectors. Mock fetch at the boundary.

| Test | Scenario | Expected |
|------|----------|----------|
| Filing selectors disabled on initial load | Render App | Both selectors disabled |
| Company selection enables filing selectors | Search + select AAPL | Both selectors populated with AAPL filings |
| Company clear disables filing selectors | Select AAPL, then clear search | Both selectors revert to disabled |
| Both panels receive independent filing selection | Select different filings in A and B | Each panel's selection callback fires independently |

### 3.3 Full Flow — Company to Filing Selection (mocked fetch)

| Test | Scenario | Expected |
|------|----------|----------|
| Type → select company → filings load → select filing | Full interaction flow | Filing callback fires with correct data |
| Type → select company → filings load → select different filings in A and B | Full interaction flow | Independent selections, independent callbacks |
| Type → select company → filings load → clear search → selectors disabled | Full interaction with clear | Clean state reset |

---

## 4. End-to-End Scenarios

Full user journeys. In Vitest: integration tests with mocked fetch. In UAT: against the running dev server with real SEC data.

### E2E-1: Successful filing selection

1. User opens the app
2. Both filing selectors are disabled with "Select a filing..." placeholder
3. User searches "AAPL" and selects Apple Inc.
4. Both filing selectors become enabled
5. Each dropdown lists Apple's supported filings (10-K, 10-Q entries)
6. User selects "10-K | 2023-11-03" in Filing A
7. Selection is retained and callback fires

### E2E-2: Independent filing selections

1. User selects Apple Inc. via search
2. Selects "10-K | 2023-11-03" in Filing A
3. Selects "10-Q | 2023-08-04" in Filing B
4. Both selections are independent — each panel retains its own selection
5. Neither selection affects the other

### E2E-3: Company change resets filings

1. User selects Apple Inc. → filing selectors populated
2. User selects "10-K | 2023-11-03" in Filing A
3. User clears search and selects Microsoft Corporation
4. Previous filing selection is cleared
5. Selectors reload with Microsoft's filings
6. User can make new selections

### E2E-4: Company with no supported filings

1. User selects a company that has only 8-K filings
2. Filing selectors show empty state (no options or "No supported filings")
3. User cannot select a filing
4. No errors displayed

### E2E-5: Company clear resets everything

1. User selects Apple Inc. → selects filings in both panels
2. User clears the search input
3. Both filing selectors revert to disabled state with placeholder
4. No stale filing data visible

---

## 5. Boundary Conditions

| Condition | Input | Expected Behavior |
|-----------|-------|-------------------|
| 0 filings after filtering | Company with only 8-K filings | Empty dropdown, selector disabled or shows "No supported filings" |
| 1 filing | Company with single 10-K | Dropdown with 1 option |
| Many filings (50+) | Company with 50+ supported filings | All rendered in dropdown, scrollable, sorted by date desc |
| Empty response arrays | `{ accessionNumber: [], filingDate: [], form: [] }` | Empty dropdown, no crash |
| Company with mixed form types | 3 supported + 5 unsupported | Only 3 options shown |
| All 4 supported types present | 10-K, 10-K/A, 10-Q, 10-Q/A | All 4 shown |
| Duplicate dates | Two 10-K filings on same date | Both shown, distinguishable by accession number or form type |
| Company changes rapidly | Select AAPL, then MSFT immediately | Only MSFT filings shown (abort in-flight) |
| Select then immediately clear | Select AAPL, immediately clear | No stale filings, selectors disabled |

---

## 6. Error Conditions

| Condition | Trigger | Expected Behavior |
|-----------|---------|-------------------|
| Network error fetching submissions | `fetch` rejects with TypeError | Error message displayed, selectors disabled |
| 404 — company not found | SEC API returns 404 | Error state, "Company submissions not found" |
| 429 — rate limited | SEC API returns 429 | Error state, "Rate limited. Please wait." |
| 500 — server error | SEC API returns 500 | Error state, "Unable to load filings" |
| Malformed response | Missing `filings.recent` in response | Error state, "Unexpected response format" |
| Company changes while fetch in-flight | User changes company during loading | In-flight request aborted, no stale data |
| AbortError from cancellation | Company change aborts fetch | Silently handled (not shown as error) |

> **Note:** Detailed error handling and retry logic is deferred to US-2.10. For US-2.9, we surface errors but do not implement retry mechanisms.

---

## 7. Test Data & Fixtures

### Expanded MOCK_AAPL_SUBMISSIONS

The existing `MOCK_AAPL_SUBMISSIONS` in `company-search-fixtures.ts` has only 1 filing. Expand it in-place with multiple filings of different types (including unsupported ones for filter testing). US-2.8 tests should still pass since they don't depend on the filing count.

```typescript
// Updated in apps/web/src/test-fixtures/company-search-fixtures.ts

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

### Additional Edge-Case Fixtures

These can go in a new `apps/web/src/test-fixtures/filing-list-fixtures.ts` file since they're specific to filing selector tests and don't belong in the shared company-search fixtures.

```typescript
// apps/web/src/test-fixtures/filing-list-fixtures.ts

/** Company with no supported filings (only 8-K) — matches coder's MOCK_NO_SUPPORTED_FILINGS */
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

/** Company with mixed supported and unsupported types */
export const MOCK_MIXED_FILINGS_SUBMISSIONS = {
  cik: '888888',
  name: 'Mixed Filings Inc.',
  tickers: ['MXFD'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: [
        '0000888888-23-000001',
        '0000888888-23-000002',
        '0000888888-23-000003',
        '0000888888-23-000004',
        '0000888888-23-000005',
      ],
      filingDate: [
        '2023-12-01',
        '2023-11-15',
        '2023-09-01',
        '2023-06-15',
        '2023-03-01',
      ],
      form: [
        '10-K',
        '8-K',
        '10-Q',
        'S-1',
        '10-K/A',
      ],
    },
  },
};

/** Company with all 4 supported form types */
export const MOCK_ALL_SUPPORTED_SUBMISSIONS = {
  cik: '777777',
  name: 'All Supported Corp.',
  tickers: ['ALLQ'],
  exchanges: ['NYSE'],
  filings: {
    recent: {
      accessionNumber: [
        '0000777777-23-000001',
        '0000777777-23-000002',
        '0000777777-23-000003',
        '0000777777-23-000004',
      ],
      filingDate: [
        '2023-12-15',
        '2023-09-15',
        '2023-06-15',
        '2023-03-15',
      ],
      form: [
        '10-K',
        '10-K/A',
        '10-Q',
        '10-Q/A',
      ],
    },
  },
};

/** Empty filings (company with no recent filings) */
export const MOCK_EMPTY_FILINGS_SUBMISSIONS = {
  cik: '666666',
  name: 'Empty Filings LLC',
  tickers: ['EMPT'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: [],
      filingDate: [],
      form: [],
    },
  },
};

/** Large set of filings (50+) for scroll/performance testing */
export function createLargeFilingsSubmissions(count: number = 50) {
  const accessionNumber: string[] = [];
  const filingDate: string[] = [];
  const form: string[] = [];
  const formTypes = ['10-K', '10-Q', '10-Q', '10-Q']; // 1 annual + 3 quarterly per year

  for (let i = 0; i < count; i++) {
    const year = 2023 - Math.floor(i / 4);
    const quarter = i % 4;
    const month = String(11 - quarter * 3).padStart(2, '0');
    accessionNumber.push(`0000555555-${year}-${String(i).padStart(6, '0')}`);
    filingDate.push(`${year}-${month}-03`);
    form.push(formTypes[quarter]);
  }

  return {
    cik: '555555',
    name: 'Large Filings Corp.',
    tickers: ['LRGF'],
    exchanges: ['NYSE'],
    filings: {
      recent: { accessionNumber, filingDate, form },
    },
  };
}
```

### AvailableFiling Type (new in `services/types.ts`)

```typescript
/** A filing available for selection in the filing dropdown. */
export interface AvailableFiling {
  /** SEC accession number (unique identifier) */
  accessionNumber: string;
  /** Filing date (YYYY-MM-DD string) */
  filingDate: string;
  /** Form type (10-K, 10-K/A, 10-Q, 10-Q/A) */
  formType: string;
}
```

### Filing List Status Type (new in `services/types.ts`)

```typescript
/** States the filing list can be in. */
export type FilingListStatus = 'idle' | 'loading' | 'loaded' | 'error';
```

### Mock Fetch for Filing Tests

Extend the existing `createStandardMockFetch` pattern:

```typescript
/** Creates a mock fetch for filing list tests with configurable submissions response */
export function createFilingMockFetch(
  submissionsResponse: Response | (() => Response),
) {
  return createMockFetch({
    '/api/sec/submissions/': submissionsResponse,
  });
}
```

---

## 8. Test Configuration Notes

### Mock Strategy

- **Service tests:** No mocking needed — test pure functions with fixture data directly
- **Hook tests:** Mock the `filing-list` service module via `vi.mock()`. Use `renderHook` from `@testing-library/react`
- **Component tests:** `FilingSelector` is purely presentational — render with different prop combinations, no mocking needed. `FilingPanel` tests mock `FilingSelector` or render with props directly.
- **Integration tests:** Mock `globalThis.fetch` at the boundary; use real hooks and components
- **Timer mocking:** Not needed for US-2.9 (no debounce); standard `act()` wrapping for async state updates

### Test Isolation

- Each test renders a fresh component instance
- Mock fetch reset between tests (`vi.restoreAllMocks()` in `afterEach`)
- FilingSelector tests reset `onSelect` mock via `vi.fn()` in `beforeEach`

---

## 9. UAT Scenarios (Chrome DevTools MCP)

Visual and interaction checks performed against the running dev server after all automated tests pass.

**Full UAT document:** See [uat.md](uat.md) for the complete UAT plan with prerequisites, verify steps, reference screenshot placeholders, and pass/fail criteria.

**Summary of UAT coverage:**

| UAT Step | What it covers |
|----------|----------------|
| UAT-1 | Filing selectors default state (disabled, placeholder) |
| UAT-2 | Selectors enable after company selection |
| UAT-3 | Dropdown shows filtered and sorted filings |
| UAT-4 | Filing selection works in Filing A |
| UAT-5 | Filing selection works in Filing B |
| UAT-6 | Independent selections in both panels |
| UAT-7 | Company change resets selectors |
| UAT-8 | Company clear disables selectors |
| UAT-9 | Loading state during fetch |
| UAT-10 | Responsive at 768px |
| UAT-11 | Responsive at 375px |
| UAT-12 | No console errors |

---

## 10. Coverage Matrix

| Acceptance Criterion | Unit | Integration | E2E/UAT |
|---------------------|------|-------------|---------|
| Filing selectors appear after company selection | FilingSelector render tests | App integration | UAT-2 |
| Dropdown lists filings with form type + date | FilingSelector option tests | Full flow | UAT-3 |
| Filings sorted by date descending | filing-list service sort tests | Full flow | UAT-3 |
| Only supported form types shown | filing-list service filter tests | Full flow | UAT-3 |
| Both panels have independent selectors | FilingSelector callback tests | App integration | UAT-4, UAT-5, UAT-6 |
| Selecting filing triggers callback | FilingSelector interaction tests | Full flow | UAT-4, UAT-5 |
| Selectors disabled without company | FilingSelector disabled tests | App integration | UAT-1, UAT-8 |
| Company change reloads filings | useFilingList abort/reload tests | App integration | UAT-7 |
| Empty/filtered filings handled | filing-list edge case tests | — | — |
| Error states displayed | useFilingList error tests, FilingSelector error tests | — | — |
| Responsive layout | — | — | UAT-10, UAT-11 |
| No console errors | — | — | UAT-12 |
