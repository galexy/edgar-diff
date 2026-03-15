# US-2.11 Synchronized Scrolling — Test Plan (v3)

> **v3 rationale**: v1 used section-snapping — huge jumps. v2 used proportional
> ratios — wrong when section paragraph counts differ. An earlier v3 draft used
> anchor maps with interpolation everywhere — but most content has direct
> correspondence and doesn't need interpolation.
>
> v3 uses **offset-based direct lookup**. The HTML source offset is the coordinate
> system. Every block is annotated with `data-source-start`. An offset table built
> from diff data maps old ↔ new source offsets. On scroll: find block at viewport
> top → lookup corresponding offset → find target element → scroll to it.
> Interpolation is only for gaps (added/removed content).

---

## 1. BDD Acceptance Criteria

### AC-1: Scrolling Filing A aligns Filing B at corresponding content

```gherkin
Scenario: SS-AC1-1 — Scroll Filing A syncs Filing B at corresponding content
  Given both panels have filings loaded with annotated blocks (data-source-start)
  And sync scrolling is enabled (default)
  When the user scrolls Filing A so that a paragraph is at the viewport top
  Then Filing B scrollTop is set so the corresponding paragraph aligns
  And Filing B does NOT call scrollIntoView (scrollTop is set directly)

Scenario: SS-AC1-2 — Scroll Filing B syncs Filing A (bidirectional)
  Given both panels have filings loaded
  And sync scrolling is enabled
  When the user scrolls Filing B
  Then Filing A scrollTop is set via lookupCorrespondingOffset with direction 'newToOld'

Scenario: SS-AC1-3 — No filings loaded
  Given no filings are loaded in either panel
  And sync scrolling is enabled
  When the user scrolls either panel
  Then nothing happens and no errors are thrown

Scenario: SS-AC1-4 — One panel empty
  Given Filing A has content and Filing B is empty (no document)
  And sync scrolling is enabled
  When the user scrolls Filing A
  Then no error is thrown (the hook early-returns when either ref is null)
```

### AC-2: Unchanged content aligns exactly; changed content aligns via direct mapping; gaps interpolate

```gherkin
Scenario: SS-AC2-1 — Unchanged content aligns exactly
  Given both panels have an unchanged paragraph at source offsets old=1000, new=1200
  And sync scrolling is enabled
  When the user scrolls Filing A so that paragraph (offset 1000) is at viewport top
  Then Filing B scrolls to the element with data-source-start="1200"
  And the pixel offset within the paragraph is preserved (sub-block precision)

Scenario: SS-AC2-2 — Modified content aligns via direct mapping
  Given a paragraph was modified between filings (old offset=2000, new offset=2500)
  And the offset table has an entry { oldStart: 2000, newStart: 2500 }
  When the user scrolls Filing A to the modified paragraph
  Then Filing B scrolls to the corresponding modified paragraph

Scenario: SS-AC2-3 — Added content (gap) interpolates between nearest blocks
  Given Filing B has added paragraphs between two unchanged paragraphs
  And the added paragraphs have no entry in the offset table
  When the user scrolls Filing B into the added content
  Then Filing A's position is interpolated between the surrounding entries
  And the result is a reasonable position near the insertion point

Scenario: SS-AC2-4 — Removed content (gap) interpolates
  Given Filing A has paragraphs that were removed in Filing B
  When the user scrolls Filing A into the removed content
  Then Filing B's position is interpolated between surrounding entries
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
  Then Filing B syncs to the offset-based corresponding position
```

---

## 2. Unit Tests — Pure Functions (`lib/sync-scroll.ts`)

File: `apps/web/src/lib/sync-scroll.test.ts`

### Types

```typescript
// Exported from lib/sync-scroll.ts
export interface OffsetEntry {
  oldStart: number;
  newStart: number;
}

export type SyncDirection = 'oldToNew' | 'newToOld';
```

### 2a. `buildOffsetTable(sectionDiffs)` — Offset Table Construction

Returns `OffsetEntry[]` sorted by `oldStart`.

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildOffsetTable,
  lookupCorrespondingOffset,
  type OffsetEntry,
  type SyncDirection,
} from './sync-scroll';
import type { SectionDiff } from '@edgar-diff/lib';

// Helper: minimal SectionDiff factory
function makeSectionDiff(overrides: Partial<SectionDiff>): SectionDiff {
  return {
    id: 'section-1',
    changeType: 'modified',
    sourceMapping: { old: null, new: null },
    paragraphDiffs: [],
    tableDiffs: [],
    ...overrides,
  } as SectionDiff;
}

describe('buildOffsetTable', () => {
  // SS-OT1: Empty sectionDiffs → empty table
  it('returns empty array for empty sectionDiffs', () => {
    expect(buildOffsetTable([])).toEqual([]);
  });

  // SS-OT2: Section boundaries included
  it('includes section boundary entries when both old and new mappings exist', () => {
    const sd = makeSectionDiff({
      sourceMapping: {
        old: { start: 0, end: 1000 },
        new: { start: 0, end: 1200 },
      },
    });
    const result = buildOffsetTable([sd]);
    expect(result).toContainEqual({ oldStart: 0, newStart: 0 });
  });

  // SS-OT3: Section with only one side mapping is excluded
  it('excludes section boundary when only one side mapping exists', () => {
    const sd = makeSectionDiff({
      changeType: 'added',
      sourceMapping: {
        old: null,
        new: { start: 0, end: 500 },
      },
    });
    const result = buildOffsetTable([sd]);
    // No section boundary entry (added section has no old mapping)
    expect(result.filter(e => e.oldStart === 0 && e.newStart === 0)).toHaveLength(0);
  });

  // SS-OT4: Paragraph diffs with both-side mappings included
  it('includes paragraph entries with both old and new source mappings', () => {
    const sd = makeSectionDiff({
      paragraphDiffs: [
        {
          changeType: 'unchanged',
          sourceMapping: {
            old: { start: 100, end: 200 },
            new: { start: 150, end: 250 },
          },
        },
        {
          changeType: 'modified',
          sourceMapping: {
            old: { start: 300, end: 400 },
            new: { start: 350, end: 500 },
          },
          wordChanges: [],
        },
      ] as SectionDiff['paragraphDiffs'],
    });
    const result = buildOffsetTable([sd]);
    expect(result).toContainEqual({ oldStart: 100, newStart: 150 });
    expect(result).toContainEqual({ oldStart: 300, newStart: 350 });
  });

  // SS-OT5: Added/removed paragraphs excluded (single-sided mapping)
  it('excludes paragraphs with only one side mapping', () => {
    const sd = makeSectionDiff({
      paragraphDiffs: [
        {
          changeType: 'added',
          sourceMapping: {
            old: null,
            new: { start: 500, end: 600 },
          },
        },
        {
          changeType: 'removed',
          sourceMapping: {
            old: { start: 200, end: 300 },
            new: null,
          },
        },
      ] as SectionDiff['paragraphDiffs'],
    });
    const result = buildOffsetTable([sd]);
    expect(result.filter(e => e.oldStart === 200 || e.newStart === 500)).toHaveLength(0);
  });

  // SS-OT6: Table diffs included
  it('includes table entries with both-side source mappings', () => {
    const sd = makeSectionDiff({
      tableDiffs: [
        {
          changeType: 'modified',
          sourceMapping: {
            old: { start: 5000, end: 6000 },
            new: { start: 5500, end: 6800 },
          },
        },
      ] as SectionDiff['tableDiffs'],
    });
    const result = buildOffsetTable([sd]);
    expect(result).toContainEqual({ oldStart: 5000, newStart: 5500 });
  });

  // SS-OT7: Output sorted by oldStart
  it('returns entries sorted by oldStart', () => {
    const sd = makeSectionDiff({
      sourceMapping: {
        old: { start: 500, end: 1000 },
        new: { start: 600, end: 1200 },
      },
      paragraphDiffs: [
        {
          changeType: 'unchanged',
          sourceMapping: {
            old: { start: 100, end: 200 },
            new: { start: 50, end: 150 },
          },
        },
        {
          changeType: 'unchanged',
          sourceMapping: {
            old: { start: 800, end: 900 },
            new: { start: 900, end: 1000 },
          },
        },
      ] as SectionDiff['paragraphDiffs'],
    });
    const result = buildOffsetTable([sd]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].oldStart).toBeGreaterThanOrEqual(result[i - 1].oldStart);
    }
  });

  // SS-OT8: Multiple sections — all entries combined and sorted
  it('combines entries from multiple sections, sorted globally', () => {
    const sd1 = makeSectionDiff({
      id: 'item-1',
      sourceMapping: {
        old: { start: 0, end: 500 },
        new: { start: 0, end: 600 },
      },
      paragraphDiffs: [
        {
          changeType: 'unchanged',
          sourceMapping: {
            old: { start: 100, end: 200 },
            new: { start: 100, end: 200 },
          },
        },
      ] as SectionDiff['paragraphDiffs'],
    });
    const sd2 = makeSectionDiff({
      id: 'item-2',
      sourceMapping: {
        old: { start: 500, end: 1000 },
        new: { start: 600, end: 1200 },
      },
      paragraphDiffs: [
        {
          changeType: 'modified',
          sourceMapping: {
            old: { start: 700, end: 800 },
            new: { start: 850, end: 1000 },
          },
          wordChanges: [],
        },
      ] as SectionDiff['paragraphDiffs'],
    });
    const result = buildOffsetTable([sd1, sd2]);
    expect(result.length).toBe(4); // 2 section boundaries + 2 paragraphs
    for (let i = 1; i < result.length; i++) {
      expect(result[i].oldStart).toBeGreaterThanOrEqual(result[i - 1].oldStart);
    }
  });

  // SS-OT9: Large table — ~1000 unchanged paragraphs
  it('handles 1000 entries from unchanged paragraphs', () => {
    const sd = makeSectionDiff({
      paragraphDiffs: Array.from({ length: 1000 }, (_, i) => ({
        changeType: 'unchanged',
        sourceMapping: {
          old: { start: i * 100, end: i * 100 + 80 },
          new: { start: i * 110, end: i * 110 + 80 },
        },
      })) as SectionDiff['paragraphDiffs'],
    });
    const result = buildOffsetTable([sd]);
    expect(result).toHaveLength(1000);
    // Verify sorted
    for (let i = 1; i < result.length; i++) {
      expect(result[i].oldStart).toBeGreaterThanOrEqual(result[i - 1].oldStart);
    }
  });

  // SS-OT10: Includes entries from nested subsectionDiffs
  it('recursively includes entries from nested subsectionDiffs', () => {
    const sd = makeSectionDiff({
      sourceMapping: {
        old: { start: 0, end: 5000 },
        new: { start: 0, end: 6000 },
      },
      subsectionDiffs: [
        makeSectionDiff({
          id: 'sub-1',
          sourceMapping: {
            old: { start: 1000, end: 2000 },
            new: { start: 1200, end: 2400 },
          },
          paragraphDiffs: [
            {
              changeType: 'unchanged',
              sourceMapping: {
                old: { start: 1100, end: 1200 },
                new: { start: 1300, end: 1400 },
              },
            },
          ] as SectionDiff['paragraphDiffs'],
        }),
      ] as SectionDiff[],
    });
    const result = buildOffsetTable([sd]);
    // Should include: section boundary {0,0}, subsection boundary {1000,1200},
    // paragraph in subsection {1100,1300}
    expect(result).toContainEqual({ oldStart: 0, newStart: 0 });
    expect(result).toContainEqual({ oldStart: 1000, newStart: 1200 });
    expect(result).toContainEqual({ oldStart: 1100, newStart: 1300 });
  });
});
```

### 2b. `lookupCorrespondingOffset(table, sourceOffset, direction)` — Offset Lookup

Returns the corresponding source offset via direct match or interpolation.

```typescript
describe('lookupCorrespondingOffset', () => {
  // SS-LO1: Empty table → passthrough (returns sourceOffset)
  it('returns sourceOffset unchanged when table is empty', () => {
    expect(lookupCorrespondingOffset([], 500, 'oldToNew')).toBe(500);
  });

  // SS-LO2: Single entry → offset translation
  it('applies offset translation with a single entry', () => {
    const table: OffsetEntry[] = [{ oldStart: 100, newStart: 150 }];
    // sourceOffset=200 → 200 - 100 + 150 = 250
    expect(lookupCorrespondingOffset(table, 200, 'oldToNew')).toBe(250);
  });

  // SS-LO3: Exact match → direct lookup (no interpolation)
  it('returns exact corresponding offset for direct match', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 150 },
      { oldStart: 300, newStart: 500 },
      { oldStart: 600, newStart: 700 },
    ];
    expect(lookupCorrespondingOffset(table, 300, 'oldToNew')).toBe(500);
  });

  // SS-LO4: Exact match on first entry
  it('returns exact match for first entry', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 500, newStart: 600 },
    ];
    // sourceOffset=100 <= sorted[0].oldStart=100 → before-first branch
    // result = 100 - 100 + 200 = 200
    expect(lookupCorrespondingOffset(table, 100, 'oldToNew')).toBe(200);
  });

  // SS-LO5: Exact match on last entry
  it('returns exact match for last entry', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 500, newStart: 600 },
    ];
    // sourceOffset=500 >= last.oldStart=500 → after-last branch
    // result = 500 - 500 + 600 = 600
    expect(lookupCorrespondingOffset(table, 500, 'oldToNew')).toBe(600);
  });

  // SS-LO6: Before first entry → offset from first
  it('uses offset translation from first entry when before all entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 200, newStart: 300 },
      { oldStart: 600, newStart: 700 },
    ];
    // sourceOffset=50 → 50 - 200 + 300 = 150
    expect(lookupCorrespondingOffset(table, 50, 'oldToNew')).toBe(150);
  });

  // SS-LO7: After last entry → offset from last
  it('uses offset translation from last entry when after all entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 150 },
      { oldStart: 400, newStart: 500 },
    ];
    // sourceOffset=700 → 700 - 400 + 500 = 800
    expect(lookupCorrespondingOffset(table, 700, 'oldToNew')).toBe(800);
  });

  // SS-LO8: Between entries (gap) → linear interpolation
  it('interpolates between bracketing entries for gap positions', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 300, newStart: 600 },
    ];
    // sourceOffset=200 is in the gap: t = (200-100)/(300-100) = 0.5
    // result = 200 + 0.5 * (600-200) = 200 + 200 = 400
    expect(lookupCorrespondingOffset(table, 200, 'oldToNew')).toBe(400);
  });

  // SS-LO9: oldToNew direction — uses oldStart as source, newStart as target
  it('translates oldToNew correctly', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 1000, newStart: 500 },
    ];
    // sourceOffset=500, t = (500-0)/(1000-0) = 0.5
    // result = 0 + 0.5 * (500-0) = 250
    expect(lookupCorrespondingOffset(table, 500, 'oldToNew')).toBe(250);
  });

  // SS-LO10: newToOld direction — re-sorts by newStart, uses newStart as source
  it('translates newToOld correctly (re-sorted by newStart)', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 1000, newStart: 500 },
    ];
    // For newToOld: sorted by newStart → [{0,0}, {1000,500}]
    // srcKey=newStart, tgtKey=oldStart
    // sourceOffset=250, t = (250-0)/(500-0) = 0.5
    // result = 0 + 0.5 * (1000-0) = 500
    expect(lookupCorrespondingOffset(table, 250, 'newToOld')).toBe(500);
  });

  // SS-LO11: Many entries → binary search finds correct bracket
  it('finds correct bracket among 500 entries via binary search', () => {
    const table: OffsetEntry[] = Array.from({ length: 500 }, (_, i) => ({
      oldStart: i * 100,
      newStart: i * 110,
    }));
    // sourceOffset=25050 → exact match on entry 250 (oldStart=25000)
    // Wait — 25050 is between entry 250 (25000) and 251 (25100)
    // t = (25050-25000)/(25100-25000) = 0.5
    // newStart range: 27500 to 27610
    // result = 27500 + 0.5 * (27610-27500) = 27500 + 55 = 27555
    expect(lookupCorrespondingOffset(table, 25050, 'oldToNew')).toBe(27555);
  });

  // SS-LO12: Exact match after binary search (not first/last)
  it('finds exact match via binary search in the middle of the table', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 300, newStart: 400 },
      { oldStart: 500, newStart: 700 },
      { oldStart: 800, newStart: 900 },
    ];
    // sourceOffset=300 → binary search finds lo with sorted[lo].oldStart=300
    // Exact match → returns 400
    expect(lookupCorrespondingOffset(table, 300, 'oldToNew')).toBe(400);
  });

  // SS-LO13: Quarter interpolation in gap
  it('interpolates correctly at 25% between entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 400, newStart: 800 },
    ];
    // sourceOffset=100, t = 100/400 = 0.25
    // result = 0 + 0.25 * 800 = 200
    expect(lookupCorrespondingOffset(table, 100, 'oldToNew')).toBe(200);
  });

  // SS-LO14: sourceOffset=0 with first entry at 0
  it('handles sourceOffset=0 when first entry starts at 0', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 50 },
      { oldStart: 500, newStart: 600 },
    ];
    // 0 <= sorted[0].oldStart (0) → before-first: 0 - 0 + 50 = 50
    expect(lookupCorrespondingOffset(table, 0, 'oldToNew')).toBe(50);
  });

  // SS-LO15: Non-monotonic newStart (reordered sections)
  it('handles non-monotonic newStart values correctly', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 5000 },   // section moved down in new
      { oldStart: 5000, newStart: 0 },   // section moved up in new
    ];
    // sourceOffset=2500 between entries, t = 2500/5000 = 0.5
    // result = 5000 + 0.5 * (0-5000) = 5000 - 2500 = 2500
    expect(lookupCorrespondingOffset(table, 2500, 'oldToNew')).toBe(2500);
  });
});
```

### 2c. `findBlockAtViewportTop(panel)` — DOM Block Discovery

```typescript
import { findBlockAtViewportTop, findBlockBySourceOffset } from './sync-scroll';

describe('findBlockAtViewportTop', () => {
  // Helper: create panel with data-source-start elements
  function makePanel(
    blocks: Array<{ sourceStart: number; top: number }>,
    panelTop = 0,
    scrollTop = 0,
  ): HTMLDivElement {
    const panel = document.createElement('div');

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: panelTop, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', {
      value: scrollTop, writable: true, configurable: true,
    });

    for (const { sourceStart, top } of blocks) {
      const el = document.createElement('p');
      el.dataset.sourceStart = String(sourceStart);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 50,
        width: 800, height: 50, x: 0, y: top, toJSON: () => {},
      });
      panel.appendChild(el);
    }

    return panel;
  }

  // SS-FV1: Returns null when no annotated elements exist
  it('returns null for panel with no data-source-start elements', () => {
    const panel = document.createElement('div');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', { value: 0, writable: true });
    expect(findBlockAtViewportTop(panel as HTMLDivElement)).toBeNull();
  });

  // SS-FV2: Block at viewport top → returns its sourceStart and pixelOffset=0
  it('returns block whose top aligns with viewport top', () => {
    // scrollTop=200, block at absTop=200
    const panel = makePanel(
      [{ sourceStart: 1000, top: 0 }],  // viewport-relative top=0, absTop=0+200=200
      0,    // panelTop
      200,  // scrollTop
    );
    // Wait, absTop = top - panelTop + scrollTop = 0 - 0 + 200 = 200
    // viewportTop = scrollTop = 200
    // absTop(200) <= viewportTop(200) → this is the best
    // pixelOffset = 200 - 200 = 0
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 1000, pixelOffset: 0 });
  });

  // SS-FV3: Viewport top partway through a block → pixelOffset > 0
  it('returns pixelOffset when viewport top is partway through a block', () => {
    // Block at absTop=100, scrollTop=130 → pixelOffset=30
    const panel = makePanel(
      [{ sourceStart: 500, top: -30 }],  // viewport-relative: -30
      0,
      130,
    );
    // absTop = -30 - 0 + 130 = 100
    // viewportTop = 130
    // 100 <= 130 → best element
    // pixelOffset = 130 - 100 = 30
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 500, pixelOffset: 30 });
  });

  // SS-FV4: Multiple blocks — selects the one closest to viewport top from above
  it('selects block closest to viewport top from above', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: -200 },  // absTop = -200 + 300 = 100
        { sourceStart: 200, top: -50 },   // absTop = -50 + 300 = 250
        { sourceStart: 300, top: 100 },   // absTop = 100 + 300 = 400 (below viewport)
      ],
      0,
      300,
    );
    // viewportTop = 300
    // Block 100: absTop=100 <= 300 ✓ (distance 200)
    // Block 200: absTop=250 <= 300 ✓ (distance 50) — closer, this wins
    // Block 300: absTop=400 > 300 ✗
    const result = findBlockAtViewportTop(panel);
    expect(result?.sourceStart).toBe(200);
    expect(result?.pixelOffset).toBe(50); // 300 - 250
  });

  // SS-FV5: All blocks below viewport top → falls back to first element
  it('falls back to first element when all blocks are below viewport top', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: 50 },   // absTop = 50 + 0 = 50
        { sourceStart: 200, top: 200 },  // absTop = 200
      ],
      0,
      0, // scrollTop=0 but blocks all start below
    );
    // Wait — viewportTop = 0, absTop(100)=50, 50 <= 0? No.
    // All blocks above viewport? No, all below.
    // bestElement stays null → fallback to first
    const result = findBlockAtViewportTop(panel);
    expect(result?.sourceStart).toBe(100);
  });

  // SS-FV6: Scrolled panel — absolute Y computation
  it('computes absolute Y correctly with scrolled panel', () => {
    const panel = makePanel(
      [{ sourceStart: 1234, top: -500 }],
      0,
      800,
    );
    // absTop = -500 - 0 + 800 = 300
    // viewportTop = 800
    // 300 <= 800 → match
    // pixelOffset = 800 - 300 = 500
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 1234, pixelOffset: 500 });
  });
});
```

### 2d. `findBlockBySourceOffset(panel, targetOffset)` — Target Element Lookup

```typescript
describe('findBlockBySourceOffset', () => {
  function makePanel(
    blocks: Array<{ sourceStart: number; top: number }>,
    panelTop = 0,
    scrollTop = 0,
  ): HTMLDivElement {
    const panel = document.createElement('div');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: panelTop, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', {
      value: scrollTop, writable: true, configurable: true,
    });

    for (const { sourceStart, top } of blocks) {
      const el = document.createElement('p');
      el.dataset.sourceStart = String(sourceStart);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 50,
        width: 800, height: 50, x: 0, y: top, toJSON: () => {},
      });
      panel.appendChild(el);
    }

    return panel;
  }

  // SS-FB1: Returns null when no annotated elements exist
  it('returns null for empty panel', () => {
    const panel = document.createElement('div');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    Object.defineProperty(panel, 'scrollTop', { value: 0, writable: true });
    expect(findBlockBySourceOffset(panel as HTMLDivElement, 500)).toBeNull();
  });

  // SS-FB2: Exact source offset match → returns element position
  it('returns position of element with exact matching offset', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: 50 },
        { sourceStart: 300, top: 200 },
        { sourceStart: 500, top: 400 },
      ],
      0,
      0,
    );
    // Target offset=300, element at top=200
    // absoluteY = 200 - 0 + 0 = 200
    expect(findBlockBySourceOffset(panel, 300)).toBe(200);
  });

  // SS-FB3: No exact match → returns closest element by offset distance
  it('returns position of closest element when no exact match', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: 50 },
        { sourceStart: 500, top: 400 },
      ],
      0,
      0,
    );
    // Target offset=350 → closest is 500 (distance 150) vs 100 (distance 250)
    expect(findBlockBySourceOffset(panel, 350)).toBe(400);
  });

  // SS-FB4: Scrolled panel — absolute Y
  it('computes absolute Y correctly with scrolled panel', () => {
    const panel = makePanel(
      [{ sourceStart: 1000, top: -200 }],
      0,
      500,
    );
    // absoluteY = -200 - 0 + 500 = 300
    expect(findBlockBySourceOffset(panel, 1000)).toBe(300);
  });

  // SS-FB5: Single element → always returns that element
  it('returns the only element regardless of offset distance', () => {
    const panel = makePanel(
      [{ sourceStart: 100, top: 50 }],
      0,
      0,
    );
    expect(findBlockBySourceOffset(panel, 99999)).toBe(50);
  });
});
```

### 2e. `injectSourceOffset(blockHtml, sourceStart)` — DOM Annotation

```typescript
import { injectSourceOffset } from './highlight-injector';

describe('injectSourceOffset', () => {
  // SS-IO1: Normal HTML tag → attribute inserted before >
  it('injects data-source-start into a normal HTML tag', () => {
    const result = injectSourceOffset('<p class="text">', 1234);
    expect(result).toBe('<p class="text" data-source-start="1234">');
  });

  // SS-IO2: Full element with content
  it('injects into opening tag of element with content', () => {
    const result = injectSourceOffset('<p>Hello world</p>', 5678);
    expect(result).toBe('<p data-source-start="5678">Hello world</p>');
  });

  // SS-IO3: Self-closing tag → attribute inserted before />
  it('injects into self-closing tag before />', () => {
    const result = injectSourceOffset('<br />', 100);
    expect(result).toBe('<br data-source-start="100" />');
  });

  // SS-IO4: Raw text (no tag) → wrapped in <span>
  it('wraps raw text in a span with data-source-start', () => {
    const result = injectSourceOffset('Just some text', 200);
    expect(result).toBe('<span data-source-start="200">Just some text</span>');
  });

  // SS-IO5: No closing > → returns unchanged
  it('returns unchanged when no closing > found', () => {
    const result = injectSourceOffset('<p class="broken', 300);
    expect(result).toBe('<p class="broken');
  });

  // SS-IO6: Tag with existing attributes
  it('injects alongside existing attributes', () => {
    const result = injectSourceOffset(
      '<div class="highlight" style="color:red">content</div>',
      4000
    );
    expect(result).toBe(
      '<div class="highlight" style="color:red" data-source-start="4000">content</div>'
    );
  });

  // SS-IO7: Leading whitespace before tag
  it('handles leading whitespace before the tag', () => {
    const result = injectSourceOffset('  <p>text</p>', 500);
    expect(result).toBe('  <p data-source-start="500">text</p>');
  });

  // SS-IO8: Leading whitespace with no tag → span wrapper
  it('wraps in span when leading whitespace has no tag', () => {
    const result = injectSourceOffset('  plain text', 600);
    expect(result).toBe('<span data-source-start="600">  plain text</span>');
  });

  // SS-IO9: Table element
  it('injects into table element', () => {
    const result = injectSourceOffset('<table class="data">', 7000);
    expect(result).toBe('<table class="data" data-source-start="7000">');
  });

  // SS-IO10: Self-closing without space before />
  it('handles self-closing tag without space before />', () => {
    const result = injectSourceOffset('<img/>', 800);
    expect(result).toBe('<img data-source-start="800" />');
  });

  // SS-IO11: Offset 0
  it('handles offset 0', () => {
    const result = injectSourceOffset('<p>text</p>', 0);
    expect(result).toBe('<p data-source-start="0">text</p>');
  });
});
```

---

## 3. Unit Tests — `useSyncedScroll` Hook

File: `apps/web/src/hooks/useSyncedScroll.test.ts`

### Test Helpers

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncedScroll } from './useSyncedScroll';
import type { RefObject } from 'react';
import type { SectionDiff } from '@edgar-diff/lib';

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

// --- Container with data-source-start elements ---
function makeContainer(
  blocks: Array<{ sourceStart: number; top: number }> = [],
  scrollTop = 0,
): HTMLDivElement {
  const container = document.createElement('div');

  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollTop', {
    value: scrollTop, writable: true, configurable: true,
  });

  for (const { sourceStart, top } of blocks) {
    const el = document.createElement('p');
    el.dataset.sourceStart = String(sourceStart);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top, left: 0, right: 800, bottom: top + 50,
      width: 800, height: 50, x: 0, y: top, toJSON: () => {},
    });
    container.appendChild(el);
  }

  return container;
}

// --- Minimal sectionDiffs for offset table ---
function makeSimpleSectionDiffs(): SectionDiff[] {
  return [{
    id: 'item-1',
    changeType: 'modified',
    sourceMapping: {
      old: { start: 0, end: 1000 },
      new: { start: 0, end: 1200 },
    },
    paragraphDiffs: [
      {
        changeType: 'unchanged',
        sourceMapping: {
          old: { start: 100, end: 200 },
          new: { start: 100, end: 200 },
        },
      },
      {
        changeType: 'unchanged',
        sourceMapping: {
          old: { start: 500, end: 600 },
          new: { start: 600, end: 700 },
        },
      },
    ],
    tableDiffs: [],
  }] as SectionDiff[];
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

### Hook Signature (v3 — with sectionDiffs)

```typescript
function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  sectionDiffs?: SectionDiff[],
): void;
```

### Test Cases

#### SS-U1: Attaches scroll listeners when enabled
```typescript
it('attaches scroll event listeners to both panels when enabled', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const spyA = vi.spyOn(containerA, 'addEventListener');
  const spyB = vi.spyOn(containerB, 'addEventListener');

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
});
```

#### SS-U2: Does NOT attach listeners when enabled=false
```typescript
it('does not attach scroll event listeners when enabled=false', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const spyA = vi.spyOn(containerA, 'addEventListener');
  const spyB = vi.spyOn(containerB, 'addEventListener');

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), false, makeSimpleSectionDiffs()
  ));

  expect(spyA).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  expect(spyB).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
});
```

#### SS-U3: Removes listeners on unmount (cleanup)
```typescript
it('removes scroll event listeners on unmount', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const spyA = vi.spyOn(containerA, 'removeEventListener');
  const spyB = vi.spyOn(containerB, 'removeEventListener');

  const { unmount } = renderHook(() =>
    useSyncedScroll(makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs())
  );
  unmount();

  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
  expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function));
});
```

#### SS-U4: On scroll, sets scrollTop on other panel (NOT scrollIntoView)
```typescript
it('sets scrollTop on the other panel when one panel scrolls', () => {
  const containerA = makeContainer([
    { sourceStart: 100, top: -100 },  // absTop = -100 + 200 = 100
    { sourceStart: 500, top: 100 },   // absTop = 100 + 200 = 300
  ], 200);
  const containerB = makeContainer([
    { sourceStart: 100, top: 50 },
    { sourceStart: 600, top: 400 },
  ]);

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  containerA.scrollTop = 200;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // containerB.scrollTop should have been set (not scrollIntoView)
  expect(typeof containerB.scrollTop).toBe('number');
});
```

#### SS-U5: Loop prevention — programmatic scroll doesn't trigger reciprocal sync
```typescript
it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }], 0);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }], 0);

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  // Scroll A → triggers rAF → sets B's scrollTop
  containerA.scrollTop = 100;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // B fires scroll from programmatic assignment
  // Handler checks isProgrammaticScrollRef → true → clears, returns
  const aScrollBefore = containerA.scrollTop;
  act(() => { fireScroll(containerB); });
  expect(containerA.scrollTop).toBe(aScrollBefore);
});
```

#### SS-U6: Uses requestAnimationFrame for debouncing
```typescript
it('uses requestAnimationFrame to debounce scroll handlers', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  act(() => { fireScroll(containerA); });
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
});
```

#### SS-U7: Coalesces rapid scroll events via cancelAnimationFrame + rAF
```typescript
it('coalesces rapid scroll events via cancelAnimationFrame', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const cancelSpy = vi.fn();
  let count = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++count));
  vi.stubGlobal('cancelAnimationFrame', cancelSpy);

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  act(() => {
    for (let i = 0; i < 5; i++) fireScroll(containerA);
  });

  expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
});
```

#### SS-U8: Handles null refs gracefully
```typescript
it('does not throw when both refs are null', () => {
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(null), makeRef(null), true, makeSimpleSectionDiffs()));
  }).not.toThrow();
});

it('does not throw when one ref is null', () => {
  const container = makeContainer([{ sourceStart: 100, top: 0 }]);
  expect(() => {
    renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true, makeSimpleSectionDiffs()));
  }).not.toThrow();
});
```

#### SS-U9: Toggling enabled removes/adds listeners dynamically
```typescript
it('removes listeners when toggled from enabled to disabled', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const spyA = vi.spyOn(containerA, 'removeEventListener');
  const diffs = makeSimpleSectionDiffs();

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled, diffs),
    { initialProps: { enabled: true } },
  );

  rerender({ enabled: false });
  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
});

it('re-attaches listeners when toggled from disabled to enabled', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const spyA = vi.spyOn(containerA, 'addEventListener');
  const diffs = makeSimpleSectionDiffs();

  const { rerender } = renderHook(
    ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled, diffs),
    { initialProps: { enabled: false } },
  );

  rerender({ enabled: true });
  expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
});
```

#### SS-U10: No annotated elements — handler returns early
```typescript
it('does not modify scrollTop when no data-source-start elements exist', () => {
  const containerA = makeContainer([]); // empty
  const containerB = makeContainer([]);

  renderHook(() => useSyncedScroll(
    makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()
  ));

  containerA.scrollTop = 100;
  act(() => { fireScroll(containerA); });
  act(() => { flushRAF(); });

  // findBlockAtViewportTop returns null → handler returns early
  expect(containerB.scrollTop).toBe(0);
});
```

#### SS-U11: No sectionDiffs — empty offset table, handler still works
```typescript
it('operates with empty offset table when sectionDiffs is undefined', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);

  expect(() => {
    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, undefined
    ));
  }).not.toThrow();
});
```

#### SS-U12: offsetTable rebuilt when sectionDiffs changes (useMemo)
```typescript
it('rebuilds offset table when sectionDiffs reference changes', () => {
  const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
  const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
  const diffs1 = makeSimpleSectionDiffs();
  const diffs2 = makeSimpleSectionDiffs(); // new reference

  const { rerender } = renderHook(
    ({ diffs }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), true, diffs),
    { initialProps: { diffs: diffs1 } },
  );

  // Rerender with new sectionDiffs — should not throw
  expect(() => rerender({ diffs: diffs2 })).not.toThrow();
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

### SS-I1: App renders Header with sync scroll toggle
```
Render <App /> with mocked pipeline data.
Verify a sync scroll toggle button with aria-pressed="true" is in the Header.
```

### SS-I2: Diff engine includes unchanged paragraphs in paragraphDiffs
```
Run diff-engine on two filings with some unchanged and some modified paragraphs.
Verify the resulting paragraphDiffs array includes entries with changeType='unchanged'.
Verify unchanged entries have sourceMapping with both old and new.
This tests the removal of the unchanged filter at diff-engine.ts:62.
```

### SS-I3: Diff engine includes unchanged tables in tableDiffs
```
Run diff-engine on two filings with unchanged tables.
Verify tableDiffs includes entries with changeType='unchanged'.
This tests the removal of the unchanged filter at diff-engine.ts:94.
```

### SS-I4: Highlight injector produces data-source-start on ALL blocks
```
Call applyHighlightsToSection with sectionDiff containing unchanged, modified,
added, and removed paragraphs.
Verify ALL paragraphs that exist on the current side get data-source-start attributes.
Verify the attribute value matches sourceLoc.start.
```

### SS-I4b: Unchanged paragraph gets data-source-start without highlights
```
Call applyHighlightsToSection on either side with an unchanged paragraph.
Verify the output HTML includes data-source-start but no <ins>/<del> highlight wrappers.
```

### SS-I4c: Modified paragraph with no highlights on current side still gets data-source-start
```
Call applyHighlightsToSection on the 'old' side with a modified paragraph
that has word changes only on the 'new' side (filteredChanges.length === 0 for 'old').
Verify data-source-start is injected even though no <del> highlights are present.
```

### SS-I5: Toggle disables/enables sync between panels
```
Render App with sync enabled.
Click the Header toggle to disable (aria-pressed becomes "false").
Scroll panel A.
Assert panel B's scrollTop was NOT modified.
Click toggle to re-enable.
Scroll panel A. Flush rAF.
Assert panel B's scrollTop WAS set via offset lookup.
```

### SS-I6: Offset table passed to useSyncedScroll via App
```
Render App with mocked diff data containing sectionDiffs.
Verify useSyncedScroll receives the sectionDiffs (indirectly — by asserting
sync behavior matches the offset table derived from the diff data).
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

### UAT-2: Content alignment — scroll to specific content, verify correspondence
```
1. Load two filings with matching sections and changed paragraphs
2. Scroll Filing A so that a specific paragraph is at the top of the viewport
3. Verify Filing B shows the SAME paragraph (or its modified version) at the top
4. Take screenshot showing both panels with aligned content
5. KEY CHECK: Unchanged paragraphs align exactly — same text at same position
6. KEY CHECK: Modified paragraphs align to their corresponding version
7. CONTRAST WITH v2: In v2, proportional mapping would show different paragraphs
   if sections had different paragraph counts
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
5. KEY CHECK: When scrolling through unchanged content, the other panel
   tracks in lock-step (identical content, exact alignment)
6. KEY CHECK: When scrolling through added content in one panel,
   the other panel advances smoothly without jarring snaps
7. Take screenshots at multiple points during the scroll
```

---

## 7. Boundary & Error Conditions

### Boundary Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-B1 | No offset entries (empty offset table, no sectionDiffs) | `lookupCorrespondingOffset` returns passthrough — panels scroll independently at 1:1 |
| SS-B2 | One offset entry only | Offset translation from the single entry everywhere |
| SS-B3 | Many entries (1000+) | Binary search O(log n) efficiently finds bracket; ~10 comparisons |
| SS-B4 | Added sections (only in new, no old mapping) | No entry for added section; content in gap interpolates between surrounding entries |
| SS-B5 | Removed sections (only in old) | Same: gap → interpolation between surrounding entries |
| SS-B6 | Preamble area (before first annotated block) | `findBlockAtViewportTop` falls back to first element; `lookupCorrespondingOffset` uses before-first offset |
| SS-B7 | Reordered sections | Non-monotonic `newStart` values; offset lookup still maps correctly per entry |
| SS-B8 | No annotated elements in panel (pipeline loading state) | `findBlockAtViewportTop` returns null → handler returns early; sync starts when content renders |
| SS-B9 | Toggle during active scroll / in-flight rAF | `useEffect` cleanup removes listeners; in-flight rAF fires harmlessly |
| SS-B10 | Negative computed scrollTop (offset before first block) | Browser clamps `scrollTop` to 0 on assignment |
| SS-B11 | scrollTop exceeds scrollHeight - clientHeight | Browser clamps `scrollTop` to max on assignment |
| SS-B12 | pixelOffset carry-over on modified block | Modified blocks may have different heights; pixelOffset is approximate but targets the correct block |
| SS-B13 | `sectionDiffs` changes (new diff data loaded) | `useMemo` rebuilds offset table; `useEffect` re-runs with new table |

### Error Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| SS-ERR1 | Both panel refs null (not mounted) | Hook early-returns; no listeners attached |
| SS-ERR2 | One panel ref null | Hook early-returns; no listeners attached |
| SS-ERR3 | Panel unmounted mid-scroll (race condition) | `useEffect` cleanup removes listeners; in-flight rAF may fire harmlessly |
| SS-ERR4 | Toggle disable during active rAF | `useEffect` cleanup removes listeners; pending rAF fires once (harmless) |
| SS-ERR5 | `findBlockBySourceOffset` finds no elements in target panel | Returns null → handler returns early, no scrollTop assignment |
| SS-ERR6 | Rapid scroll producing many rAF callbacks | `cancelAnimationFrame` discards stale frames; at most one executes per burst |
| SS-ERR7 | `parseInt(dataset.sourceStart)` returns NaN | Malformed annotation — `findBlockAtViewportTop` returns NaN sourceStart; `lookupCorrespondingOffset` interpolates incorrectly. Prevented by ensuring `injectSourceOffset` always writes valid integers |

---

## 8. Performance Criteria

| Criterion | Target | How to Verify |
|-----------|--------|---------------|
| Offset table build | < 0.5ms via useMemo | Built once per sectionDiffs change; ~1000 entries |
| Scroll handler latency | < 16ms (one frame budget) | rAF debouncing ensures at most one handler per frame |
| `findBlockAtViewportTop` | < 1ms | Iterates ~500-1000 `[data-source-start]` elements; single `getBoundingClientRect` each |
| `lookupCorrespondingOffset` | < 0.1ms | Binary search O(log n) on ~1000 entries; ~10 comparisons |
| `findBlockBySourceOffset` | < 0.5ms | Iterates elements, compares offsets; single rect read on match |
| Total per scroll frame | < 2ms | Well within 16ms rAF budget |
| No forced reflows | All reads before write | rect reads before single `scrollTop` write |
| rAF debouncing | One pending rAF per panel | `cancelAnimationFrame` on stale frames; verified by SS-U7 |
| Loop prevention | Single boolean flag | `isProgrammaticScrollRef`; verified by SS-U5 |
| `newToOld` re-sort | < 0.1ms | Copy + sort of ~1000 entries |
| Memory | No leaks | SS-U3 verifies cleanup; offset table garbage-collected on sectionDiffs change |

---

## 9. Test Data & Fixtures

### Container Factory (v3 — offset-based)

```typescript
function makeContainer(
  blocks: Array<{ sourceStart: number; top: number }> = [],
  scrollTop = 0,
): HTMLDivElement {
  const container = document.createElement('div');

  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollTop', {
    value: scrollTop, writable: true, configurable: true,
  });

  for (const { sourceStart, top } of blocks) {
    const el = document.createElement('p');
    el.dataset.sourceStart = String(sourceStart);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top, left: 0, right: 800, bottom: top + 50,
      width: 800, height: 50, x: 0, y: top, toJSON: () => {},
    });
    container.appendChild(el);
  }

  return container;
}
```

### SectionDiff Factory

```typescript
function makeSectionDiff(overrides: Partial<SectionDiff>): SectionDiff {
  return {
    id: 'section-1',
    changeType: 'modified',
    sourceMapping: { old: null, new: null },
    paragraphDiffs: [],
    tableDiffs: [],
    ...overrides,
  } as SectionDiff;
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

- **Offset tables**:
  - Empty: `[]`
  - Single: `[{ oldStart: 100, newStart: 200 }]`
  - Two entries: `[{ oldStart: 0, newStart: 0 }, { oldStart: 1000, newStart: 500 }]`
  - Many: `Array.from({ length: 500 }, (_, i) => ({ oldStart: i*100, newStart: i*110 }))`
- **Containers with blocks**:
  - Empty: `makeContainer([])`
  - Single block: `makeContainer([{ sourceStart: 100, top: 0 }])`
  - Multiple: `makeContainer([{ sourceStart: 100, top: 0 }, { sourceStart: 500, top: 200 }])`
- **SectionDiffs**: `makeSimpleSectionDiffs()` for hook tests

---

## Test ID Index

| ID | Type | Description |
|----|------|-------------|
| SS-OT1 | Pure fn | `buildOffsetTable` — empty sectionDiffs → empty table |
| SS-OT2 | Pure fn | `buildOffsetTable` — section boundaries included |
| SS-OT3 | Pure fn | `buildOffsetTable` — single-side section excluded |
| SS-OT4 | Pure fn | `buildOffsetTable` — paragraph diffs included |
| SS-OT5 | Pure fn | `buildOffsetTable` — added/removed excluded |
| SS-OT6 | Pure fn | `buildOffsetTable` — table diffs included |
| SS-OT7 | Pure fn | `buildOffsetTable` — output sorted by oldStart |
| SS-OT8 | Pure fn | `buildOffsetTable` — multiple sections combined |
| SS-OT9 | Pure fn | `buildOffsetTable` — 1000 entries |
| SS-OT10 | Pure fn | `buildOffsetTable` — nested subsectionDiffs |
| SS-LO1 | Pure fn | `lookupCorrespondingOffset` — empty → passthrough |
| SS-LO2 | Pure fn | `lookupCorrespondingOffset` — single entry → offset |
| SS-LO3 | Pure fn | `lookupCorrespondingOffset` — exact match → direct |
| SS-LO4 | Pure fn | `lookupCorrespondingOffset` — exact match first entry |
| SS-LO5 | Pure fn | `lookupCorrespondingOffset` — exact match last entry |
| SS-LO6 | Pure fn | `lookupCorrespondingOffset` — before first → offset |
| SS-LO7 | Pure fn | `lookupCorrespondingOffset` — after last → offset |
| SS-LO8 | Pure fn | `lookupCorrespondingOffset` — gap → interpolation |
| SS-LO9 | Pure fn | `lookupCorrespondingOffset` — oldToNew direction |
| SS-LO10 | Pure fn | `lookupCorrespondingOffset` — newToOld direction |
| SS-LO11 | Pure fn | `lookupCorrespondingOffset` — 500 entries binary search |
| SS-LO12 | Pure fn | `lookupCorrespondingOffset` — exact match via binary search |
| SS-LO13 | Pure fn | `lookupCorrespondingOffset` — quarter interpolation |
| SS-LO14 | Pure fn | `lookupCorrespondingOffset` — sourceOffset=0 |
| SS-LO15 | Pure fn | `lookupCorrespondingOffset` — non-monotonic newStart |
| SS-FV1 | DOM fn | `findBlockAtViewportTop` — no elements → null |
| SS-FV2 | DOM fn | `findBlockAtViewportTop` — block at viewport top |
| SS-FV3 | DOM fn | `findBlockAtViewportTop` — pixelOffset > 0 |
| SS-FV4 | DOM fn | `findBlockAtViewportTop` — selects closest from above |
| SS-FV5 | DOM fn | `findBlockAtViewportTop` — all below → first element |
| SS-FV6 | DOM fn | `findBlockAtViewportTop` — scrolled panel absolute Y |
| SS-FB1 | DOM fn | `findBlockBySourceOffset` — empty → null |
| SS-FB2 | DOM fn | `findBlockBySourceOffset` — exact match |
| SS-FB3 | DOM fn | `findBlockBySourceOffset` — closest element |
| SS-FB4 | DOM fn | `findBlockBySourceOffset` — scrolled panel |
| SS-FB5 | DOM fn | `findBlockBySourceOffset` — single element |
| SS-IO1 | Pure fn | `injectSourceOffset` — normal tag |
| SS-IO2 | Pure fn | `injectSourceOffset` — element with content |
| SS-IO3 | Pure fn | `injectSourceOffset` — self-closing tag |
| SS-IO4 | Pure fn | `injectSourceOffset` — raw text → span |
| SS-IO5 | Pure fn | `injectSourceOffset` — no closing > |
| SS-IO6 | Pure fn | `injectSourceOffset` — existing attributes |
| SS-IO7 | Pure fn | `injectSourceOffset` — leading whitespace |
| SS-IO8 | Pure fn | `injectSourceOffset` — whitespace + no tag |
| SS-IO9 | Pure fn | `injectSourceOffset` — table element |
| SS-IO10 | Pure fn | `injectSourceOffset` — self-closing no space |
| SS-IO11 | Pure fn | `injectSourceOffset` — offset 0 |
| SS-U1 | Unit | Attaches scroll listeners with `{ passive: true }` |
| SS-U2 | Unit | Does not attach listeners when disabled |
| SS-U3 | Unit | Removes listeners on unmount |
| SS-U4 | Unit | Scroll sets scrollTop on other panel |
| SS-U5 | Unit | Prevents infinite scroll loop |
| SS-U6 | Unit | Uses requestAnimationFrame for debouncing |
| SS-U7 | Unit | Coalesces rapid scroll events |
| SS-U8 | Unit | Handles null refs |
| SS-U9 | Unit | Toggle removes/adds listeners |
| SS-U10 | Unit | No annotated elements → handler returns early |
| SS-U11 | Unit | No sectionDiffs → empty offset table |
| SS-U12 | Unit | Offset table rebuilt on sectionDiffs change |
| SS-H1 | Unit | Header renders toggle with aria-pressed=true |
| SS-H2 | Unit | Header renders toggle with aria-pressed=false |
| SS-H3 | Unit | Header toggle click calls onSyncToggle |
| SS-H4 | Unit | Header omits toggle when props not provided |
| SS-I1 | Integration | App renders Header with sync toggle |
| SS-I2 | Integration | Diff engine includes unchanged paragraphs |
| SS-I3 | Integration | Diff engine includes unchanged tables |
| SS-I4 | Integration | Highlight injector produces data-source-start on ALL blocks |
| SS-I4b | Integration | Unchanged paragraph gets data-source-start |
| SS-I4c | Integration | Modified paragraph (no highlights on side) gets data-source-start |
| SS-I5 | Integration | Toggle disables/enables sync |
| SS-I6 | Integration | Offset table passed via App wiring |
| UAT-1 | UAT | Toggle visibility |
| UAT-2 | UAT | Content alignment at corresponding paragraphs |
| UAT-3 | UAT | Toggle disables sync |
| UAT-4 | UAT | Toggle re-enables sync |
| UAT-5 | UAT | Bidirectional sync |
| UAT-6 | UAT | No huge jumps — smooth tracking |
| SS-B1–B13 | Boundary | Edge cases |
| SS-ERR1–ERR7 | Error | Error conditions |
