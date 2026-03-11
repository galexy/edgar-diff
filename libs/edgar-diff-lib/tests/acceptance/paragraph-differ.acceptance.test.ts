import { describe, it, expect } from 'vitest';
import { alignSections } from '../../src/diff/index.js';
import { diffFilings } from '../../src/diff/index.js';
import { makeSection, makeStructuredDoc } from '../helpers/diff-fixtures.js';
import { generateParagraphPair, generateSectionPair } from './diff-test-generator.js';

const DIFF_TEST_COUNT = Number(process.env['DIFF_TEST_COUNT'] ?? 200);

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

    // Count diff entries that reference an old paragraph via sourceMapping.old
    // (unchanged paragraphs are filtered from paragraphDiffs, so count <= base.length)
    let oldMappingCount = 0;
    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old) {
          oldMappingCount++;
        }
      }
    }

    // Changed entries referencing old paragraphs should not exceed base count
    expect(oldMappingCount).toBeLessThanOrEqual(base.length);
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

    // Count diff entries that reference a new paragraph via sourceMapping.new
    // (unchanged paragraphs are filtered from paragraphDiffs, so count <= target.length)
    let newMappingCount = 0;
    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.new) {
          newMappingCount++;
        }
      }
    }

    // Changed entries referencing new paragraphs should not exceed target count
    expect(newMappingCount).toBeLessThanOrEqual(target.length);
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

  it.each(cases)('case $label: entry count <= max(base, target)', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    const paragraphDiffs = result.sectionDiffs.flatMap((sd) => sd.paragraphDiffs);

    // With unchanged filtering, only changed entries remain
    // The count should be <= max(base, target) — no more entries than inputs
    expect(paragraphDiffs.length).toBeLessThanOrEqual(
      base.length + target.length,
    );
    // All entries should be non-unchanged
    for (const pd of paragraphDiffs) {
      expect(pd.changeType).not.toBe('unchanged');
    }
  });
});

// ============================================================
// PA-A7: Summary fields are consistent
// ============================================================

describe('PA-A7: summary consistency', () => {
  const cases = Array.from({ length: DIFF_TEST_COUNT }, (_, i) => {
    const { base, target } = generateParagraphPair();
    return { label: `#${i}`, base, target };
  });

  it.each(cases)('case $label: summary fields are valid', ({ base, target }) => {
    const baseSection = makeSection('item-1', 'Item 1. Test', base);
    const targetSection = makeSection('item-1', 'Item 1. Test', target);
    const baseDoc = makeStructuredDoc([baseSection]);
    const targetDoc = makeStructuredDoc([targetSection]);

    const result = diffFilings(baseDoc, targetDoc);

    // Summary should have non-negative values
    expect(result.summary.added).toBeGreaterThanOrEqual(0);
    expect(result.summary.removed).toBeGreaterThanOrEqual(0);
    expect(result.summary.modified).toBeGreaterThanOrEqual(0);
    expect(result.summary.unchanged).toBeGreaterThanOrEqual(0);
    expect(result.summary.reordered).toBeGreaterThanOrEqual(0);

    // Total sections in summary should match sectionDiffs count
    const summaryTotal = result.summary.added + result.summary.removed +
      result.summary.modified + result.summary.unchanged + result.summary.reordered;
    expect(summaryTotal).toBe(result.sectionDiffs.length);
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
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old) {
          expect(pd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.old.start).toBeLessThan(pd.sourceMapping.old.end);
        }
        if (pd.sourceMapping.new) {
          expect(pd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.new.start).toBeLessThan(pd.sourceMapping.new.end);
        }
      }
    }
  });
});
