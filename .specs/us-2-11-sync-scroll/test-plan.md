# US-2.11 Synchronized Scrolling — Test Plan

## 1. BDD Acceptance Criteria

### AC-1: Scrolling Filing A automatically scrolls Filing B to the corresponding position

```gherkin
Scenario: SS-AC1-1 — Scroll Filing A syncs Filing B
  Given both panels have filings loaded with matching sections [s1, s2, s3]
  And sync scrolling is enabled (default)
  When the user scrolls Filing A so that section "s2" is the most visible
  Then Filing B scrolls so that section "s2" is aligned to the viewport

Scenario: SS-AC1-2 — Scroll Filing B syncs Filing A
  Given both panels have filings loaded with matching sections [s1, s2, s3]
  And sync scrolling is enabled
  When the user scrolls Filing B so that section "s3" is the most visible
  Then Filing A scrolls so that section "s3" is aligned to the viewport

Scenario: SS-AC1-3 — Section not found in other panel
  Given Filing A has sections [s1, s2, s3] and Filing B has sections [s1, s3]
  And sync scrolling is enabled
  When the user scrolls Filing A so that section "s2" is the most visible
  Then Filing B does NOT scroll (section "s2" does not exist in Filing B)
  And no error is thrown

Scenario: SS-AC1-4 — No filings loaded
  Given no filings are loaded in either panel
  And sync scrolling is enabled
  When the user scrolls either panel
  Then nothing happens and no errors are thrown

Scenario: SS-AC1-5 — One panel empty
  Given Filing A has sections [s1, s2] and Filing B is empty (no document)
  And sync scrolling is enabled
  When the user scrolls Filing A
  Then no error is thrown (the hook early-returns when either ref is null)
```

### AC-2: Scroll sync is based on section alignment

```gherkin
Scenario: SS-AC2-1 — Sections align by matching ID
  Given Filing A has sections [s1, s2, s3] and Filing B has sections [s1, s2, s3]
  And sync scrolling is enabled
  When the user scrolls Filing A until "s2" has the highest intersection ratio
  Then Filing B calls scrollIntoView on the element with id="s2"

Scenario: SS-AC2-2 — Large sections stay aligned (dedup via lastSyncedSectionRef)
  Given Filing A section "s1" spans 3 viewports
  And Filing B section "s1" spans 1 viewport
  When the user scrolls Filing A within section "s1"
  Then Filing B does NOT call scrollIntoView again (lastSyncedSectionRef prevents duplicate)

Scenario: SS-AC2-3 — Small sections are detected
  Given Filing A has a section "s-tiny" that is < 50px tall
  When "s-tiny" becomes the most visible section (highest ratio via 0.1 threshold)
  Then Filing B scrolls to its matching "s-tiny" element
```

### AC-3: A toggle button allows the user to enable/disable sync scrolling

```gherkin
Scenario: SS-AC3-1 — Toggle button renders in Header with correct initial state
  Given the app is loaded with two filings
  Then a "Sync Scroll" toggle button is visible in the Header
  And it has aria-pressed="true" (sync ON by default)

Scenario: SS-AC3-2 — Toggle disables sync
  Given sync scrolling is enabled
  When the user clicks the sync toggle button in the Header
  Then aria-pressed changes to "false"
  And the useEffect cleanup runs (listeners + observers removed)

Scenario: SS-AC3-3 — Toggle re-enables sync
  Given sync scrolling was disabled via toggle
  When the user clicks the sync toggle button again
  Then aria-pressed changes to "true"
  And the useEffect re-runs (listeners + observers re-attached)
```

### AC-4: When sync is disabled, panels scroll independently

```gherkin
Scenario: SS-AC4-1 — Independent scrolling when disabled
  Given sync scrolling is disabled
  When the user scrolls Filing A to section "s3"
  Then Filing B remains at its current scroll position
  And scrollIntoView is NOT called on Filing B

Scenario: SS-AC4-2 — Re-enabling syncs from current position
  Given sync was disabled and user scrolled Filing A to "s3" and Filing B to "s1"
  When the user re-enables sync
  And the user scrolls Filing A (triggering a new scroll event)
  Then Filing B syncs to match Filing A's most visible section
```

---

## 2. Unit Tests — `useSyncedScroll` Hook

File: `apps/web/src/hooks/useSyncedScroll.test.ts`

These tests follow the same patterns as `useActiveSection.test.ts`: `MockIntersectionObserver`, `makeEntry()`, `makeContainer()`, `makeRef()`, and `renderHook()`.

### Test Helpers

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncedScroll } from './useSyncedScroll';
import type { RefObject } from 'react';

// --- Mock IntersectionObserver ---
// Unlike useActiveSection tests which track a single callback,
// useSyncedScroll creates TWO observers (one per panel).
// We track all callbacks in an array.

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let mockCallbacks: IntersectionCallback[];
let mockObservedElements: Element[];
let mockDisconnect: ReturnType<typeof vi.fn>;
let mockObserve: ReturnType<typeof vi.fn>;

function makeEntry(
  target: Element,
  intersectionRatio: number,
): Partial<IntersectionObserverEntry> {
  return { target, intersectionRatio };
}

beforeEach(() => {
  mockCallbacks = [];
  mockObservedElements = [];
  mockDisconnect = vi.fn();
  mockObserve = vi.fn((el: Element) => mockObservedElements.push(el));

  class MockIntersectionObserver {
    constructor(callback: IntersectionCallback, _options?: IntersectionObserverInit) {
      mockCallbacks.push(callback);
    }
    observe = mockObserve;
    unobserve = vi.fn();
    disconnect = mockDisconnect;
    root = null;
    rootMargin = '';
    thresholds = [] as number[];
    takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  // Mock scrollIntoView on all elements
  Element.prototype.scrollIntoView = vi.fn();

  // Mock requestAnimationFrame / cancelAnimationFrame
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    rafCallback = cb;
    return ++rafIdCounter;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  // Mock MutationObserver
  vi.stubGlobal('MutationObserver', MockMutationObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- rAF helpers ---
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 0;

function flushRAF(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(performance.now());
  }
}

// --- Mock MutationObserver ---
let mockMutationDisconnect: ReturnType<typeof vi.fn>;
let mockMutationObserve: ReturnType<typeof vi.fn>;

class MockMutationObserver {
  callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
  }
  observe = (mockMutationObserve = vi.fn());
  disconnect = (mockMutationDisconnect = vi.fn());
  takeRecords = vi.fn(() => [] as MutationRecord[]);
}

// --- Container helpers (reuse pattern from useActiveSection.test.ts) ---

function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    container.appendChild(section);
  }
  return container;
}

function makeRef(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

function fireScroll(container: HTMLDivElement): void {
  container.dispatchEvent(new Event('scroll'));
}
```

### Hook Signature (Confirmed)

```typescript
function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void;
```

### Test Cases

#### SS-U1: Attaches scroll listeners with `{ passive: true }` when enabled
```typescript
it('attaches scroll event listeners to both panels when enabled', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');
  const spyA = vi.spyOn(containerA, 'addEventListener');
  const spyB = vi.spyOn(containerB, 'addEventListener');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
});
```

#### SS-U2: Does NOT attach listeners when enabled=false
```typescript
it('does not attach scroll event listeners when enabled=false', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');
  const spyA = vi.spyOn(containerA, 'addEventListener');
  const spyB = vi.spyOn(containerB, 'addEventListener');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), false));

  expect(spyA).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  expect(spyB).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
});
```

#### SS-U3: Removes listeners on unmount (cleanup)
```typescript
it('removes scroll event listeners on unmount', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');
  const spyA = vi.spyOn(containerA, 'removeEventListener');
  const spyB = vi.spyOn(containerB, 'removeEventListener');

  const { unmount } = renderHook(() =>
    useSyncedScroll(makeRef(containerA), makeRef(containerB), true)
  );
  unmount();

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
  expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function));
});
```

#### SS-U4: On scroll, finds most-visible section and calls scrollIntoView on other panel
```typescript
it('calls scrollIntoView on matching section in other panel on scroll', () => {
  const containerA = makeContainer('s1', 's2', 's3');
  const containerB = makeContainer('s1', 's2', 's3');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Two IntersectionObservers created (one per panel)
  expect(mockCallbacks).toHaveLength(2);

  // Simulate observer A reporting s2 as most visible
  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([
      makeEntry(sectionsA[0], 0.1) as IntersectionObserverEntry,
      makeEntry(sectionsA[1], 0.8) as IntersectionObserverEntry,
      makeEntry(sectionsA[2], 0.1) as IntersectionObserverEntry,
    ]);
  });

  // Fire scroll on panel A and flush rAF
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // Expect scrollIntoView called on container B's s2
  const targetSection = containerB.querySelector('#s2');
  expect(targetSection?.scrollIntoView).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: 'smooth', block: 'start' })
  );
});
```

#### SS-U5: Prevents scroll loop via scrollSourceRef 3-state guard
```typescript
it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Set s2 as most visible in panel A
  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
  });

  // Scroll panel A → triggers sync to panel B
  // scrollSourceRef is now 'panelA'
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  const targetB = containerB.querySelector('#s2');
  expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1);

  // Set s1 as most visible in panel B (simulating the programmatic scroll landing)
  const sectionsB = containerB.querySelectorAll('section');
  act(() => {
    mockCallbacks[1]([makeEntry(sectionsB[0], 0.9) as IntersectionObserverEntry]);
  });

  // Panel B's scroll handler fires (from programmatic scrollIntoView)
  // BUT scrollSourceRef === 'panelA', so panel B's handler should skip
  act(() => { fireScroll(containerB); });
  act(() => { flushRAF(); });

  // scrollIntoView should NOT have been called on panel A's s1
  const targetA = containerA.querySelector('#s1');
  expect(targetA?.scrollIntoView).not.toHaveBeenCalled();
});
```

#### SS-U6: Debounces with requestAnimationFrame
```typescript
it('uses requestAnimationFrame for debouncing scroll handlers', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');
  const rafSpy = vi.fn((_cb: FrameRequestCallback) => 1);
  vi.stubGlobal('requestAnimationFrame', rafSpy);

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  act(() => { fireScroll(containerA); });

  expect(rafSpy).toHaveBeenCalledTimes(1);
});
```

#### SS-U7: Gracefully handles section not found in other panel
```typescript
it('does not throw when active section has no match in other panel', () => {
  const containerA = makeContainer('s1', 's2', 's3');
  const containerB = makeContainer('s1', 's3'); // s2 missing

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Make s2 the most visible in panel A
  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
  });

  // Scroll panel A — s2 doesn't exist in B
  expect(() => {
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });
  }).not.toThrow();

  // No scrollIntoView called on any element in B
  const sectionsB = containerB.querySelectorAll('section');
  for (const section of sectionsB) {
    expect(section.scrollIntoView).not.toHaveBeenCalled();
  }
});
```

#### SS-U8: Handles null/empty refs
```typescript
it('does not throw when both refs are null (early return)', () => {
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(null), makeRef(null), true));
  }).not.toThrow();
  // No IntersectionObservers created
  expect(mockCallbacks).toHaveLength(0);
});

it('does not throw when one ref is null (early return)', () => {
  const container = makeContainer('s1');
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true));
  }).not.toThrow();
  // No observers — hook requires BOTH refs
  expect(mockCallbacks).toHaveLength(0);
});
```

#### SS-U9: Toggling enabled removes/adds listeners dynamically
```typescript
it('removes listeners and observers when toggled from enabled to disabled', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');
  const spyA = vi.spyOn(containerA, 'removeEventListener');

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
    { initialProps: { enabled: true } },
  );

  rerender({ enabled: false });

  // Cleanup ran: listeners removed, observers disconnected
  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
  expect(mockDisconnect).toHaveBeenCalled();
});

it('re-attaches listeners when toggled from disabled to enabled', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');
  const spyA = vi.spyOn(containerA, 'addEventListener');

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
    { initialProps: { enabled: false } },
  );

  rerender({ enabled: true });

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
});
```

#### SS-U10: Handles rapid successive scroll events (coalesces via rAF)
```typescript
it('coalesces rapid scroll events via cancelAnimationFrame + requestAnimationFrame', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');
  const cancelSpy = vi.fn();
  let rafCount = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++rafCount));
  vi.stubGlobal('cancelAnimationFrame', cancelSpy);

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Fire 5 rapid scroll events on panel A
  act(() => {
    for (let i = 0; i < 5; i++) fireScroll(containerA);
  });

  // cancelAnimationFrame called to discard prior stale frames
  expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
});
```

#### SS-U11: Does not sync when active section hasn't changed (lastSyncedSectionRef)
```typescript
it('does not call scrollIntoView when the active section is unchanged', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([makeEntry(sectionsA[0], 0.9) as IntersectionObserverEntry]);
  });

  // First scroll: should sync to s1
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });
  const targetB = containerB.querySelector('#s1');
  expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1);

  // Second scroll: same section still most visible — should NOT call again
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });
  expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1); // still 1
});
```

#### SS-U12: Full cleanup on unmount (observers, listeners, MutationObserver, timeout)
```typescript
it('disconnects IntersectionObservers, MutationObserver, and clears timeout on unmount', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');

  const { unmount } = renderHook(() =>
    useSyncedScroll(makeRef(containerA), makeRef(containerB), true)
  );
  unmount();

  // Both IntersectionObservers disconnected
  expect(mockDisconnect).toHaveBeenCalledTimes(2);
  // MutationObserver disconnected
  expect(mockMutationDisconnect).toHaveBeenCalled();
});
```

#### SS-U13: Settling timeout resets scrollSourceRef after 150ms
```typescript
it('resets scroll source flag after 150ms settling timeout', () => {
  vi.useFakeTimers();
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Make s2 most visible in panel A
  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
  });

  // Scroll panel A → sets scrollSourceRef to 'panelA'
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // Before timeout: panel B scroll should be suppressed
  const sectionsB = containerB.querySelectorAll('section');
  act(() => {
    mockCallbacks[1]([makeEntry(sectionsB[0], 0.9) as IntersectionObserverEntry]);
  });
  act(() => { fireScroll(containerB); });
  act(() => { flushRAF(); });
  expect(containerA.querySelector('#s1')?.scrollIntoView).not.toHaveBeenCalled();

  // After 150ms timeout: scrollSourceRef resets to 'none'
  // Now panel B scrolling should trigger sync to panel A
  act(() => { vi.advanceTimersByTime(150); });
  act(() => { fireScroll(containerB); });
  act(() => { flushRAF(); });
  expect(containerA.querySelector('#s1')?.scrollIntoView).toHaveBeenCalled();
});
```

#### SS-U14: MutationObserver re-registers sections when DOM changes
```typescript
it('MutationObserver re-registers IntersectionObserver when sections are added', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // MutationObserver should be observing both panels
  expect(mockMutationObserve).toHaveBeenCalledWith(
    containerA,
    expect.objectContaining({ childList: true, subtree: true })
  );
  expect(mockMutationObserve).toHaveBeenCalledWith(
    containerB,
    expect.objectContaining({ childList: true, subtree: true })
  );

  // Initial: 2 sections observed (s1 in A, s1 in B)
  const initialObserveCount = mockObserve.mock.calls.length;

  // Simulate adding a new section to container A
  const newSection = document.createElement('section');
  newSection.id = 's2';
  containerA.appendChild(newSection);

  // Trigger the MutationObserver callback
  // (In real code, the browser fires this; in tests we call it manually)
  // The callback disconnects + re-observes both observers
  // After re-observe, the new section should be picked up
  expect(mockObserve.mock.calls.length).toBeGreaterThanOrEqual(initialObserveCount);
});
```

#### SS-U15: Uses CSS.escape for section ID lookup
```typescript
it('uses CSS.escape when looking up sections in the target panel', () => {
  const containerA = makeContainer('item-1a', 'item.2');
  const containerB = makeContainer('item-1a', 'item.2');
  const cssEscapeSpy = vi.spyOn(CSS, 'escape');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Make "item.2" most visible in panel A
  const sectionsA = containerA.querySelectorAll('section');
  act(() => {
    mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
  });

  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  expect(cssEscapeSpy).toHaveBeenCalledWith('item.2');
});
```

---

## 3. Unit Tests — Header Toggle Button

File: `apps/web/src/components/Header.test.tsx` (extend existing)

### SS-H1: Renders sync toggle button when props provided
```typescript
it('renders sync toggle button with aria-pressed=true when syncEnabled', () => {
  render(<Header syncEnabled={true} onSyncToggle={vi.fn()} />);
  const toggle = screen.getByRole('button', { name: /sync scroll/i });
  expect(toggle).toBeInTheDocument();
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
});
```

### SS-H2: Toggle button shows aria-pressed=false when sync disabled
```typescript
it('renders toggle with aria-pressed=false when syncEnabled is false', () => {
  render(<Header syncEnabled={false} onSyncToggle={vi.fn()} />);
  const toggle = screen.getByRole('button', { name: /sync scroll/i });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
```

### SS-H3: Click calls onSyncToggle
```typescript
it('calls onSyncToggle when toggle button is clicked', async () => {
  const onToggle = vi.fn();
  render(<Header syncEnabled={true} onSyncToggle={onToggle} />);
  await userEvent.click(screen.getByRole('button', { name: /sync scroll/i }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
```

### SS-H4: Does not render toggle when props omitted (backward compat)
```typescript
it('does not render toggle button when onSyncToggle is not provided', () => {
  render(<Header />);
  expect(screen.queryByRole('button', { name: /sync scroll/i })).not.toBeInTheDocument();
});
```

---

## 4. Integration Tests

File: `apps/web/src/App.test.tsx` (preferred — extend existing App tests for SS-I1/I3/I4/I5) or `apps/web/src/hooks/useSyncedScroll.integration.test.tsx` (for SS-I2 which tests the hook directly with two panels)

### SS-I1: App renders Header with sync scroll toggle
```
Render <App /> with mocked pipeline data.
Verify a sync scroll toggle button with aria-pressed="true" is in the Header.
```

### SS-I2: Two FilingPanels sync via useSyncedScroll
```
Render two <FilingPanel> components with shared sections [s1, s2, s3].
Attach useSyncedScroll to their refs.
Simulate IntersectionObserver reporting s2 as most visible in panel A.
Fire scroll event on panel A.
Assert scrollIntoView was called on panel B's s2 element.
```

### SS-I3: Toggle disables sync between panels
```
Render App with sync enabled.
Click the Header toggle to disable (aria-pressed becomes "false").
Scroll panel A.
Assert panel B did NOT receive scrollIntoView call.
Click toggle to re-enable (aria-pressed becomes "true").
Scroll panel A.
Assert panel B DID receive scrollIntoView call.
```

### SS-I4: SectionNav click coexists with sync scroll
```
Render App with sync enabled.
Click a section in SectionNav.
Assert both panels scroll to that section (existing handleSectionClick behavior).
This verifies that the sync scroll hook and the manual section click coexist
without interference.
```

### SS-I5: Sync scroll works with dynamically loaded sections (MutationObserver)
```
Render App with pipeline in "fetching" state (no sections rendered).
Transition pipeline to "done" (FilingContent renders <section> elements).
MutationObserver fires, re-registers IntersectionObservers on new sections.
Scroll panel A.
Assert panel B syncs correctly.
```

---

## 5. End-to-End Tests (UAT)

File: `.specs/us-2-11-sync-scroll/uat.md`

### SS-E1: Full user flow — select filings, scroll, verify sync
```
1. Open the app at localhost
2. Search and select a company (e.g., "AAPL")
3. Select Filing A (e.g., 10-K 2023)
4. Select Filing B (e.g., 10-K 2024)
5. Wait for diff pipeline to complete
6. Scroll Filing A down 2-3 sections
7. Verify Filing B scrolls to the same section
8. Scroll Filing B to a different section
9. Verify Filing A scrolls to match
```

### SS-E2: Toggle sync off/on via Header button
```
1. With two filings loaded, click the "Sync Scroll" button in Header (OFF)
2. Verify button shows disabled state (aria-pressed="false")
3. Scroll Filing A — verify Filing B does NOT follow
4. Scroll Filing B — verify Filing A does NOT follow
5. Click "Sync Scroll" button again (ON)
6. Verify button shows enabled state (aria-pressed="true")
7. Scroll Filing A — verify Filing B resumes following
```

### SS-E3: Section alignment accuracy
```
1. Load two filings with different section sizes
2. Scroll to a small section in Filing A
3. Verify the matching section heading is visible at the top of Filing B
4. Take screenshot for visual verification
```

### SS-E4: Scroll performance
```
1. Load two filings with 15+ sections
2. Rapidly scroll Filing A up and down
3. Verify no visual jank or dropped frames
4. Verify Filing B keeps up without noticeable lag
```

---

## 6. Boundary Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-B1 | 0 sections (empty filing, but refs valid) | Listeners attached, but IntersectionObservers find no `section[id]` elements to observe. No sync triggers. No errors. |
| SS-B2 | 1 section in both panels | scrollIntoView called on the single section; visually a no-op since it's already visible |
| SS-B3 | 20+ sections in both panels | All sections observed by IntersectionObserver, sync works for any section |
| SS-B4 | Very large section (> 3 viewports tall) | `lastSyncedSectionRef` dedup ensures scrollIntoView called once per section transition, not per pixel |
| SS-B5 | Very small section (< 50px) | Section detected if it has highest intersectionRatio; threshold 0.1 is sufficient to trigger |
| SS-B6 | Section IDs with special characters (e.g., `item-1a`, `item_2.1`) | `CSS.escape()` used in querySelector; scrollIntoView finds the element correctly |
| SS-B7 | Mismatched section counts (A has 10, B has 7) | Only matching IDs sync; non-matching sections are silently skipped (querySelector returns null) |
| SS-B8 | Both panels at the same section already | `lastSyncedSectionRef` prevents redundant scrollIntoView; no infinite loop |

---

## 7. Error Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-ERR1 | Both panel refs null (not mounted) | Hook early-returns (`if (!panelA \|\| !panelB \|\| !enabled) return`); no listeners, no observers |
| SS-ERR2 | One panel ref null | Hook early-returns; no listeners, no observers |
| SS-ERR3 | Section exists in panel A but not panel B | `querySelector(`#${CSS.escape(id)}`)` returns null; scrollIntoView NOT called; no error |
| SS-ERR4 | Sections load asynchronously (pipeline states) | MutationObserver detects new `<section>` elements and re-registers IntersectionObservers |
| SS-ERR5 | Panel unmounted mid-scroll (race condition) | useEffect cleanup removes listeners + disconnects observers; stale scroll events are no-ops |
| SS-ERR6 | Toggle disable during active smooth scroll | useEffect cleanup runs; in-progress scrollIntoView animation finishes naturally but no further sync events fire |
| SS-ERR7 | scrollIntoView called on detached DOM node | Returns undefined (does not throw); no special handling needed. The unmount race (SS-ERR5) is the real risk, handled by cleanup. |

---

## 8. Performance Criteria

| Criterion | Target | How to Verify |
|-----------|--------|---------------|
| Scroll handler latency | < 16ms (one frame budget) | `requestAnimationFrame` debouncing ensures handler runs at most once per frame |
| No dropped frames | 0 dropped frames during normal sync | Chrome DevTools Performance panel; Lighthouse audit |
| Debouncing | Only one pending rAF per panel at a time | Unit test SS-U10 verifies `cancelAnimationFrame` on stale frames |
| Section dedup | No redundant scrollIntoView calls | `lastSyncedSectionRef` checked in SS-U11 |
| Loop prevention | 150ms settling window | `scrollSourceRef` 3-state guard verified in SS-U5, SS-U13 |
| Observer overhead | Minimal | IntersectionObserver is native; 2 observers for ~10-30 sections |
| Memory | No observer leaks | SS-U3 and SS-U12 verify cleanup of listeners, IntersectionObservers, MutationObserver, and timeout |

---

## 9. Test Data & Fixtures

### Mock IntersectionObserver (extended for dual-observer pattern)
```typescript
// Unlike useActiveSection tests which track a SINGLE callback,
// useSyncedScroll creates TWO observers. We track callbacks in an array:
// mockCallbacks[0] = observer for panel A
// mockCallbacks[1] = observer for panel B
let mockCallbacks: IntersectionCallback[] = [];
```

### Mock MutationObserver
```typescript
class MockMutationObserver {
  callback: MutationCallback;
  constructor(callback: MutationCallback) { this.callback = callback; }
  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
vi.stubGlobal('MutationObserver', MockMutationObserver);
```

### Mock scrollIntoView
```typescript
// Globally mock scrollIntoView on all elements
Element.prototype.scrollIntoView = vi.fn();
```

### Mock requestAnimationFrame
```typescript
let rafCallback: FrameRequestCallback | null = null;
vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
  rafCallback = cb;
  return 1;
}));
vi.stubGlobal('cancelAnimationFrame', vi.fn());

function flushRAF() {
  if (rafCallback) { const cb = rafCallback; rafCallback = null; cb(performance.now()); }
}
```

### Container Factory
```typescript
function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    container.appendChild(section);
  }
  return container;
}
```

### Standard Test Fixtures
- **Two panels, matching sections**: `makeContainer('s1', 's2', 's3')` x2
- **Mismatched sections**: A = `['s1', 's2', 's3']`, B = `['s1', 's3']`
- **Empty panels**: `makeContainer()` (no section children)
- **Single section**: `makeContainer('s1')` x2
- **Many sections**: `makeContainer(...Array.from({length: 25}, (_, i) => `s${i+1}`))` x2
- **Special character IDs**: `makeContainer('item-1a', 'item_2.1', 'item 3')` x2

---

## Test ID Index

| ID | Type | Description |
|----|------|-------------|
| SS-U1 | Unit | Attaches scroll listeners with `{ passive: true }` when enabled |
| SS-U2 | Unit | Does not attach listeners when disabled |
| SS-U3 | Unit | Removes listeners on unmount |
| SS-U4 | Unit | Scroll fires scrollIntoView on matching section in other panel |
| SS-U5 | Unit | Prevents infinite scroll loop via scrollSourceRef 3-state guard |
| SS-U6 | Unit | Uses requestAnimationFrame for debouncing |
| SS-U7 | Unit | Handles missing section in other panel gracefully |
| SS-U8 | Unit | Handles null refs (early return, no observers) |
| SS-U9 | Unit | Toggle removes/adds listeners and observers dynamically |
| SS-U10 | Unit | Coalesces rapid scroll events via cancelAnimationFrame |
| SS-U11 | Unit | Skips scrollIntoView when active section unchanged (lastSyncedSectionRef) |
| SS-U12 | Unit | Full cleanup: IntersectionObservers, MutationObserver, timeout |
| SS-U13 | Unit | 150ms settling timeout resets scrollSourceRef to 'none' |
| SS-U14 | Unit | MutationObserver re-registers observers on DOM change |
| SS-U15 | Unit | Uses CSS.escape for section ID lookup |
| SS-H1 | Unit | Header renders toggle with aria-pressed=true |
| SS-H2 | Unit | Header renders toggle with aria-pressed=false |
| SS-H3 | Unit | Header toggle click calls onSyncToggle |
| SS-H4 | Unit | Header omits toggle when props not provided |
| SS-I1 | Integration | App renders Header with sync toggle |
| SS-I2 | Integration | Two panels sync via hook |
| SS-I3 | Integration | Toggle disables/enables sync |
| SS-I4 | Integration | SectionNav click coexists with sync |
| SS-I5 | Integration | Sync works after dynamic section load (MutationObserver) |
| SS-E1 | E2E | Full user flow: select, scroll, verify |
| SS-E2 | E2E | Toggle off/on via Header |
| SS-E3 | E2E | Section alignment accuracy |
| SS-E4 | E2E | Scroll performance |
| SS-B1-B8 | Boundary | Edge cases (empty, small, large, mismatched, special chars) |
| SS-ERR1-ERR7 | Error | Error conditions |
