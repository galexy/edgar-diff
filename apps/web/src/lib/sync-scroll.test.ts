import { describe, it, expect, vi } from 'vitest';
import {
  buildOffsetTable,
  lookupCorrespondingOffset,
  findBlockAtViewportTop,
  findBlockBySourceOffset,
  type OffsetEntry,
} from './sync-scroll';
import type { SectionDiff } from '@edgar-diff/lib';

// Helper: minimal SectionDiff factory
function makeSectionDiff(overrides: Partial<SectionDiff>): SectionDiff {
  return {
    id: 'section-1',
    heading: 'Section 1',
    changeType: 'modified',
    sourceMapping: {},
    paragraphDiffs: [],
    tableDiffs: [],
    subsectionDiffs: [],
    ...overrides,
  } as SectionDiff;
}

// ─── 2a. buildOffsetTable ─────────────────────────────────────────

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
        new: { start: 0, end: 500 },
      },
    });
    const result = buildOffsetTable([sd]);
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
            new: { start: 500, end: 600 },
          },
        },
        {
          changeType: 'removed',
          sourceMapping: {
            old: { start: 200, end: 300 },
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
    expect(result).toContainEqual({ oldStart: 0, newStart: 0 });
    expect(result).toContainEqual({ oldStart: 1000, newStart: 1200 });
    expect(result).toContainEqual({ oldStart: 1100, newStart: 1300 });
  });
});

// ─── 2b. lookupCorrespondingOffset ────────────────────────────────

describe('lookupCorrespondingOffset', () => {
  // SS-LO1: Empty table → passthrough
  it('returns sourceOffset unchanged when table is empty', () => {
    expect(lookupCorrespondingOffset([], 500, 'oldToNew')).toBe(500);
  });

  // SS-LO2: Single entry → offset translation
  it('applies offset translation with a single entry', () => {
    const table: OffsetEntry[] = [{ oldStart: 100, newStart: 150 }];
    expect(lookupCorrespondingOffset(table, 200, 'oldToNew')).toBe(250);
  });

  // SS-LO3: Exact match → direct lookup
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
    expect(lookupCorrespondingOffset(table, 100, 'oldToNew')).toBe(200);
  });

  // SS-LO5: Exact match on last entry
  it('returns exact match for last entry', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 500, newStart: 600 },
    ];
    expect(lookupCorrespondingOffset(table, 500, 'oldToNew')).toBe(600);
  });

  // SS-LO6: Before first entry → offset from first
  it('uses offset translation from first entry when before all entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 200, newStart: 300 },
      { oldStart: 600, newStart: 700 },
    ];
    expect(lookupCorrespondingOffset(table, 50, 'oldToNew')).toBe(150);
  });

  // SS-LO7: After last entry → offset from last
  it('uses offset translation from last entry when after all entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 150 },
      { oldStart: 400, newStart: 500 },
    ];
    expect(lookupCorrespondingOffset(table, 700, 'oldToNew')).toBe(800);
  });

  // SS-LO8: Between entries (gap) → linear interpolation
  it('interpolates between bracketing entries for gap positions', () => {
    const table: OffsetEntry[] = [
      { oldStart: 100, newStart: 200 },
      { oldStart: 300, newStart: 600 },
    ];
    expect(lookupCorrespondingOffset(table, 200, 'oldToNew')).toBe(400);
  });

  // SS-LO9: oldToNew direction
  it('translates oldToNew correctly', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 1000, newStart: 500 },
    ];
    expect(lookupCorrespondingOffset(table, 500, 'oldToNew')).toBe(250);
  });

  // SS-LO10: newToOld direction
  it('translates newToOld correctly (re-sorted by newStart)', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 1000, newStart: 500 },
    ];
    expect(lookupCorrespondingOffset(table, 250, 'newToOld')).toBe(500);
  });

  // SS-LO11: Many entries → binary search
  it('finds correct bracket among 500 entries via binary search', () => {
    const table: OffsetEntry[] = Array.from({ length: 500 }, (_, i) => ({
      oldStart: i * 100,
      newStart: i * 110,
    }));
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
    expect(lookupCorrespondingOffset(table, 300, 'oldToNew')).toBe(400);
  });

  // SS-LO13: Quarter interpolation in gap
  it('interpolates correctly at 25% between entries', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 0 },
      { oldStart: 400, newStart: 800 },
    ];
    expect(lookupCorrespondingOffset(table, 100, 'oldToNew')).toBe(200);
  });

  // SS-LO14: sourceOffset=0 with first entry at 0
  it('handles sourceOffset=0 when first entry starts at 0', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 50 },
      { oldStart: 500, newStart: 600 },
    ];
    expect(lookupCorrespondingOffset(table, 0, 'oldToNew')).toBe(50);
  });

  // SS-LO15: Non-monotonic newStart (reordered sections)
  it('handles non-monotonic newStart values correctly', () => {
    const table: OffsetEntry[] = [
      { oldStart: 0, newStart: 5000 },
      { oldStart: 5000, newStart: 0 },
    ];
    expect(lookupCorrespondingOffset(table, 2500, 'oldToNew')).toBe(2500);
  });
});

// ─── 2c. findBlockAtViewportTop ───────────────────────────────────

describe('findBlockAtViewportTop', () => {
  function makePanel(
    blocks: Array<{ sourceStart: number; top: number }>,
    panelTop = 0,
    scrollTop = 0,
  ): HTMLDivElement {
    const panel = document.createElement('div');

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: panelTop, toJSON: () => ({}) as DOMRect,
    });
    Object.defineProperty(panel, 'scrollTop', {
      value: scrollTop, writable: true, configurable: true,
    });

    for (const { sourceStart, top } of blocks) {
      const el = document.createElement('p');
      el.dataset.sourceStart = String(sourceStart);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 50,
        width: 800, height: 50, x: 0, y: top, toJSON: () => ({}) as DOMRect,
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
      width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) as DOMRect,
    });
    Object.defineProperty(panel, 'scrollTop', { value: 0, writable: true });
    expect(findBlockAtViewportTop(panel as HTMLDivElement)).toBeNull();
  });

  // SS-FV2: Block at viewport top → returns its sourceStart and pixelOffset=0
  it('returns block whose top aligns with viewport top', () => {
    const panel = makePanel(
      [{ sourceStart: 1000, top: 0 }],
      0,
      200,
    );
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 1000, pixelOffset: 0 });
  });

  // SS-FV3: Viewport top partway through a block → pixelOffset > 0
  it('returns pixelOffset when viewport top is partway through a block', () => {
    const panel = makePanel(
      [{ sourceStart: 500, top: -30 }],
      0,
      130,
    );
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 500, pixelOffset: 30 });
  });

  // SS-FV4: Multiple blocks — selects closest to viewport top from above
  it('selects block closest to viewport top from above', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: -200 },
        { sourceStart: 200, top: -50 },
        { sourceStart: 300, top: 100 },
      ],
      0,
      300,
    );
    const result = findBlockAtViewportTop(panel);
    expect(result?.sourceStart).toBe(200);
    expect(result?.pixelOffset).toBe(50);
  });

  // SS-FV5: All blocks below viewport top → falls back to first element
  it('falls back to first element when all blocks are below viewport top', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: 50 },
        { sourceStart: 200, top: 200 },
      ],
      0,
      0,
    );
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
    const result = findBlockAtViewportTop(panel);
    expect(result).toEqual({ sourceStart: 1234, pixelOffset: 500 });
  });
});

// ─── 2d. findBlockBySourceOffset ──────────────────────────────────

describe('findBlockBySourceOffset', () => {
  function makePanel(
    blocks: Array<{ sourceStart: number; top: number }>,
    panelTop = 0,
    scrollTop = 0,
  ): HTMLDivElement {
    const panel = document.createElement('div');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: panelTop, toJSON: () => ({}) as DOMRect,
    });
    Object.defineProperty(panel, 'scrollTop', {
      value: scrollTop, writable: true, configurable: true,
    });

    for (const { sourceStart, top } of blocks) {
      const el = document.createElement('p');
      el.dataset.sourceStart = String(sourceStart);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 800, bottom: top + 50,
        width: 800, height: 50, x: 0, y: top, toJSON: () => ({}) as DOMRect,
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
      width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) as DOMRect,
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
    expect(findBlockBySourceOffset(panel, 300)).toBe(200);
  });

  // SS-FB3: No exact match → returns closest element
  it('returns position of closest element when no exact match', () => {
    const panel = makePanel(
      [
        { sourceStart: 100, top: 50 },
        { sourceStart: 500, top: 400 },
      ],
      0,
      0,
    );
    expect(findBlockBySourceOffset(panel, 350)).toBe(400);
  });

  // SS-FB4: Scrolled panel — absolute Y
  it('computes absolute Y correctly with scrolled panel', () => {
    const panel = makePanel(
      [{ sourceStart: 1000, top: -200 }],
      0,
      500,
    );
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
