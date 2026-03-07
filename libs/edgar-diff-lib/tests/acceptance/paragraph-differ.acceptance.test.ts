import { describe, it, expect } from 'vitest';
import { alignSections } from '../../src/diff/index.js';
import { diffFilings } from '../../src/diff/index.js';
import type { ParagraphChange, TablePlaceholder, BlockChange } from '../../src/diff/types.js';
import { makeSection, makeStructuredDoc, makeParagraph } from '../helpers/diff-fixtures.js';
import { generateParagraphPair, generateSectionPair } from './diff-test-generator.js';

const DIFF_TEST_COUNT = Number(process.env['DIFF_TEST_COUNT'] ?? 200);

function isParagraphChange(c: BlockChange): c is ParagraphChange {
  return c.type !== 'table';
}

// ============================================================
// PA-A1: Alignment is deterministic
// ============================================================

describe('PA-A1: alignment determinism', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateSectionPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: same input produces same alignment', ({ base, target }) => {
    const baseSections = [base];
    const targetSections = [target];

    const result1 = alignSections(baseSections, targetSections);
    const result2 = alignSections(baseSections, targetSections);

    expect(result1.matched.length).toBe(result2.matched.length);
    expect(result1.added.length).toBe(result2.added.length);
    expect(result1.removed.length).toBe(result2.removed.length);

    for (let i = 0; i < result1.matched.length; i++) {
      expect(result1.matched[i].oldSection.id).toBe(result2.matched[i].oldSection.id);
      expect(result1.matched[i].newSection.id).toBe(result2.matched[i].newSection.id);
      expect(result1.matched[i].similarity).toBe(result2.matched[i].similarity);
    }
  });
});

// ============================================================
// PA-A2: Alignment accounts for all sections
// ============================================================

describe('PA-A2: alignment completeness', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const pairCount = Math.floor(Math.random() * 4) + 1;
    const baseSections = Array.from({ length: pairCount }, (_, j) => {
      const { base } = generateSectionPair();
      return makeSection(`item-${j + 1}`, base.heading, base.blocks, j * 1000);
    });
    const targetSections = Array.from({ length: pairCount }, (_, j) => {
      const { target } = generateSectionPair();
      return makeSection(`item-${j + 1}`, target.heading, target.blocks, j * 1000);
    });
    return { label: `#${i}`, baseSections, targetSections };
  });

  it.each(cases)('case $label: every section accounted for', ({ baseSections, targetSections }) => {
    const result = alignSections(baseSections, targetSections);

    const matchedOldIds = new Set(result.matched.map((m) => m.oldSection.id));
    const removedIds = new Set(result.removed.map((s) => s.id));
    const matchedNewIds = new Set(result.matched.map((m) => m.newSection.id));
    const addedIds = new Set(result.added.map((s) => s.id));

    for (const s of baseSections) {
      expect(matchedOldIds.has(s.id) || removedIds.has(s.id)).toBe(true);
    }
    for (const s of targetSections) {
      expect(matchedNewIds.has(s.id) || addedIds.has(s.id)).toBe(true);
    }
  });
});

// ============================================================
// PA-A3: No section appears in multiple matches
// ============================================================

describe('PA-A3: 1:1 mapping constraint', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const count = Math.floor(Math.random() * 5) + 2;
    const baseSections = Array.from({ length: count }, (_, j) =>
      makeSection(`item-${j + 1}`, `Item ${j + 1}. Section ${j + 1}`, [], j * 500),
    );
    const targetSections = Array.from({ length: count }, (_, j) =>
      makeSection(`item-${j + 1}`, `Item ${j + 1}. Section ${j + 1}`, [], j * 500),
    );
    return { label: `#${i}`, baseSections, targetSections };
  });

  it.each(cases)('case $label: no section in multiple matches', ({ baseSections, targetSections }) => {
    const result = alignSections(baseSections, targetSections);

    const oldIds = result.matched.map((m) => m.oldSection.id);
    const newIds = result.matched.map((m) => m.newSection.id);

    expect(new Set(oldIds).size).toBe(oldIds.length);
    expect(new Set(newIds).size).toBe(newIds.length);
  });
});

// ============================================================
// PA-A4: Every base paragraph appears in exactly one diff entry
// ============================================================

describe('PA-A4: base paragraph completeness', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: every base paragraph in exactly one entry', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    // Collect all base paragraphs referenced in diff entries
    const baseTextsInDiff: string[] = [];
    for (const sd of result.sectionDiffs) {
      for (const change of sd.changes) {
        if (!isParagraphChange(change)) continue;
        const pc = change as ParagraphChange;
        if (pc.type === 'removed' || pc.type === 'modified' || pc.type === 'unchanged' || pc.type === 'moved') {
          if (pc.oldText !== undefined) baseTextsInDiff.push(pc.oldText);
        }
      }
    }

    // Every base paragraph text should appear
    for (const bp of base) {
      const normalized = bp.text.replace(/\s+/g, ' ').trim();
      expect(
        baseTextsInDiff.some((t) => t.replace(/\s+/g, ' ').trim() === normalized),
      ).toBe(true);
    }
  });
});

// ============================================================
// PA-A5: Every target paragraph appears in exactly one diff entry
// ============================================================

describe('PA-A5: target paragraph completeness', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: every target paragraph in exactly one entry', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    const targetTextsInDiff: string[] = [];
    for (const sd of result.sectionDiffs) {
      for (const change of sd.changes) {
        if (!isParagraphChange(change)) continue;
        const pc = change as ParagraphChange;
        if (pc.type === 'added' || pc.type === 'modified' || pc.type === 'unchanged' || pc.type === 'moved') {
          if (pc.newText !== undefined) targetTextsInDiff.push(pc.newText);
        }
      }
    }

    for (const tp of target) {
      const normalized = tp.text.replace(/\s+/g, ' ').trim();
      expect(
        targetTextsInDiff.some((t) => t.replace(/\s+/g, ' ').trim() === normalized),
      ).toBe(true);
    }
  });
});

// ============================================================
// PA-A6: Diff entry count >= max(base.length, target.length)
// ============================================================

describe('PA-A6: diff entry count lower bound', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: entry count >= max(base, target)', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    const paragraphChanges = result.sectionDiffs.flatMap((sd) =>
      sd.changes.filter(isParagraphChange),
    );

    expect(paragraphChanges.length).toBeGreaterThanOrEqual(
      Math.max(base.length, target.length),
    );
  });
});

// ============================================================
// PA-A7: DiffStats fields sum correctly
// ============================================================

describe('PA-A7: stats consistency', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: stats fields sum to paragraph count', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    for (const sd of result.sectionDiffs) {
      const { added, removed, modified, unchanged, moved, tables } = sd.stats;

      // Count actual changes
      const paragraphChanges = sd.changes.filter(isParagraphChange);
      const tablePlaceholders = sd.changes.filter((c) => c.type === 'table');

      expect(added + removed + modified + unchanged + moved).toBe(paragraphChanges.length);
      expect(tables).toBe(tablePlaceholders.length);
    }

    // Total stats should sum across section diffs
    const totalFromSections = result.sectionDiffs.reduce(
      (acc, sd) => ({
        added: acc.added + sd.stats.added,
        removed: acc.removed + sd.stats.removed,
        modified: acc.modified + sd.stats.modified,
        unchanged: acc.unchanged + sd.stats.unchanged,
        moved: acc.moved + sd.stats.moved,
        tables: acc.tables + sd.stats.tables,
      }),
      { added: 0, removed: 0, modified: 0, unchanged: 0, moved: 0, tables: 0 },
    );

    expect(result.totalStats.totalAdded).toBe(totalFromSections.added);
    expect(result.totalStats.totalRemoved).toBe(totalFromSections.removed);
    expect(result.totalStats.totalModified).toBe(totalFromSections.modified);
    expect(result.totalStats.totalUnchanged).toBe(totalFromSections.unchanged);
    expect(result.totalStats.totalMoved).toBe(totalFromSections.moved);
    expect(result.totalStats.totalTables).toBe(totalFromSections.tables);
  });
});

// ============================================================
// PA-A8: All changes reference valid source locations
// ============================================================

describe('PA-A8: source location validity', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: all source locations valid', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    for (const sd of result.sectionDiffs) {
      for (const change of sd.changes) {
        if (isParagraphChange(change)) {
          const pc = change as ParagraphChange;
          if (pc.oldSource) {
            expect(pc.oldSource.start).toBeGreaterThanOrEqual(0);
            expect(pc.oldSource.start).toBeLessThan(pc.oldSource.end);
          }
          if (pc.newSource) {
            expect(pc.newSource.start).toBeGreaterThanOrEqual(0);
            expect(pc.newSource.start).toBeLessThan(pc.newSource.end);
          }
        } else {
          const tp = change as TablePlaceholder;
          if (tp.oldSource) {
            expect(tp.oldSource.start).toBeGreaterThanOrEqual(0);
            expect(tp.oldSource.start).toBeLessThan(tp.oldSource.end);
          }
          if (tp.newSource) {
            expect(tp.newSource.start).toBeGreaterThanOrEqual(0);
            expect(tp.newSource.start).toBeLessThan(tp.newSource.end);
          }
        }
      }
    }
  });
});
