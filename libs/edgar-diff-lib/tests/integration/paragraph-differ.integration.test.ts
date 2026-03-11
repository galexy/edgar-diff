import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import { diffFilings } from '../../src/diff/index.js';
import type { StructuredDiff } from '../../src/diff/types.js';
import { loadFixture, makeRawFiling } from '../helpers/ground-truth.js';
import { assertDefined } from '../helpers/assert-defined.js';

// ============================================================
// Helper: parse and diff two fixtures
// ============================================================

function diffFixtures(
  tickerA: string, yearA: number,
  tickerB: string, yearB: number,
): { result: StructuredDiff; htmlA: string; htmlB: string } {
  const htmlA = loadFixture(tickerA, yearA);
  const htmlB = loadFixture(tickerB, yearB);
  const docA = parseFiling(makeRawFiling(htmlA));
  const docB = parseFiling(makeRawFiling(htmlB));
  const result = diffFilings(docA, docB);
  return { result, htmlA, htmlB };
}

// Lazy caches — each unique diffFixtures() call runs at most once
let msftDiffCache: ReturnType<typeof diffFixtures> | undefined;
function getMsftDiff() {
  return (msftDiffCache ??= diffFixtures('msft', 2023, 'msft', 2024));
}

let jpmDiffCache: ReturnType<typeof diffFixtures> | undefined;
function getJpmDiff() {
  return (jpmDiffCache ??= diffFixtures('jpm', 2023, 'jpm', 2024));
}

// ============================================================
// PD-I1: Cross-year diff produces reasonable change count
// Using MSFT FY2023 vs FY2024 (we have both fixtures)
// ============================================================

describe('PD-I1: cross-year diff produces reasonable change count', () => {
  it('MSFT FY2023 vs FY2024 Item 1 diff has changes', () => {
    const { result } = getMsftDiff();

    // Should have matched sections
    expect(result.sectionDiffs.length).toBeGreaterThan(0);

    // Collect all paragraph diffs
    const allParagraphDiffs = result.sectionDiffs.flatMap(sd => sd.paragraphDiffs);

    const totalChanges = allParagraphDiffs.filter(
      pd => pd.changeType === 'added' || pd.changeType === 'removed' ||
            pd.changeType === 'modified' || pd.changeType === 'moved',
    ).length;

    // Cross-year filings should have some changes
    expect(totalChanges).toBeGreaterThan(0);

    // Unchanged paragraphs are now filtered from diffFilings output.
    // Verify that total changes is less than total paragraphs (some unchanged exist but are filtered).
    const unchangedCount = allParagraphDiffs.filter(pd => pd.changeType === 'unchanged').length;
    expect(unchangedCount).toBe(0); // unchanged paragraphs are filtered out
    // But not all paragraphs should be changed — unchanged sections have empty paragraphDiffs
    const sectionsWithEmptyParagraphs = result.sectionDiffs.filter(
      sd => sd.paragraphDiffs.length === 0 && sd.changeType === 'unchanged',
    ).length;
    expect(sectionsWithEmptyParagraphs).toBeGreaterThan(0);
  });
});

// ============================================================
// PD-I2: Cross-year diff detects modifications
// ============================================================

describe('PD-I2: cross-year diff detects modifications', () => {
  it('MSFT FY2023 vs FY2024 has modified paragraphs', () => {
    const { result } = getMsftDiff();

    const allParagraphDiffs = result.sectionDiffs.flatMap(sd => sd.paragraphDiffs);
    const modified = allParagraphDiffs.filter(pd => pd.changeType === 'modified');

    expect(modified.length).toBeGreaterThan(0);

    // Modified paragraphs should have word-level diffs
    for (const m of modified) {
      const wordChanges = m.wordChanges;
      assertDefined(wordChanges);
      expect(wordChanges.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// PD-I3: Same filing diffed against itself
// ============================================================

describe('PD-I3: identity diff', () => {
  it('same filing diffed against itself: all paragraphs unchanged', () => {
    const html = loadFixture('msft', 2024);
    const doc = parseFiling(makeRawFiling(html));
    const result = diffFilings(doc, doc);

    // No added or removed sections
    const addedSections = result.sectionDiffs.filter(sd => sd.changeType === 'added');
    const removedSections = result.sectionDiffs.filter(sd => sd.changeType === 'removed');
    expect(addedSections).toHaveLength(0);
    expect(removedSections).toHaveLength(0);

    // Self-diff: all paragraphs are unchanged and filtered out
    for (const sd of result.sectionDiffs) {
      expect(sd.paragraphDiffs).toHaveLength(0);
    }
  });
});

// ============================================================
// PD-I4: Source mappings round-trip to correct HTML substrings
// ============================================================

describe('PD-I4: source mapping round-trip', () => {
  it('diff source locations slice to valid HTML substrings', () => {
    const { result, htmlA, htmlB } = getMsftDiff();

    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old) {
          expect(pd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.old.end).toBeLessThanOrEqual(htmlA.length);
          const slice = htmlA.slice(pd.sourceMapping.old.start, pd.sourceMapping.old.end);
          expect(slice.length).toBeGreaterThan(0);
        }

        if (pd.sourceMapping.new) {
          expect(pd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.new.end).toBeLessThanOrEqual(htmlB.length);
          const slice = htmlB.slice(pd.sourceMapping.new.start, pd.sourceMapping.new.end);
          expect(slice.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ============================================================
// PD-I5: parseFiling() output feeds directly into diffFilings()
// ============================================================

describe('PD-I5: parser-to-diff pipeline', () => {
  it('parseFiling output feeds directly into diffFilings without errors', { timeout: 60_000 }, () => {
    const { result } = getJpmDiff();

    // Should produce a valid result structure
    expect(result.sectionDiffs).toBeInstanceOf(Array);
    expect(result.summary).toBeDefined();
    expect(result.sectionDiffs.length).toBeGreaterThan(0);
  });
});

// ============================================================
// PD-I6: Sections with only tables produce tableDiffs
// ============================================================

describe('PD-I6: table-only sections', () => {
  it('sections may produce tableDiffs entries', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));
    const result = diffFilings(doc, doc);

    // Verify sectionDiffs have valid structure
    for (const sd of result.sectionDiffs) {
      expect(sd.paragraphDiffs).toBeInstanceOf(Array);
      expect(sd.tableDiffs).toBeInstanceOf(Array);
    }
  });
});

// ============================================================
// PD-I7: Mixed tables and paragraphs
// ============================================================

describe('PD-I7: mixed tables and paragraphs', () => {
  it('paragraphs are diffed in paragraphDiffs', () => {
    const { result } = getMsftDiff();

    // Across all sections, we should see paragraph diffs
    const allParagraphDiffs = result.sectionDiffs.flatMap(sd => sd.paragraphDiffs);
    expect(allParagraphDiffs.length).toBeGreaterThan(0);

    // Paragraph diffs should have valid changeTypes
    for (const pd of allParagraphDiffs) {
      expect(['added', 'removed', 'modified', 'unchanged', 'moved']).toContain(pd.changeType);
    }
  });
});

// ============================================================
// PD-I8: All diff entries reference valid source locations
// ============================================================

describe('PD-I8: source location validity', () => {
  it('all entries reference valid source locations within HTML bounds', { timeout: 60_000 }, () => {
    const { result, htmlA, htmlB } = getJpmDiff();

    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        if (pd.changeType === 'added') {
          const newMapping = pd.sourceMapping.new;
          assertDefined(newMapping);
          expect(newMapping.start).toBeGreaterThanOrEqual(0);
          expect(newMapping.start).toBeLessThan(newMapping.end);
          expect(newMapping.end).toBeLessThanOrEqual(htmlB.length);
        } else if (pd.changeType === 'removed') {
          const oldMapping = pd.sourceMapping.old;
          assertDefined(oldMapping);
          expect(oldMapping.start).toBeGreaterThanOrEqual(0);
          expect(oldMapping.start).toBeLessThan(oldMapping.end);
          expect(oldMapping.end).toBeLessThanOrEqual(htmlA.length);
        } else {
          // modified, unchanged, moved: both sources
          const oldMapping = pd.sourceMapping.old;
          const newMapping = pd.sourceMapping.new;
          assertDefined(oldMapping);
          assertDefined(newMapping);
          expect(oldMapping.start).toBeLessThan(oldMapping.end);
          expect(newMapping.start).toBeLessThan(newMapping.end);
          expect(oldMapping.end).toBeLessThanOrEqual(htmlA.length);
          expect(newMapping.end).toBeLessThanOrEqual(htmlB.length);
        }
      }
    }
  });
});

// ============================================================
// Additional: XOM FY2012 vs FY2024 (legacy vs modern, maximal change)
// ============================================================

describe('cross-era diff: XOM FY2012 vs FY2024', () => {
  it('produces a valid diff result with significant changes', () => {
    const { result } = diffFixtures('xom', 2012, 'xom', 2024);

    expect(result.sectionDiffs.length).toBeGreaterThan(0);

    // Legacy vs modern should have lots of changes
    const allParagraphDiffs = result.sectionDiffs.flatMap(sd => sd.paragraphDiffs);
    const totalChanges = allParagraphDiffs.filter(
      pd => pd.changeType === 'added' || pd.changeType === 'removed' ||
            pd.changeType === 'modified' || pd.changeType === 'moved',
    ).length;
    expect(totalChanges).toBeGreaterThan(0);
  });
});
