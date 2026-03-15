# US-2.11 Synchronized Scrolling — Test Plan (v2)

> **v2 rationale**: v1 used section-snapping via `scrollIntoView` + `IntersectionObserver`.
> This caused huge jumps — a section appearing at the bottom of Panel A would snap the
> other panel to the top of that section. The panels never visually aligned.
>
> v2 uses **proportional section-based alignment** with direct `scrollTop` computation.
> Pure functions for binary search and ratio mapping make the core logic highly testable.

---

## 1. BDD Acceptance Criteria

### AC-1: Scrolling Filing A automatically scrolls Filing B to the corresponding position

```gherkin
Scenario: SS-AC1-1 — Scroll Filing A syncs Filing B proportionally
  Given both panels have filings loaded with matching sections [s1, s2, s3]
  And sync scrolling is enabled (default)
  When the user scrolls Filing A so that section "s2" is at the viewport center
  Then Filing B sets scrollTop so that section "s2" is at the same proportional position
  And Filing B does NOT call scrollIntoView (scrollTop is set directly)

Scenario: SS-AC1-2 — Scroll Filing B syncs Filing A proportionally
  Given both panels have filings loaded with matching sections [s1, s2, s3]
  And sync scrolling is enabled
  When the user scrolls Filing B so that section "s3" is 40% through at viewport center
  Then Filing A sets scrollTop so that section "s3" is at 40% through

Scenario: SS-AC1-3 — Section not found in other panel (global ratio fallback)
  Given Filing A has sections [s1, s2, s3] and Filing B has sections [s1, s3]
  And sync scrolling is enabled
  When the user scrolls Filing A so that section "s2" is at the viewport center
  Then Filing B falls back to global proportional scrolling (scrollTop/scrollHeight ratio)
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

### AC-2: Scroll sync uses proportional section-based alignment

```gherkin
Scenario: SS-AC2-1 — Proportional alignment within a section
  Given Filing A has section "s2" that is 1000px tall
  And Filing B has section "s2" that is 500px tall
  And sync scrolling is enabled
  When the user scrolls Filing A so the viewport center is 60% through section "s2"
  Then Filing B's scrollTop is computed so its viewport center is 60% through its "s2"

Scenario: SS-AC2-2 — Large sections stay proportionally aligned
  Given Filing A section "s1" spans 3 viewports (3000px)
  And Filing B section "s1" spans 1 viewport (800px)
  When the user scrolls from the top to the bottom of "s1" in Filing A
  Then Filing B tracks proportionally through its "s1" — no jumps, smooth tracking

Scenario: SS-AC2-3 — Small sections are detected via binary search
  Given Filing A has a section "s-tiny" that is < 50px tall
  When "s-tiny" is at the viewport center (found by binary search on offsetTop)
  Then Filing B scrolls to its matching "s-tiny" element proportionally

Scenario: SS-AC2-4 — Different section sizes produce correct ratios
  Given Filing A has section "s1" at offsetTop=0, height=2000px
  And Filing B has section "s1" at offsetTop=0, height=400px
  When the user scrolls Filing A so viewport center is at 1500px (ratio 0.75)
  Then Filing B scrollTop positions its viewport center at 300px into "s1" (ratio 0.75)
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
  And the useEffect cleanup runs (scroll listeners removed)

Scenario: SS-AC3-3 — Toggle re-enables sync
  Given sync scrolling was disabled via toggle
  When the user clicks the sync toggle button again
  Then aria-pressed changes to "true"
  And the useEffect re-runs (scroll listeners re-attached)
```

### AC-4: When sync is disabled, panels scroll independently

```gherkin
Scenario: SS-AC4-1 — Independent scrolling when disabled
  Given sync scrolling is disabled
  When the user scrolls Filing A to section "s3"
  Then Filing B remains at its current scroll position
  And scrollTop on Filing B is NOT modified programmatically

Scenario: SS-AC4-2 — Re-enabling syncs from current position
  Given sync was disabled and user scrolled Filing A to "s3" and Filing B to "s1"
  When the user re-enables sync
  And the user scrolls Filing A (triggering a new scroll event)
  Then Filing B syncs to match Filing A's proportional position
```

---

## 2. Unit Tests — Pure Functions

File: `apps/web/src/lib/sync-scroll.test.ts`

Pure functions are exported from `lib/sync-scroll.ts` — separate from the React hook.
They operate on `SectionRect` values — no DOM or React dependencies.

### Types

```typescript
// Exported from lib/sync-scroll.ts
export interface SectionRect {
  id: string;
  offsetTop: number;
  offsetHeight: number;
}
```

### 2a. `findSectionAtPosition(sections, centerY)` — Binary Search

Returns `{ section: SectionRect; index: number } | null`.

```typescript
import { describe, it, expect } from 'vitest';
import {
  findSectionAtPosition,
  computeRatio,
  computeTargetScrollTop,
  getSectionRects,
  type SectionRect,
} from './sync-scroll';

describe('findSectionAtPosition', () => {
  // SS-PF1: Empty sections array returns null
  it('returns null for empty sections array', () => {
    expect(findSectionAtPosition([], 500)).toBeNull();
  });

  // SS-PF2: Position before first section returns first section
  it('returns first section when position is before all sections', () => {
    const sections: SectionRect[] = [
      { id: 's1', offsetTop: 100, offsetHeight: 200 },
      { id: 's2', offsetTop: 300, offsetHeight: 200 },
    ];
    expect(findSectionAtPosition(sections, 50)).toEqual({ section: sections[0], index: 0 });
  });

  // SS-PF3: Position in middle of a section returns that section
  it('returns the section containing the position', () => {
    const sections: SectionRect[] = [
      { id: 's1', offsetTop: 0, offsetHeight: 300 },
      { id: 's2', offsetTop: 300, offsetHeight: 400 },
      { id: 's3', offsetTop: 700, offsetHeight: 300 },
    ];
    expect(findSectionAtPosition(sections, 500)).toEqual({ section: sections[1], index: 1 });
  });

  // SS-PF4: Position at exact boundary between sections
  it('returns the next section when position is at exact boundary', () => {
    const sections: SectionRect[] = [
      { id: 's1', offsetTop: 0, offsetHeight: 300 },
      { id: 's2', offsetTop: 300, offsetHeight: 300 },
    ];
    // At 300: s1 ends (0+300), s2 begins. Binary search: centerY >= s.offsetTop + s.offsetHeight
    // skips s1, lands on s2.
    expect(findSectionAtPosition(sections, 300)).toEqual({ section: sections[1], index: 1 });
  });

  // SS-PF5: Position after last section returns last section
  it('returns last section when position is beyond all sections', () => {
    const sections: SectionRect[] = [
      { id: 's1', offsetTop: 0, offsetHeight: 200 },
      { id: 's2', offsetTop: 200, offsetHeight: 300 },
    ];
    expect(findSectionAtPosition(sections, 9999)).toEqual({ section: sections[1], index: 1 });
  });

  // SS-PF6: Single section
  it('returns the only section regardless of position', () => {
    const sections: SectionRect[] = [{ id: 's1', offsetTop: 0, offsetHeight: 1000 }];
    expect(findSectionAtPosition(sections, 500)).toEqual({ section: sections[0], index: 0 });
    expect(findSectionAtPosition(sections, 0)).toEqual({ section: sections[0], index: 0 });
    expect(findSectionAtPosition(sections, 2000)).toEqual({ section: sections[0], index: 0 });
  });

  // SS-PF7: Many sections — binary search correctness
  it('finds correct section among 25 sections via binary search', () => {
    const sections: SectionRect[] = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i + 1}`,
      offsetTop: i * 200,
      offsetHeight: 200,
    }));
    // Position 2500 is in section 13 (offsetTop=2400, range 2400-2600)
    expect(findSectionAtPosition(sections, 2500)).toEqual({ section: sections[12], index: 12 });
  });

  // SS-PF8: Gap between sections (preamble or padding) — snaps to nearest
  it('handles gap between sections by snapping to nearest', () => {
    const sections: SectionRect[] = [
      { id: 's1', offsetTop: 0, offsetHeight: 100 },
      // gap from 100 to 200
      { id: 's2', offsetTop: 200, offsetHeight: 100 },
    ];
    const result = findSectionAtPosition(sections, 150); // in the gap
    // Should return one of the adjacent sections (implementation-defined: nearest)
    expect(result).not.toBeNull();
    expect(result!.section.id).toMatch(/^s[12]$/);
  });
});
```

### 2b. `computeRatio(section, centerY)` — Ratio Computation

```typescript
describe('computeRatio', () => {
  const section: SectionRect = { id: 's1', offsetTop: 100, offsetHeight: 400 };

  // SS-PF9: Position at section start → ratio 0
  it('returns 0 when position is at section start', () => {
    expect(computeRatio(section, 100)).toBe(0);
  });

  // SS-PF10: Position at section end → ratio 1
  it('returns 1 when position is at section end', () => {
    expect(computeRatio(section, 500)).toBe(1);
  });

  // SS-PF11: Position at section midpoint → ratio 0.5
  it('returns 0.5 when position is at section midpoint', () => {
    expect(computeRatio(section, 300)).toBe(0.5);
  });

  // SS-PF12: Arbitrary position → correct ratio
  it('returns correct ratio for arbitrary position', () => {
    expect(computeRatio(section, 200)).toBeCloseTo(0.25);
    expect(computeRatio(section, 400)).toBeCloseTo(0.75);
  });

  // SS-PF13: Zero-height section → ratio 0 (guard against division by zero)
  it('returns 0 for zero-height section', () => {
    const zeroSection: SectionRect = { id: 's1', offsetTop: 100, offsetHeight: 0 };
    expect(computeRatio(zeroSection, 100)).toBe(0);
  });

  // SS-PF14: Position before section start → clamps to 0
  it('clamps to 0 when position is before section start', () => {
    expect(computeRatio(section, 50)).toBe(0);
  });

  // SS-PF15: Position after section end → clamps to 1
  it('clamps to 1 when position is after section end', () => {
    expect(computeRatio(section, 600)).toBe(1);
  });
});
```

### 2c. `computeTargetScrollTop(matchingSection, ratio, containerHeight)` — Target Scroll

The function returns `matchingSection.offsetTop + ratio * matchingSection.offsetHeight - containerHeight / 2`.
It does NOT clamp — the browser clamps `scrollTop` naturally on assignment (negative → 0,
exceeds max → `scrollHeight - clientHeight`).

```typescript
describe('computeTargetScrollTop', () => {
  // Section in target panel: starts at 200, height 600
  const section: SectionRect = { id: 's1', offsetTop: 200, offsetHeight: 600 };
  const containerHeight = 400; // viewport height

  // SS-PF16: Ratio 0 → viewport center at section top
  it('positions viewport center at section start for ratio 0', () => {
    // Target: 200 + 0 * 600 - 200 = 0
    expect(computeTargetScrollTop(section, 0, containerHeight)).toBe(0);
  });

  // SS-PF17: Ratio 1 → viewport center at section bottom
  it('positions viewport center at section end for ratio 1', () => {
    // Target: 200 + 1 * 600 - 200 = 600
    expect(computeTargetScrollTop(section, 1, containerHeight)).toBe(600);
  });

  // SS-PF18: Ratio 0.5 → viewport center at section midpoint
  it('positions viewport center at section midpoint for ratio 0.5', () => {
    // Target: 200 + 0.5 * 600 - 200 = 300
    expect(computeTargetScrollTop(section, 0.5, containerHeight)).toBe(300);
  });

  // SS-PF19: Can return negative — browser clamps scrollTop to 0 on assignment
  it('can return negative value (browser clamps on assignment)', () => {
    const topSection: SectionRect = { id: 's1', offsetTop: 50, offsetHeight: 100 };
    // Target: 50 + 0 * 100 - 200 = -150
    expect(computeTargetScrollTop(topSection, 0, containerHeight)).toBe(-150);
  });

  // SS-PF20: Ratio 0.75 produces correct intermediate value
  it('produces correct value for ratio 0.75', () => {
    // Target: 200 + 0.75 * 600 - 200 = 450
    expect(computeTargetScrollTop(section, 0.75, containerHeight)).toBe(450);
  });
});
```

### 2d. `getSectionRects(container)` — DOM Section Query

```typescript
describe('getSectionRects', () => {
  // SS-PF21: Returns empty array for container with no sections
  it('returns empty array when container has no section[id] elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>No sections here</p>';
    expect(getSectionRects(container as HTMLDivElement)).toEqual([]);
  });

  // SS-PF22: Returns SectionRect for each section[id] element
  it('returns id, offsetTop, offsetHeight for each section', () => {
    const container = document.createElement('div');
    const s1 = document.createElement('section');
    s1.id = 'item-1';
    Object.defineProperty(s1, 'offsetTop', { get: () => 0 });
    Object.defineProperty(s1, 'offsetHeight', { get: () => 300 });
    const s2 = document.createElement('section');
    s2.id = 'item-2';
    Object.defineProperty(s2, 'offsetTop', { get: () => 300 });
    Object.defineProperty(s2, 'offsetHeight', { get: () => 500 });
    container.append(s1, s2);

    const rects = getSectionRects(container as HTMLDivElement);
    expect(rects).toEqual([
      { id: 'item-1', offsetTop: 0, offsetHeight: 300 },
      { id: 'item-2', offsetTop: 300, offsetHeight: 500 },
    ]);
  });

  // SS-PF23: Ignores sections without an id attribute
  it('ignores <section> elements without an id attribute', () => {
    const container = document.createElement('div');
    const withId = document.createElement('section');
    withId.id = 's1';
    Object.defineProperty(withId, 'offsetTop', { get: () => 0 });
    Object.defineProperty(withId, 'offsetHeight', { get: () => 100 });
    const noId = document.createElement('section'); // no id
    container.append(withId, noId);

    const rects = getSectionRects(container as HTMLDivElement);
    expect(rects).toHaveLength(1);
    expect(rects[0].id).toBe('s1');
  });

  // SS-PF24: Returns sections in document order (top to bottom)
  it('returns sections in document order', () => {
    const container = document.createElement('div');
    for (const id of ['s3', 's1', 's2']) {
      const s = document.createElement('section');
      s.id = id;
      Object.defineProperty(s, 'offsetTop', { get: () => 0 });
      Object.defineProperty(s, 'offsetHeight', { get: () => 100 });
      container.appendChild(s);
    }

    const rects = getSectionRects(container as HTMLDivElement);
    expect(rects.map((r) => r.id)).toEqual(['s3', 's1', 's2']); // document order, not sorted by id
  });
});
```

---

## 3. Unit Tests — `useSyncedScroll` Hook

File: `apps/web/src/hooks/useSyncedScroll.test.ts`

The hook imports pure functions from `lib/sync-scroll.ts` and orchestrates them
with DOM interaction. Tests focus on scroll listener management, rAF debouncing,
scrollTop assignment (NOT scrollIntoView), and loop prevention via `isProgrammaticScrollRef`.

### Test Helpers

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncedScroll } from './useSyncedScroll';
import type { RefObject } from 'react';

// --- rAF mock ---
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 0;

function flushRAF(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(performance.now());
  }
}

// --- Container with layout simulation ---
// jsdom doesn't compute layout, so we mock offsetTop/offsetHeight on sections
// and scrollTop/clientHeight/scrollHeight on the container.

function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  let top = 0;
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    const height = 500; // default 500px per section
    // Capture `top` in closure for each section
    const sectionTop = top;
    Object.defineProperty(section, 'offsetTop', { get: () => sectionTop, configurable: true });
    Object.defineProperty(section, 'offsetHeight', { get: () => height, configurable: true });
    container.appendChild(section);
    top += height;
  }
  // Container layout
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: top, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
  return container;
}

function makeRef(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

function fireScroll(container: HTMLDivElement): void {
  container.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  rafCallback = null;
  rafIdCounter = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    rafCallback = cb;
    return ++rafIdCounter;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

### Hook Signature (v2)

```typescript
function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void;
```

### Test Cases

#### SS-U1: Attaches scroll listeners when enabled
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

#### SS-U4: On scroll, sets scrollTop on other panel (NOT scrollIntoView)
```typescript
it('sets scrollTop on the other panel when one panel scrolls', () => {
  const containerA = makeContainer('s1', 's2', 's3');
  const containerB = makeContainer('s1', 's2', 's3');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Simulate user scrolling panel A: viewport center lands in s2
  // scrollTop=500, clientHeight=600, center = 500 + 300 = 800
  // s2 starts at 500, height 500, so center 800 is at ratio (800-500)/500 = 0.6
  containerA.scrollTop = 500;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // containerB.scrollTop should have been set (not scrollIntoView)
  expect(containerB.scrollTop).not.toBe(0);
});
```

#### SS-U5: Loop prevention — programmatic scroll doesn't trigger reciprocal sync
```typescript
it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Scroll A → triggers rAF → sets B's scrollTop
  containerA.scrollTop = 400;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // isProgrammaticScrollRef is now true.
  // B fires scroll (from the programmatic scrollTop assignment).
  // Handler checks isProgrammaticScrollRef → true → clears flag, returns immediately.
  // No rAF is queued, so A's scrollTop is never modified.
  const aScrollBefore = containerA.scrollTop;
  act(() => { fireScroll(containerB); });
  // No rAF to flush — the handler returned before calling requestAnimationFrame
  expect(containerA.scrollTop).toBe(aScrollBefore);
});
```

#### SS-U6: Uses requestAnimationFrame for debouncing
```typescript
it('uses requestAnimationFrame to debounce scroll handlers', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  act(() => { fireScroll(containerA); });

  // rAF should have been called (handler queued, not executed synchronously)
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
});
```

#### SS-U7: Coalesces rapid scroll events via cancelAnimationFrame + rAF
```typescript
it('coalesces rapid scroll events via cancelAnimationFrame', () => {
  const containerA = makeContainer('s1', 's2');
  const containerB = makeContainer('s1', 's2');
  const cancelSpy = vi.fn();
  let count = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++count));
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

#### SS-U8: Handles null refs gracefully
```typescript
it('does not throw when both refs are null', () => {
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(null), makeRef(null), true));
  }).not.toThrow();
});

it('does not throw when one ref is null', () => {
  const container = makeContainer('s1');
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true));
  }).not.toThrow();
});
```

#### SS-U9: Handles missing section in other panel — global ratio fallback
```typescript
it('falls back to global proportional scroll when section is missing in target panel', () => {
  const containerA = makeContainer('s1', 's2', 's3');
  const containerB = makeContainer('s1', 's3'); // s2 missing

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Scroll A so viewport center is in s2 (which doesn't exist in B)
  containerA.scrollTop = 500;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // B should have scrolled using global ratio fallback, NOT stayed at 0
  // Global ratio: scrollTop / scrollHeight = 500 / 1500 ≈ 0.333
  // Target: 0.333 * 1000 (B's scrollHeight, 2 sections * 500) ≈ 333
  expect(containerB.scrollTop).not.toBe(0);
  expect(containerB.scrollTop).toBeGreaterThan(0);
});
```

#### SS-U10: Toggling enabled removes/adds listeners dynamically
```typescript
it('removes listeners when toggled from enabled to disabled', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');
  const spyA = vi.spyOn(containerA, 'removeEventListener');

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
    { initialProps: { enabled: true } },
  );

  rerender({ enabled: false });

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
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

#### SS-U11: Sections are queried fresh on each scroll (no stale cache)
```typescript
it('queries sections fresh on each scroll event (handles dynamic DOM)', () => {
  const containerA = makeContainer('s1');
  const containerB = makeContainer('s1');

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Dynamically add a section to both panels
  const newSectionA = document.createElement('section');
  newSectionA.id = 's2';
  Object.defineProperty(newSectionA, 'offsetTop', { get: () => 500 });
  Object.defineProperty(newSectionA, 'offsetHeight', { get: () => 500 });
  containerA.appendChild(newSectionA);

  const newSectionB = document.createElement('section');
  newSectionB.id = 's2';
  Object.defineProperty(newSectionB, 'offsetTop', { get: () => 500 });
  Object.defineProperty(newSectionB, 'offsetHeight', { get: () => 500 });
  containerB.appendChild(newSectionB);

  // Scroll to new section — should work without re-initialization
  containerA.scrollTop = 700;
  expect(() => {
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });
  }).not.toThrow();
});
```

#### SS-U12: No sections loaded — handler no-ops
```typescript
it('does not set scrollTop when no sections exist (empty panels)', () => {
  const containerA = makeContainer(); // no sections
  const containerB = makeContainer(); // no sections

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  containerA.scrollTop = 100;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // findSectionAtPosition returns null → handler returns early
  expect(containerB.scrollTop).toBe(0);
});
```

---

## 4. Unit Tests — Header Toggle Button

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

## 5. Integration Tests

File: `apps/web/src/App.test.tsx` (extend existing App tests)

### SS-I1: App renders Header with sync scroll toggle
```
Render <App /> with mocked pipeline data.
Verify a sync scroll toggle button with aria-pressed="true" is in the Header.
```

### SS-I2: Two panels sync proportionally via useSyncedScroll
```
Render two <FilingPanel> components with shared sections [s1, s2, s3].
Attach useSyncedScroll to their refs.
Set scrollTop on panel A to position viewport center in s2 at 60%.
Fire scroll event on panel A. Flush rAF.
Assert panel B's scrollTop was set so its viewport center
is at 60% through its s2.
```

### SS-I3: Toggle disables/enables sync between panels
```
Render App with sync enabled.
Click the Header toggle to disable (aria-pressed becomes "false").
Scroll panel A.
Assert panel B's scrollTop was NOT modified.
Click toggle to re-enable (aria-pressed becomes "true").
Scroll panel A. Flush rAF.
Assert panel B's scrollTop WAS set proportionally.
```

### SS-I4: SectionNav click coexists with sync scroll
```
Render App with sync enabled.
Click a section in SectionNav.
Assert both panels scroll to that section (existing handleSectionClick behavior).
This verifies that the sync scroll hook and the manual section click coexist
without interference.
```

### SS-I5: Sync scroll works with dynamically added sections
```
Render App with pipeline in "fetching" state (no sections rendered).
Transition pipeline to "done" (FilingContent renders <section> elements).
Scroll panel A.
Assert panel B syncs correctly (sections queried fresh on each scroll).
Note: No MutationObserver needed — v2 queries sections via getSectionRects on each scroll event.
```

---

## 6. UAT Scenarios (Chrome DevTools MCP)

File: `.specs/us-2-11-sync-scroll/uat.md`

### UAT-1: Toggle visibility
```
1. Open the app at localhost
2. Verify the "Sync Scroll" toggle button is visible in the Header
3. Take screenshot showing the toggle in enabled state
```

### UAT-2: Proportional sync — scroll through a section
```
1. Load two filings with matching sections
2. Scroll Filing A so that a section is approximately 60% scrolled through
3. Verify Filing B shows the same section at approximately the same scroll depth
4. Take screenshot showing both panels with aligned content
5. KEY CHECK: The alignment should be proportional — not snapped to the top of the section
```

### UAT-3: Toggle disables sync
```
1. Click the "Sync Scroll" toggle button (OFF)
2. Scroll Filing A several sections down
3. Verify Filing B remains at its current position
4. Take screenshot showing panels at different positions
```

### UAT-4: Toggle re-enables sync
```
1. With sync disabled, scroll panels to different positions
2. Click the "Sync Scroll" toggle button (ON)
3. Scroll Filing A slightly to trigger sync
4. Verify Filing B syncs to match Filing A's position
5. Take screenshot showing panels re-synchronized
```

### UAT-5: Bidirectional sync
```
1. With sync enabled, scroll Filing B
2. Verify Filing A follows proportionally
3. Then scroll Filing A
4. Verify Filing B follows proportionally
5. Take screenshot of each direction
```

### UAT-6: No huge jumps — smooth tracking (KEY TEST: v1 failure mode)
```
1. Load two filings with sections of different sizes
2. Slowly scroll Filing A from top to bottom
3. Observe Filing B tracking — it should move smoothly and proportionally
4. KEY CHECK: No sudden jumps where the panel snaps to a section top
5. KEY CHECK: When scrolling within a large section, the other panel tracks
   proportionally within the same section (not stuck until the next section)
6. Take screenshot at multiple points during the scroll to verify smooth tracking
```

---

## 7. Boundary Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-B1 | 0 sections (empty filing, refs valid) | Listeners attached but `findSectionAtPosition` returns null → handler no-ops. No errors. |
| SS-B2 | 1 section in both panels | Proportional sync within the single section; scrolling A maps ratio to B's section |
| SS-B3 | 20+ sections in both panels | Binary search efficiently finds the correct section among many; sync works for any section |
| SS-B4 | Very large section (> 3 viewports tall) | Proportional ratio mapping tracks smoothly through the section — no jumps |
| SS-B5 | Very small section (< 50px) | Binary search detects it when viewport center passes through; ratio computed correctly |
| SS-B6 | Mismatched section counts (A has 10, B has 7) | Matching IDs sync proportionally; non-matching sections fall back to global ratio |
| SS-B7 | Both panels at the same section already | scrollTop is set to computed value — proportional mapping naturally produces correct position |
| SS-B8 | scrollTop would be negative | `computeTargetScrollTop` may return negative; browser clamps `scrollTop` to 0 on assignment |
| SS-B9 | scrollTop would exceed scrollHeight - clientHeight | `computeTargetScrollTop` may return large value; browser clamps `scrollTop` to max on assignment |
| SS-B10 | Gap between sections (preamble, padding) | `findSectionAtPosition` binary search fallback snaps to nearest section |

---

## 8. Error Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-ERR1 | Both panel refs null (not mounted) | Hook early-returns (`if (!panelA \|\| !panelB \|\| !enabled) return`); no listeners attached |
| SS-ERR2 | One panel ref null | Hook early-returns; no listeners attached |
| SS-ERR3 | Section exists in panel A but not panel B | Falls back to global proportional scrolling (`scrollTop/scrollHeight` ratio); no error |
| SS-ERR4 | Sections load asynchronously (pipeline states) | No issue — `getSectionRects` queries `querySelectorAll('section[id]')` fresh each scroll; returns `[]` during loading |
| SS-ERR5 | Panel unmounted mid-scroll (race condition) | useEffect cleanup removes listeners; in-flight rAF may fire but harmlessly sets scrollTop on still-mounted target |
| SS-ERR6 | Toggle disable during active rAF | useEffect cleanup removes listeners; pending rAF callback may fire one last time (harmless) |
| SS-ERR7 | Zero-height section | `computeRatio` guard returns 0; no division by zero |

---

## 9. Performance Criteria

| Criterion | Target | How to Verify |
|-----------|--------|---------------|
| Scroll handler latency | < 16ms (one frame budget) | rAF debouncing ensures at most one handler per frame |
| No dropped frames | 0 dropped frames during normal sync | Chrome DevTools Performance panel; UAT-6 visual check |
| rAF debouncing | One pending rAF per panel at a time | `cancelAnimationFrame` on stale frames; verified by SS-U7 |
| No IntersectionObserver overhead | Zero observers | v2 uses binary search over `offsetTop` instead |
| No MutationObserver overhead | Zero observers | v2 queries sections fresh each scroll via `getSectionRects` |
| Loop prevention | Single boolean flag | `isProgrammaticScrollRef` checked BEFORE rAF; no timeout needed |
| Binary search efficiency | O(log n) per scroll event | Pure function with sorted sections; verified by SS-PF7 with 25 sections |
| Memory | No leaks | SS-U3 verifies cleanup of scroll listeners on unmount |

---

## 10. Test Data & Fixtures

### Container Factory (v2 — with layout properties)

```typescript
function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  let top = 0;
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    const height = 500;
    const sectionTop = top; // capture for closure
    Object.defineProperty(section, 'offsetTop', { get: () => sectionTop, configurable: true });
    Object.defineProperty(section, 'offsetHeight', { get: () => height, configurable: true });
    container.appendChild(section);
    top += height;
  }
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: top, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
  return container;
}
```

### Custom Layout Container

```typescript
// For tests needing specific section sizes
function makeCustomContainer(
  specs: Array<{ id: string; height: number }>
): HTMLDivElement {
  const container = document.createElement('div');
  let top = 0;
  for (const { id, height } of specs) {
    const section = document.createElement('section');
    section.id = id;
    const sectionTop = top;
    Object.defineProperty(section, 'offsetTop', { get: () => sectionTop, configurable: true });
    Object.defineProperty(section, 'offsetHeight', { get: () => height, configurable: true });
    container.appendChild(section);
    top += height;
  }
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: top, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
  return container;
}
```

### rAF Mock

```typescript
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 0;

vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
  rafCallback = cb;
  return ++rafIdCounter;
}));
vi.stubGlobal('cancelAnimationFrame', vi.fn());

function flushRAF(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(performance.now());
  }
}
```

### Standard Test Fixtures
- **Two panels, matching sections**: `makeContainer('s1', 's2', 's3')` x2
- **Mismatched sections**: A = `['s1', 's2', 's3']`, B = `['s1', 's3']`
- **Empty panels**: `makeContainer()` (no section children)
- **Single section**: `makeContainer('s1')` x2
- **Many sections**: `makeContainer(...Array.from({length: 25}, (_, i) => 's' + (i+1)))` x2
- **Different heights**: `makeCustomContainer([{id:'s1',height:2000}, {id:'s2',height:100}])` for proportional tests

---

## Test ID Index

| ID | Type | Description |
|----|------|-------------|
| SS-PF1 | Pure fn | `findSectionAtPosition` — empty array returns null |
| SS-PF2 | Pure fn | `findSectionAtPosition` — position before first section |
| SS-PF3 | Pure fn | `findSectionAtPosition` — position in middle of section |
| SS-PF4 | Pure fn | `findSectionAtPosition` — position at exact boundary |
| SS-PF5 | Pure fn | `findSectionAtPosition` — position after last section |
| SS-PF6 | Pure fn | `findSectionAtPosition` — single section |
| SS-PF7 | Pure fn | `findSectionAtPosition` — binary search with 25 sections |
| SS-PF8 | Pure fn | `findSectionAtPosition` — gap between sections |
| SS-PF9 | Pure fn | `computeRatio` — section start → 0 |
| SS-PF10 | Pure fn | `computeRatio` — section end → 1 |
| SS-PF11 | Pure fn | `computeRatio` — section midpoint → 0.5 |
| SS-PF12 | Pure fn | `computeRatio` — arbitrary position |
| SS-PF13 | Pure fn | `computeRatio` — zero-height section guard |
| SS-PF14 | Pure fn | `computeRatio` — clamp below 0 |
| SS-PF15 | Pure fn | `computeRatio` — clamp above 1 |
| SS-PF16 | Pure fn | `computeTargetScrollTop` — ratio 0 |
| SS-PF17 | Pure fn | `computeTargetScrollTop` — ratio 1 |
| SS-PF18 | Pure fn | `computeTargetScrollTop` — ratio 0.5 |
| SS-PF19 | Pure fn | `computeTargetScrollTop` — negative result (browser clamps) |
| SS-PF20 | Pure fn | `computeTargetScrollTop` — ratio 0.75 |
| SS-PF21 | Pure fn | `getSectionRects` — no sections returns empty array |
| SS-PF22 | Pure fn | `getSectionRects` — returns correct SectionRect values |
| SS-PF23 | Pure fn | `getSectionRects` — ignores sections without id |
| SS-PF24 | Pure fn | `getSectionRects` — returns in document order |
| SS-U1 | Unit | Attaches scroll listeners with `{ passive: true }` when enabled |
| SS-U2 | Unit | Does not attach listeners when disabled |
| SS-U3 | Unit | Removes listeners on unmount |
| SS-U4 | Unit | Scroll sets scrollTop on other panel (NOT scrollIntoView) |
| SS-U5 | Unit | Prevents infinite scroll loop via isProgrammaticScrollRef |
| SS-U6 | Unit | Uses requestAnimationFrame for debouncing |
| SS-U7 | Unit | Coalesces rapid scroll events via cancelAnimationFrame |
| SS-U8 | Unit | Handles null refs (early return) |
| SS-U9 | Unit | Missing section — falls back to global proportional scroll |
| SS-U10 | Unit | Toggle removes/adds listeners dynamically |
| SS-U11 | Unit | Sections queried fresh on each scroll (dynamic DOM) |
| SS-U12 | Unit | No sections loaded — handler no-ops |
| SS-H1 | Unit | Header renders toggle with aria-pressed=true |
| SS-H2 | Unit | Header renders toggle with aria-pressed=false |
| SS-H3 | Unit | Header toggle click calls onSyncToggle |
| SS-H4 | Unit | Header omits toggle when props not provided |
| SS-I1 | Integration | App renders Header with sync toggle |
| SS-I2 | Integration | Two panels sync proportionally via hook |
| SS-I3 | Integration | Toggle disables/enables sync |
| SS-I4 | Integration | SectionNav click coexists with sync |
| SS-I5 | Integration | Sync works with dynamically added sections |
| UAT-1 | UAT | Toggle visibility |
| UAT-2 | UAT | Proportional sync through a section |
| UAT-3 | UAT | Toggle disables sync |
| UAT-4 | UAT | Toggle re-enables sync |
| UAT-5 | UAT | Bidirectional sync |
| UAT-6 | UAT | No huge jumps — smooth tracking (v1 failure mode) |
| SS-B1–B10 | Boundary | Edge cases (empty, small, large, mismatched, clamping, gaps) |
| SS-ERR1–ERR7 | Error | Error conditions |
