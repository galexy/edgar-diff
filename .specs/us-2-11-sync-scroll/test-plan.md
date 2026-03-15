# US-2.11 Synchronized Scrolling — Test Plan (v3)

> **v3 rationale**: v1 used section-snapping via `scrollIntoView` — huge jumps.
> v2 used proportional section-based ratios — fundamentally wrong when sections
> have different paragraph counts (50% through old ≠ 50% through new).
>
> v3 uses **content-aligned anchor maps** built from diff data. Section boundaries
> and changed blocks (modified/moved paragraphs and tables with `data-block-key`
> attributes) form anchor points. Scroll positions are translated via binary search
> + linear interpolation on the anchor array. No ratio computation, no section-snapping.

---

## 1. BDD Acceptance Criteria

### AC-1: Scrolling Filing A aligns Filing B at corresponding content

```gherkin
Scenario: SS-AC1-1 — Scroll Filing A syncs Filing B at corresponding content
  Given both panels have filings loaded with matching sections and annotated blocks
  And sync scrolling is enabled (default)
  When the user scrolls Filing A so that a modified paragraph is near the viewport top
  Then Filing B sets scrollTop so the corresponding modified paragraph aligns
  And Filing B does NOT call scrollIntoView (scrollTop is set directly)

Scenario: SS-AC1-2 — Scroll Filing B syncs Filing A (bidirectional)
  Given both panels have filings loaded
  And sync scrolling is enabled
  When the user scrolls Filing B
  Then Filing A sets scrollTop via translatePosition with direction 'newToOld'

Scenario: SS-AC1-3 — No filings loaded
  Given no filings are loaded in either panel
  And sync scrolling is enabled
  When the user scrolls either panel
  Then nothing happens and no errors are thrown

Scenario: SS-AC1-4 — One panel empty
  Given Filing A has sections and Filing B is empty (no document)
  And sync scrolling is enabled
  When the user scrolls Filing A
  Then no error is thrown (the hook early-returns when either ref is null)
```

### AC-2: Unchanged content aligns exactly; changed content aligns via nearest anchor

```gherkin
Scenario: SS-AC2-1 — Content-aligned sync within a section
  Given Filing A has section "item-1a" with modified paragraphs at positions 200, 800
  And Filing B has section "item-1a" with the same paragraphs at positions 150, 900
  And sync scrolling is enabled
  When the user scrolls Filing A to position 500 (between the two anchors)
  Then Filing B scrollTop is computed via linear interpolation between the anchors
  And the alignment reflects content correspondence, not proportional ratio

Scenario: SS-AC2-2 — Unchanged sections align via section boundary anchors
  Given section "item-2" has no modified paragraphs (identical in both filings)
  And section "item-2" boundaries exist as anchors in both panels
  When the user scrolls to section "item-2" in Filing A
  Then Filing B scrolls to section "item-2" using the section boundary anchor
  And within the section, offset translation from the anchor provides alignment

Scenario: SS-AC2-3 — Added/removed sections interpolate between surrounding anchors
  Given Filing A has sections [s1, s2-added, s3] and Filing B has sections [s1, s3]
  And s2-added has no matching anchor in Filing B
  When the user scrolls Filing A into section s2-added
  Then Filing B position is interpolated between the s1 and s3 anchors
  And no error is thrown
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
  When the user scrolls Filing A
  Then Filing B remains at its current scroll position
  And scrollTop on Filing B is NOT modified programmatically

Scenario: SS-AC4-2 — Re-enabling syncs from current position
  Given sync was disabled and user scrolled panels to different positions
  When the user re-enables sync
  And the user scrolls Filing A (triggering a new scroll event)
  Then Filing B syncs to the content-aligned position via anchor map
```

---

## 2. Unit Tests — Pure Functions (`lib/sync-scroll.ts`)

File: `apps/web/src/lib/sync-scroll.test.ts`

Pure functions are exported from `lib/sync-scroll.ts` — separate from the React hook.
They operate on `Anchor[]` and `Map<string, number>` — no DOM or React dependencies
(except `measureElements` which reads DOM positions).

### Types

```typescript
// Exported from lib/sync-scroll.ts
export interface Anchor {
  oldY: number;
  newY: number;
}

export type SyncDirection = 'oldToNew' | 'newToOld';
```

### 2a. `computeAnchors(oldPositions, newPositions)` — Anchor Matching

Returns `Anchor[]` sorted by `oldY`.

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeAnchors,
  translatePosition,
  measureElements,
  type Anchor,
  type SyncDirection,
} from './sync-scroll';

describe('computeAnchors', () => {
  // SS-CA1: Empty maps → empty anchors
  it('returns empty array when both maps are empty', () => {
    expect(computeAnchors(new Map(), new Map())).toEqual([]);
  });

  // SS-CA2: No matching keys → empty anchors
  it('returns empty array when no keys match', () => {
    const oldPos = new Map([['section:s1', 0], ['item-1a:pd:0', 100]]);
    const newPos = new Map([['section:s2', 0], ['item-2:pd:0', 200]]);
    expect(computeAnchors(oldPos, newPos)).toEqual([]);
  });

  // SS-CA3: All keys match → full anchor list sorted by oldY
  it('returns anchors for all matching keys, sorted by oldY', () => {
    const oldPos = new Map([
      ['section:s1', 0],
      ['section:s2', 500],
      ['item-1a:pd:0', 200],
    ]);
    const newPos = new Map([
      ['section:s1', 0],
      ['section:s2', 600],
      ['item-1a:pd:0', 150],
    ]);
    const result = computeAnchors(oldPos, newPos);
    expect(result).toEqual([
      { oldY: 0, newY: 0 },       // section:s1
      { oldY: 200, newY: 150 },   // item-1a:pd:0
      { oldY: 500, newY: 600 },   // section:s2
    ]);
  });

  // SS-CA4: Partial matches → only matched keys included
  it('includes only keys that exist in both maps', () => {
    const oldPos = new Map([
      ['section:s1', 0],
      ['section:s2', 500],
      ['item-1a:pd:0', 200],
    ]);
    const newPos = new Map([
      ['section:s1', 0],
      ['section:s3', 700], // s3 not in old
      ['item-1a:pd:0', 150],
    ]);
    const result = computeAnchors(oldPos, newPos);
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { oldY: 0, newY: 0 },       // section:s1
      { oldY: 200, newY: 150 },   // item-1a:pd:0
    ]);
  });

  // SS-CA5: Unsorted input → output sorted by oldY
  it('sorts output by oldY regardless of input order', () => {
    const oldPos = new Map([
      ['section:s2', 500],
      ['section:s1', 0],
      ['item-1a:pd:0', 200],
    ]);
    const newPos = new Map([
      ['section:s2', 600],
      ['item-1a:pd:0', 150],
      ['section:s1', 0],
    ]);
    const result = computeAnchors(oldPos, newPos);
    expect(result[0].oldY).toBeLessThanOrEqual(result[1].oldY);
    expect(result[1].oldY).toBeLessThanOrEqual(result[2].oldY);
  });

  // SS-CA6: Duplicate oldY values — both included (no dedup)
  it('handles multiple anchors at the same oldY position', () => {
    const oldPos = new Map([
      ['section:s1', 100],
      ['item-1a:pd:0', 100], // same Y as section
    ]);
    const newPos = new Map([
      ['section:s1', 50],
      ['item-1a:pd:0', 120],
    ]);
    const result = computeAnchors(oldPos, newPos);
    expect(result).toHaveLength(2);
  });

  // SS-CA7: Large map — all keys matched
  it('handles 100+ matching keys', () => {
    const oldPos = new Map<string, number>();
    const newPos = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      oldPos.set(`key:${i}`, i * 10);
      newPos.set(`key:${i}`, i * 12);
    }
    const result = computeAnchors(oldPos, newPos);
    expect(result).toHaveLength(100);
    // Verify sorted by oldY
    for (let i = 1; i < result.length; i++) {
      expect(result[i].oldY).toBeGreaterThanOrEqual(result[i - 1].oldY);
    }
  });
});
```

### 2b. `translatePosition(anchors, sourceY, direction)` — Scroll Translation

Returns target scrollTop via binary search + linear interpolation.

```typescript
describe('translatePosition', () => {
  // SS-TP1: Empty anchors → passthrough (returns sourceY)
  it('returns sourceY unchanged when anchors array is empty', () => {
    expect(translatePosition([], 500, 'oldToNew')).toBe(500);
  });

  // SS-TP2: Single anchor → offset translation
  it('applies offset translation with a single anchor', () => {
    const anchors: Anchor[] = [{ oldY: 100, newY: 150 }];
    // offset = 150 - 100 = 50; result = 200 - 100 + 150 = 250
    expect(translatePosition(anchors, 200, 'oldToNew')).toBe(250);
  });

  // SS-TP3: Before first anchor → offset from first
  it('uses offset from first anchor when sourceY is before all anchors', () => {
    const anchors: Anchor[] = [
      { oldY: 200, newY: 300 },
      { oldY: 600, newY: 700 },
    ];
    // sourceY=50, before first anchor (oldY=200)
    // result = 50 - 200 + 300 = 150
    expect(translatePosition(anchors, 50, 'oldToNew')).toBe(150);
  });

  // SS-TP4: After last anchor → offset from last
  it('uses offset from last anchor when sourceY is after all anchors', () => {
    const anchors: Anchor[] = [
      { oldY: 100, newY: 150 },
      { oldY: 400, newY: 500 },
    ];
    // sourceY=700, after last anchor (oldY=400)
    // result = 700 - 400 + 500 = 800
    expect(translatePosition(anchors, 700, 'oldToNew')).toBe(800);
  });

  // SS-TP5: Between two anchors → linear interpolation
  it('linearly interpolates between bracketing anchors', () => {
    const anchors: Anchor[] = [
      { oldY: 100, newY: 200 },
      { oldY: 300, newY: 600 },
    ];
    // sourceY=200 is midpoint (t = (200-100)/(300-100) = 0.5)
    // result = 200 + 0.5 * (600-200) = 200 + 200 = 400
    expect(translatePosition(anchors, 200, 'oldToNew')).toBe(400);
  });

  // SS-TP6: Exact match on anchor → returns target position exactly
  it('returns exact target position when sourceY matches an anchor', () => {
    const anchors: Anchor[] = [
      { oldY: 100, newY: 200 },
      { oldY: 300, newY: 600 },
      { oldY: 500, newY: 700 },
    ];
    // sourceY=300 exactly matches second anchor
    // Since sourceY <= sorted[0].srcKey won't trigger (300 > 100)
    // and sourceY >= last.srcKey won't trigger (300 < 500)
    // Binary search: lo=1 (sorted[1].oldY=300 <= 300), so bracket is [1,2]
    // t = (300-300)/(500-300) = 0 → result = 600
    expect(translatePosition(anchors, 300, 'oldToNew')).toBe(600);
  });

  // SS-TP7: Duplicate oldY at start — handled by before-first edge case
  // Note: The srcSpan === 0 guard in translatePosition is defensive dead code.
  // The binary search invariant (sorted[lo].srcKey <= sourceY < sorted[hi].srcKey)
  // guarantees srcSpan > 0. Duplicate oldY values at the start are caught by the
  // "before first anchor" branch (sourceY <= sorted[0].srcKey).
  it('handles duplicate oldY at start via before-first offset', () => {
    const anchors: Anchor[] = [
      { oldY: 100, newY: 200 },
      { oldY: 100, newY: 300 }, // same oldY as first
      { oldY: 500, newY: 700 },
    ];
    // sourceY=100 <= sorted[0].oldY=100 → before-first branch
    // result = 100 - 100 + 200 = 200
    expect(translatePosition(anchors, 100, 'oldToNew')).toBe(200);
  });

  // SS-TP8: oldToNew direction — uses oldY as source, newY as target
  it('translates oldToNew correctly', () => {
    const anchors: Anchor[] = [
      { oldY: 0, newY: 0 },
      { oldY: 1000, newY: 500 },
    ];
    // sourceY=500, t = (500-0)/(1000-0) = 0.5
    // result = 0 + 0.5 * (500-0) = 250
    expect(translatePosition(anchors, 500, 'oldToNew')).toBe(250);
  });

  // SS-TP9: newToOld direction — uses newY as source, oldY as target
  it('translates newToOld correctly (re-sorted by newY)', () => {
    const anchors: Anchor[] = [
      { oldY: 0, newY: 0 },
      { oldY: 1000, newY: 500 },
    ];
    // For newToOld: sorted by newY → [{oldY:0,newY:0}, {oldY:1000,newY:500}]
    // sourceY=250, srcKey=newY, tgtKey=oldY
    // t = (250-0)/(500-0) = 0.5
    // result = 0 + 0.5 * (1000-0) = 500
    expect(translatePosition(anchors, 250, 'newToOld')).toBe(500);
  });

  // SS-TP10: Many anchors → correct binary search bracket
  it('finds correct bracket among 50 anchors via binary search', () => {
    const anchors: Anchor[] = Array.from({ length: 50 }, (_, i) => ({
      oldY: i * 100,
      newY: i * 120, // slightly different spacing
    }));
    // sourceY=2550 → between anchor 25 (oldY=2500) and anchor 26 (oldY=2600)
    // t = (2550-2500)/(2600-2500) = 0.5
    // newY range: 3000 to 3120
    // result = 3000 + 0.5 * (3120-3000) = 3000 + 60 = 3060
    expect(translatePosition(anchors, 2550, 'oldToNew')).toBe(3060);
  });

  // SS-TP11: sourceY at 0 with first anchor at 0 → returns anchor target
  it('handles sourceY=0 when first anchor is at position 0', () => {
    const anchors: Anchor[] = [
      { oldY: 0, newY: 50 },
      { oldY: 500, newY: 600 },
    ];
    // sourceY=0 <= sorted[0].oldY=0 → offset: 0 - 0 + 50 = 50
    expect(translatePosition(anchors, 0, 'oldToNew')).toBe(50);
  });

  // SS-TP12: Quarter interpolation
  it('interpolates correctly at 25% between anchors', () => {
    const anchors: Anchor[] = [
      { oldY: 0, newY: 0 },
      { oldY: 400, newY: 800 },
    ];
    // sourceY=100, t = 100/400 = 0.25
    // result = 0 + 0.25 * 800 = 200
    expect(translatePosition(anchors, 100, 'oldToNew')).toBe(200);
  });

  // SS-TP13: Non-monotonic newY values (reordered sections)
  it('handles non-monotonic newY values correctly', () => {
    const anchors: Anchor[] = [
      { oldY: 0, newY: 500 },   // section moved down in new
      { oldY: 500, newY: 0 },   // section moved up in new
    ];
    // sourceY=250 between anchors, t = (250-0)/(500-0) = 0.5
    // result = 500 + 0.5 * (0-500) = 500 - 250 = 250
    expect(translatePosition(anchors, 250, 'oldToNew')).toBe(250);
  });
});
```

### 2c. `measureElements(panel)` — DOM Position Query (jsdom)

```typescript
describe('measureElements', () => {
  // Helper: create a panel with sections and block elements,
  // mocking getBoundingClientRect for positioning
  function makePanel(
    sections: Array<{ id: string; top: number }>,
    blocks: Array<{ key: string; top: number }>,
    panelTop = 0,
    scrollTop = 0,
  ): HTMLDivElement {
    const panel = document.createElement('div');

    // Mock panel's getBoundingClientRect and scrollTop
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: panelTop, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', {
      value: scrollTop, writable: true, configurable: true,
    });

    for (const { id, top } of sections) {
      const section = document.createElement('section');
      section.id = id;
      vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 100,
        width: 800, height: 100, x: 0, y: top, toJSON: () => {},
      });
      panel.appendChild(section);
    }

    for (const { key, top } of blocks) {
      const el = document.createElement('p');
      el.dataset.blockKey = key;
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 20,
        width: 800, height: 20, x: 0, y: top, toJSON: () => {},
      });
      panel.appendChild(el);
    }

    return panel;
  }

  // SS-ME1: Panel with sections → returns section keys with positions
  it('returns section keys with absolute Y positions', () => {
    const panel = makePanel(
      [{ id: 'item-1a', top: 100 }, { id: 'item-2', top: 500 }],
      [],
      0,   // panelTop
      0,   // scrollTop
    );
    const positions = measureElements(panel);
    expect(positions.get('section:item-1a')).toBe(100); // 100 - 0 + 0
    expect(positions.get('section:item-2')).toBe(500);
  });

  // SS-ME2: Panel with data-block-key elements → returns block keys
  it('returns block keys with absolute Y positions', () => {
    const panel = makePanel(
      [],
      [{ key: 'item-1a:pd:0', top: 200 }, { key: 'item-1a:pd:1', top: 400 }],
    );
    const positions = measureElements(panel);
    expect(positions.get('item-1a:pd:0')).toBe(200);
    expect(positions.get('item-1a:pd:1')).toBe(400);
  });

  // SS-ME3: Empty panel → empty map
  it('returns empty map for panel with no sections or blocks', () => {
    const panel = makePanel([], []);
    const positions = measureElements(panel);
    expect(positions.size).toBe(0);
  });

  // SS-ME4: Mixed sections and blocks → all included
  it('returns both section and block keys', () => {
    const panel = makePanel(
      [{ id: 'item-1a', top: 0 }],
      [{ key: 'item-1a:pd:0', top: 100 }],
    );
    const positions = measureElements(panel);
    expect(positions.has('section:item-1a')).toBe(true);
    expect(positions.has('item-1a:pd:0')).toBe(true);
    expect(positions.size).toBe(2);
  });

  // SS-ME5: Scrolled panel → absolute Y = el.top - panel.top + scrollTop
  it('computes absolute Y correctly when panel is scrolled', () => {
    const panel = makePanel(
      [{ id: 's1', top: -200 }], // scrolled up: viewport-relative top is negative
      [],
      0,     // panelTop
      500,   // scrollTop
    );
    const positions = measureElements(panel);
    // absoluteY = (-200) - 0 + 500 = 300
    expect(positions.get('section:s1')).toBe(300);
  });

  // SS-ME6: Sections without id are not included
  it('ignores <section> elements without an id attribute', () => {
    const panel = document.createElement('div');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', { value: 0, writable: true });
    const s = document.createElement('section'); // no id
    panel.appendChild(s);
    const positions = measureElements(panel as HTMLDivElement);
    expect(positions.size).toBe(0);
  });
});
```

### 2d. `injectBlockKey(blockHtml, key)` — DOM Annotation

```typescript
import { injectBlockKey } from './highlight-injector';

describe('injectBlockKey', () => {
  // SS-IB1: Normal HTML tag → attribute inserted before >
  it('injects data-block-key into a normal HTML tag', () => {
    const result = injectBlockKey('<p class="text">', 'item-1a:pd:0');
    expect(result).toBe('<p class="text" data-block-key="item-1a:pd:0">');
  });

  // SS-IB2: Full element with content
  it('injects into opening tag of element with content', () => {
    const result = injectBlockKey('<p>Hello world</p>', 'item-1a:pd:0');
    expect(result).toBe('<p data-block-key="item-1a:pd:0">Hello world</p>');
  });

  // SS-IB3: Self-closing tag → attribute inserted before />
  it('injects into self-closing tag before />', () => {
    const result = injectBlockKey('<br />', 'item-1a:pd:0');
    expect(result).toBe('<br data-block-key="item-1a:pd:0" />');
  });

  // SS-IB4: Raw text (no tag) → wrapped in <span data-block-key="...">
  it('wraps raw text in a span with data-block-key', () => {
    const result = injectBlockKey('Just some text', 'item-1a:pd:0');
    expect(result).toBe('<span data-block-key="item-1a:pd:0">Just some text</span>');
  });

  // SS-IB5: No closing > → returns unchanged
  it('returns unchanged when no closing > found', () => {
    const result = injectBlockKey('<p class="broken', 'item-1a:pd:0');
    expect(result).toBe('<p class="broken');
  });

  // SS-IB6: Tag with existing attributes
  it('injects alongside existing attributes', () => {
    const result = injectBlockKey(
      '<div class="highlight" style="color:red">content</div>',
      'item-7:td:2'
    );
    expect(result).toBe(
      '<div class="highlight" style="color:red" data-block-key="item-7:td:2">content</div>'
    );
  });

  // SS-IB7: Leading whitespace before tag
  it('handles leading whitespace before the tag', () => {
    const result = injectBlockKey('  <p>text</p>', 'item-1a:pd:0');
    expect(result).toBe('  <p data-block-key="item-1a:pd:0">text</p>');
  });

  // SS-IB8: Leading whitespace with no tag → span wrapper
  it('wraps in span when leading whitespace has no tag', () => {
    const result = injectBlockKey('  plain text', 'item-1a:pd:0');
    expect(result).toBe('<span data-block-key="item-1a:pd:0">  plain text</span>');
  });

  // SS-IB9: Table element
  it('injects into table element', () => {
    const result = injectBlockKey('<table class="data">', 'item-7:td:0');
    expect(result).toBe('<table class="data" data-block-key="item-7:td:0">');
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
// jsdom doesn't compute layout, so we mock getBoundingClientRect on sections
// and data-block-key elements, plus scrollTop/clientHeight on the container.

function makeContainer(
  sections: string[],
  blocks: Array<{ key: string; top: number }> = [],
): HTMLDivElement {
  const container = document.createElement('div');
  let top = 0;

  // Mock container getBoundingClientRect
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });

  for (const id of sections) {
    const section = document.createElement('section');
    section.id = id;
    const sectionTop = top;
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
      top: sectionTop, left: 0, right: 800, bottom: sectionTop + 500,
      width: 800, height: 500, x: 0, y: sectionTop, toJSON: () => {},
    });
    container.appendChild(section);
    top += 500;
  }

  for (const { key, top: blockTop } of blocks) {
    const el = document.createElement('p');
    el.dataset.blockKey = key;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: blockTop, left: 0, right: 800, bottom: blockTop + 20,
      width: 800, height: 20, x: 0, y: blockTop, toJSON: () => {},
    });
    container.appendChild(el);
  }

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

### Hook Signature (v3 — unchanged from v2)

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
  const containerA = makeContainer(['s1', 's2']);
  const containerB = makeContainer(['s1', 's2']);
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
  const containerA = makeContainer(['s1', 's2']);
  const containerB = makeContainer(['s1', 's2']);
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
  const containerA = makeContainer(['s1']);
  const containerB = makeContainer(['s1']);
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
  const containerA = makeContainer(['s1', 's2', 's3']);
  const containerB = makeContainer(['s1', 's2', 's3']);

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Simulate user scrolling panel A
  containerA.scrollTop = 500;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // containerB.scrollTop should have been set (not scrollIntoView)
  // Exact value depends on anchor positions — key assertion is that it was modified
  expect(containerB.scrollTop).not.toBe(0);
});
```

#### SS-U5: Loop prevention — programmatic scroll doesn't trigger reciprocal sync
```typescript
it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
  const containerA = makeContainer(['s1', 's2']);
  const containerB = makeContainer(['s1', 's2']);

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
  const containerA = makeContainer(['s1']);
  const containerB = makeContainer(['s1']);

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  act(() => { fireScroll(containerA); });

  // rAF should have been called (handler queued, not executed synchronously)
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
});
```

#### SS-U7: Coalesces rapid scroll events via cancelAnimationFrame + rAF
```typescript
it('coalesces rapid scroll events via cancelAnimationFrame', () => {
  const containerA = makeContainer(['s1', 's2']);
  const containerB = makeContainer(['s1', 's2']);
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
  const container = makeContainer(['s1']);
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true));
  }).not.toThrow();
});
```

#### SS-U9: Toggling enabled removes/adds listeners dynamically
```typescript
it('removes listeners when toggled from enabled to disabled', () => {
  const containerA = makeContainer(['s1']);
  const containerB = makeContainer(['s1']);
  const spyA = vi.spyOn(containerA, 'removeEventListener');

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
    { initialProps: { enabled: true } },
  );

  rerender({ enabled: false });

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
});

it('re-attaches listeners when toggled from disabled to enabled', () => {
  const containerA = makeContainer(['s1']);
  const containerB = makeContainer(['s1']);
  const spyA = vi.spyOn(containerA, 'addEventListener');

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
    { initialProps: { enabled: false } },
  );

  rerender({ enabled: true });

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
});
```

#### SS-U10: No sections or blocks — handler no-ops via passthrough
```typescript
it('passes through sourceY when no sections or blocks exist (empty panels)', () => {
  const containerA = makeContainer([]); // no sections
  const containerB = makeContainer([]); // no sections

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  containerA.scrollTop = 100;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // computeAnchors returns [] → translatePosition returns sourceY passthrough
  // containerB.scrollTop = 100 (passthrough)
  expect(containerB.scrollTop).toBe(100);
});
```

#### SS-U11: Sections are queried fresh on each scroll (no stale cache)
```typescript
it('queries elements fresh on each scroll event (handles dynamic DOM)', () => {
  const containerA = makeContainer(['s1']);
  const containerB = makeContainer(['s1']);

  renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

  // Dynamically add a section to both panels
  for (const container of [containerA, containerB]) {
    const newSection = document.createElement('section');
    newSection.id = 's2';
    vi.spyOn(newSection, 'getBoundingClientRect').mockReturnValue({
      top: 500, left: 0, right: 800, bottom: 1000,
      width: 800, height: 500, x: 0, y: 500, toJSON: () => {},
    });
    container.appendChild(newSection);
  }

  // Scroll to new section — should work without re-initialization
  containerA.scrollTop = 700;
  expect(() => {
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });
  }).not.toThrow();
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

### SS-I2: Highlight injector produces `data-block-key` on modified paragraphs
```
Call applyHighlightsToSection with a sectionDiff containing modified paragraphs.
Verify the output HTML includes data-block-key attributes on modified blocks.
Verify added-only and removed-only blocks do NOT get data-block-key attributes.
```

### SS-I2b: Modified paragraph with no highlights on current side still gets `data-block-key`
```
Call applyHighlightsToSection on the 'old' side with a modified paragraph
that has word changes only on the 'new' side (filteredChanges.length === 0 for 'old').
Verify the output HTML still includes data-block-key on that paragraph,
even though no <del> highlights are injected.
This tests the design change where the annotation is injected AFTER the
highlight logic, regardless of whether highlights were produced.
```

### SS-I3: Two panels with annotated blocks sync correctly
```
Render two panel containers with matching section[id] elements
and elements annotated with data-block-key attributes.
Attach useSyncedScroll to their refs.
Set scrollTop on panel A. Fire scroll event. Flush rAF.
Assert panel B's scrollTop was set via anchor-based translation.
```

### SS-I4: Toggle disables/enables sync between panels
```
Render App with sync enabled.
Click the Header toggle to disable (aria-pressed becomes "false").
Scroll panel A.
Assert panel B's scrollTop was NOT modified.
Click toggle to re-enable (aria-pressed becomes "true").
Scroll panel A. Flush rAF.
Assert panel B's scrollTop WAS set via anchor translation.
```

### SS-I5: Sync scroll works with dynamically rendered sections
```
Render App with pipeline in "fetching" state (no sections rendered).
Transition pipeline to "done" (FilingContent renders <section> elements).
Scroll panel A.
Assert panel B syncs correctly (elements queried fresh on each scroll via
measureElements → querySelectorAll).
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

### UAT-2: Content alignment — scroll to a section, verify corresponding content
```
1. Load two filings with matching sections and changed paragraphs
2. Scroll Filing A so that a modified paragraph is near the top of the viewport
3. Verify Filing B shows the SAME modified paragraph near the top
4. Take screenshot showing both panels with aligned content
5. KEY CHECK: The alignment is content-based — the same paragraph appears at the
   same relative position in both panels, even if section sizes differ
6. CONTRAST WITH v2: In v2, proportional mapping would show different paragraphs
   if the section had different paragraph counts in old vs new
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
4. Verify Filing B syncs to match Filing A's content-aligned position
5. Take screenshot showing panels re-synchronized
```

### UAT-5: Bidirectional sync
```
1. With sync enabled, scroll Filing B
2. Verify Filing A follows at corresponding content positions
3. Then scroll Filing A
4. Verify Filing B follows at corresponding content positions
5. Take screenshot of each direction
```

### UAT-6: NO HUGE JUMPS — smooth tracking
```
1. Load two filings with sections of different sizes
2. Slowly scroll Filing A from top to bottom
3. Observe Filing B tracking — it should move smoothly
4. KEY CHECK: No sudden jumps where the panel snaps to a section top
5. KEY CHECK: Content around modified paragraphs aligns precisely
6. KEY CHECK: Scroll through a section with many added paragraphs in the new filing —
   the old panel should track smoothly without jerky behavior
7. Take screenshots at multiple points during the scroll to verify smooth tracking
```

---

## 7. Boundary & Error Conditions

### Boundary Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-B1 | No anchors (completely different content, no matching sections or blocks) | `translatePosition` returns sourceY passthrough — panels scroll independently at 1:1 ratio |
| SS-B2 | One anchor only | Offset translation from the single anchor — scroll difference = anchor offset applied everywhere |
| SS-B3 | Many anchors (100+) | Binary search O(log n) efficiently finds bracket; ~7 comparisons for 100 anchors |
| SS-B4 | Added/removed sections (no match in other panel) | No anchor for that section; position interpolated between surrounding anchors |
| SS-B5 | Preamble area (before first section) | First anchor provides offset for positions before it; if preamble section exists in both panels, it's an anchor |
| SS-B6 | One panel much longer than the other | After-last-anchor offset translation extends naturally; scrollTop may exceed content (browser clamps) |
| SS-B7 | Reordered sections (moved between panels) | Non-monotonic newY values — panel B may jump backwards; correct behavior per content correspondence |
| SS-B8 | Zero-height section (adjacent anchors at same Y) | `srcSpan === 0` guard in `translatePosition` returns first bracket target |
| SS-B9 | Sections load asynchronously (pipeline states) | `measureElements` returns empty map → empty anchors → passthrough; sync starts when content renders |
| SS-B10 | Toggle during active scroll / in-flight rAF | `useEffect` cleanup removes listeners; in-flight rAF fires harmlessly (one extra scrollTop assignment) |
| SS-B11 | Negative computed scrollTop (before-first offset) | Browser clamps `scrollTop` to 0 on assignment |
| SS-B12 | scrollTop exceeds scrollHeight - clientHeight | Browser clamps `scrollTop` to max on assignment |

### Error Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-ERR1 | Both panel refs null (not mounted) | Hook early-returns (`if (!panelA \|\| !panelB \|\| !enabled) return`); no listeners attached |
| SS-ERR2 | One panel ref null | Hook early-returns; no listeners attached |
| SS-ERR3 | Panel unmounted mid-scroll (race condition) | `useEffect` cleanup removes listeners; in-flight rAF may fire but harmlessly sets scrollTop on stale ref |
| SS-ERR4 | Toggle disable during active rAF | `useEffect` cleanup removes listeners; pending rAF callback fires once (harmless) |
| SS-ERR5 | No `data-block-key` elements (feature not injected yet) | `measureElements` only finds sections → section-level anchors still work |
| SS-ERR6 | Rapid scroll producing many rAF callbacks | `cancelAnimationFrame` discards stale frames; at most one rAF executes per scroll burst |
| SS-ERR7 | `getBoundingClientRect` returns zero for elements (collapsed/hidden) | Anchors at Y=0 are valid; degenerate srcSpan handled by guard |

---

## 8. Performance Criteria

| Criterion | Target | How to Verify |
|-----------|--------|---------------|
| Scroll handler latency | < 16ms (one frame budget) | rAF debouncing ensures at most one handler per frame |
| Anchor map build cost | < 1ms for ~120 elements | `querySelectorAll` + `getBoundingClientRect` batched; no reflow |
| Binary search efficiency | O(log n) per scroll event | ~7 comparisons for 120 anchors; verified by SS-TP10 |
| No dropped frames | 0 during normal sync | Chrome DevTools Performance panel; UAT-6 visual check |
| rAF debouncing | One pending rAF per panel | `cancelAnimationFrame` on stale frames; verified by SS-U7 |
| No forced reflows | All reads before write | `getBoundingClientRect` reads before single `scrollTop` write |
| Loop prevention | Single boolean flag | `isProgrammaticScrollRef` checked BEFORE rAF; verified by SS-U5 |
| `newToOld` re-sort | < 0.1ms | Copy + sort of ~120 anchors; negligible |
| Memory | No leaks | SS-U3 verifies cleanup of scroll listeners on unmount |

---

## 9. Test Data & Fixtures

### Container Factory (v3 — with anchor support)

```typescript
function makeContainer(
  sections: string[],
  blocks: Array<{ key: string; top: number }> = [],
): HTMLDivElement {
  const container = document.createElement('div');
  let top = 0;

  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });

  for (const id of sections) {
    const section = document.createElement('section');
    section.id = id;
    const sectionTop = top;
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
      top: sectionTop, left: 0, right: 800, bottom: sectionTop + 500,
      width: 800, height: 500, x: 0, y: sectionTop, toJSON: () => {},
    });
    container.appendChild(section);
    top += 500;
  }

  for (const { key, top: blockTop } of blocks) {
    const el = document.createElement('p');
    el.dataset.blockKey = key;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: blockTop, left: 0, right: 800, bottom: blockTop + 20,
      width: 800, height: 20, x: 0, y: blockTop, toJSON: () => {},
    });
    container.appendChild(el);
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

- **Two panels, matching sections**: `makeContainer(['s1', 's2', 's3'])` x2
- **Panels with blocks**: `makeContainer(['s1'], [{ key: 's1:pd:0', top: 100 }])` x2
- **Empty panels**: `makeContainer([])` (no section or block children)
- **Single section**: `makeContainer(['s1'])` x2
- **Many sections**: `makeContainer(Array.from({length: 25}, (_, i) => 's' + (i+1)))` x2
- **Mismatched sections**: A = `['s1', 's2', 's3']`, B = `['s1', 's3']`
- **Anchor arrays for pure function tests**:
  - Empty: `[]`
  - Single: `[{ oldY: 100, newY: 200 }]`
  - Two anchors: `[{ oldY: 0, newY: 0 }, { oldY: 1000, newY: 500 }]`
  - Many: `Array.from({ length: 50 }, (_, i) => ({ oldY: i*100, newY: i*120 }))`

---

## Test ID Index

| ID | Type | Description |
|----|------|-------------|
| SS-CA1 | Pure fn | `computeAnchors` — empty maps → empty anchors |
| SS-CA2 | Pure fn | `computeAnchors` — no matching keys → empty anchors |
| SS-CA3 | Pure fn | `computeAnchors` — all keys match → sorted anchors |
| SS-CA4 | Pure fn | `computeAnchors` — partial matches → only matched |
| SS-CA5 | Pure fn | `computeAnchors` — unsorted input → sorted output |
| SS-CA6 | Pure fn | `computeAnchors` — duplicate oldY values |
| SS-CA7 | Pure fn | `computeAnchors` — 100+ matching keys |
| SS-TP1 | Pure fn | `translatePosition` — empty anchors → passthrough |
| SS-TP2 | Pure fn | `translatePosition` — single anchor → offset |
| SS-TP3 | Pure fn | `translatePosition` — before first → offset from first |
| SS-TP4 | Pure fn | `translatePosition` — after last → offset from last |
| SS-TP5 | Pure fn | `translatePosition` — between anchors → interpolation |
| SS-TP6 | Pure fn | `translatePosition` — exact match on anchor |
| SS-TP7 | Pure fn | `translatePosition` — duplicate oldY at start (before-first) |
| SS-TP8 | Pure fn | `translatePosition` — oldToNew direction |
| SS-TP9 | Pure fn | `translatePosition` — newToOld direction |
| SS-TP10 | Pure fn | `translatePosition` — 50 anchors binary search |
| SS-TP11 | Pure fn | `translatePosition` — sourceY=0 at first anchor=0 |
| SS-TP12 | Pure fn | `translatePosition` — 25% interpolation |
| SS-TP13 | Pure fn | `translatePosition` — non-monotonic newY |
| SS-ME1 | Pure fn | `measureElements` — sections → keyed positions |
| SS-ME2 | Pure fn | `measureElements` — block-key elements → positions |
| SS-ME3 | Pure fn | `measureElements` — empty panel → empty map |
| SS-ME4 | Pure fn | `measureElements` — mixed sections and blocks |
| SS-ME5 | Pure fn | `measureElements` — scrolled panel absolute Y |
| SS-ME6 | Pure fn | `measureElements` — ignores sections without id |
| SS-IB1 | Pure fn | `injectBlockKey` — normal tag → attribute inserted |
| SS-IB2 | Pure fn | `injectBlockKey` — element with content |
| SS-IB3 | Pure fn | `injectBlockKey` — self-closing tag |
| SS-IB4 | Pure fn | `injectBlockKey` — raw text → span wrapper |
| SS-IB5 | Pure fn | `injectBlockKey` — no closing > → unchanged |
| SS-IB6 | Pure fn | `injectBlockKey` — tag with existing attributes |
| SS-IB7 | Pure fn | `injectBlockKey` — leading whitespace |
| SS-IB8 | Pure fn | `injectBlockKey` — whitespace + no tag → span |
| SS-IB9 | Pure fn | `injectBlockKey` — table element |
| SS-U1 | Unit | Attaches scroll listeners with `{ passive: true }` when enabled |
| SS-U2 | Unit | Does not attach listeners when disabled |
| SS-U3 | Unit | Removes listeners on unmount |
| SS-U4 | Unit | Scroll sets scrollTop on other panel (NOT scrollIntoView) |
| SS-U5 | Unit | Prevents infinite scroll loop via isProgrammaticScrollRef |
| SS-U6 | Unit | Uses requestAnimationFrame for debouncing |
| SS-U7 | Unit | Coalesces rapid scroll events via cancelAnimationFrame |
| SS-U8 | Unit | Handles null refs (early return) |
| SS-U9 | Unit | Toggle removes/adds listeners dynamically |
| SS-U10 | Unit | No sections/blocks — passthrough sync |
| SS-U11 | Unit | Elements queried fresh on each scroll (dynamic DOM) |
| SS-H1 | Unit | Header renders toggle with aria-pressed=true |
| SS-H2 | Unit | Header renders toggle with aria-pressed=false |
| SS-H3 | Unit | Header toggle click calls onSyncToggle |
| SS-H4 | Unit | Header omits toggle when props not provided |
| SS-I1 | Integration | App renders Header with sync toggle |
| SS-I2 | Integration | Highlight injector produces data-block-key |
| SS-I2b | Integration | No-highlight modified paragraph still gets data-block-key |
| SS-I3 | Integration | Two annotated panels sync via anchor map |
| SS-I4 | Integration | Toggle disables/enables sync |
| SS-I5 | Integration | Sync works with dynamically rendered sections |
| UAT-1 | UAT | Toggle visibility |
| UAT-2 | UAT | Content alignment at modified paragraphs |
| UAT-3 | UAT | Toggle disables sync |
| UAT-4 | UAT | Toggle re-enables sync |
| UAT-5 | UAT | Bidirectional sync |
| UAT-6 | UAT | No huge jumps — smooth tracking |
| SS-B1–B12 | Boundary | Edge cases (empty, single, many, preamble, reorder, clamp) |
| SS-ERR1–ERR7 | Error | Error conditions (null refs, unmount, toggle race, no blocks) |
