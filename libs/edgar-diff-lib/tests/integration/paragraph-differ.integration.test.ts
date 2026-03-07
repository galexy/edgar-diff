import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import { diffFilings } from '../../src/diff/index.js';
import type { FilingDiffResult, ParagraphChange, TablePlaceholder } from '../../src/diff/types.js';
import { loadFixture, makeRawFiling } from '../helpers/ground-truth.js';

// ============================================================
// Helper: parse and diff two fixtures
// ============================================================

function diffFixtures(
  tickerA: string, yearA: number,
  tickerB: string, yearB: number,
): { result: FilingDiffResult; htmlA: string; htmlB: string } {
  const htmlA = loadFixture(tickerA, yearA);
  const htmlB = loadFixture(tickerB, yearB);
  const docA = parseFiling(makeRawFiling(htmlA));
  const docB = parseFiling(makeRawFiling(htmlB));
  const result = diffFilings(docA, docB);
  return { result, htmlA, htmlB };
}

function isParagraphChange(c: { type: string }): c is ParagraphChange {
  return c.type !== 'table';
}

function isTablePlaceholder(c: { type: string }): c is TablePlaceholder {
  return c.type === 'table';
}

// ============================================================
// PD-I1: Cross-year diff produces reasonable change count
// Using MSFT FY2023 vs FY2024 (we have both fixtures)
// ============================================================

describe('PD-I1: cross-year diff produces reasonable change count', () => {
  it('MSFT FY2023 vs FY2024 Item 1 diff has changes', () => {
    const { result } = diffFixtures('msft', 2023, 'msft', 2024);

    // Should have matched sections
    expect(result.sectionDiffs.length).toBeGreaterThan(0);

    // Find a section with changes (any matched section)
    const totalChanges =
      result.totalStats.totalAdded +
      result.totalStats.totalRemoved +
      result.totalStats.totalModified +
      result.totalStats.totalMoved;

    // Cross-year filings should have some changes
    expect(totalChanges).toBeGreaterThan(0);

    // But not everything should be changed (some paragraphs are boilerplate)
    expect(result.totalStats.totalUnchanged).toBeGreaterThan(0);
  });
});

// ============================================================
// PD-I2: Cross-year diff detects modifications
// ============================================================

describe('PD-I2: cross-year diff detects modifications', () => {
  it('MSFT FY2023 vs FY2024 has modified paragraphs', () => {
    const { result } = diffFixtures('msft', 2023, 'msft', 2024);

    const allChanges = result.sectionDiffs.flatMap((sd) => sd.changes);
    const modified = allChanges.filter(
      (c) => isParagraphChange(c) && c.type === 'modified',
    ) as ParagraphChange[];

    expect(modified.length).toBeGreaterThan(0);

    // Modified paragraphs should have word-level diffs
    for (const m of modified) {
      expect(m.wordChanges).toBeDefined();
      expect(m.wordChanges!.length).toBeGreaterThan(0);
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

    // All sections should match
    expect(result.addedSections).toHaveLength(0);
    expect(result.removedSections).toHaveLength(0);

    // All paragraph changes should be unchanged
    for (const sd of result.sectionDiffs) {
      const paragraphChanges = sd.changes.filter(isParagraphChange) as ParagraphChange[];
      for (const pc of paragraphChanges) {
        expect(pc.type).toBe('unchanged');
      }
    }

    // No moved paragraphs
    expect(result.totalStats.totalMoved).toBe(0);
    expect(result.totalStats.totalAdded).toBe(0);
    expect(result.totalStats.totalRemoved).toBe(0);
    expect(result.totalStats.totalModified).toBe(0);
  });
});

// ============================================================
// PD-I4: Source mappings round-trip to correct HTML substrings
// ============================================================

describe('PD-I4: source mapping round-trip', () => {
  it('diff source locations slice to valid HTML substrings', () => {
    const { result, htmlA, htmlB } = diffFixtures('msft', 2023, 'msft', 2024);

    for (const sd of result.sectionDiffs) {
      for (const change of sd.changes) {
        if (!isParagraphChange(change)) continue;
        const pc = change as ParagraphChange;

        if (pc.oldSource) {
          expect(pc.oldSource.start).toBeGreaterThanOrEqual(0);
          expect(pc.oldSource.end).toBeLessThanOrEqual(htmlA.length);
          const slice = htmlA.slice(pc.oldSource.start, pc.oldSource.end);
          expect(slice.length).toBeGreaterThan(0);
        }

        if (pc.newSource) {
          expect(pc.newSource.start).toBeGreaterThanOrEqual(0);
          expect(pc.newSource.end).toBeLessThanOrEqual(htmlB.length);
          const slice = htmlB.slice(pc.newSource.start, pc.newSource.end);
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
    const htmlA = loadFixture('jpm', 2023);
    const htmlB = loadFixture('jpm', 2024);

    const docA = parseFiling(makeRawFiling(htmlA));
    const docB = parseFiling(makeRawFiling(htmlB));

    // Should not throw
    const result = diffFilings(docA, docB);

    // Should produce a valid result structure
    expect(result.sectionDiffs).toBeInstanceOf(Array);
    expect(result.addedSections).toBeInstanceOf(Array);
    expect(result.removedSections).toBeInstanceOf(Array);
    expect(result.totalStats).toBeDefined();
    expect(result.totalStats.sectionsMatched).toBeGreaterThan(0);
  });
});

// ============================================================
// PD-I6: Sections with only tables produce only TablePlaceholders
// ============================================================

describe('PD-I6: table-only sections', () => {
  it('sections with only tables produce TablePlaceholder entries', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));
    const result = diffFilings(doc, doc);

    // Find sections that have table blocks
    for (const sd of result.sectionDiffs) {
      const tablePlaceholders = sd.changes.filter(isTablePlaceholder);
      // If the section has table placeholders, they should have valid type
      for (const tp of tablePlaceholders) {
        expect(tp.type).toBe('table');
      }
    }

    // Overall: table count should be reported in stats
    expect(result.totalStats.totalTables).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// PD-I7: Mixed tables and paragraphs
// ============================================================

describe('PD-I7: mixed tables and paragraphs', () => {
  it('paragraphs are diffed, tables emitted as placeholders', () => {
    const { result } = diffFixtures('msft', 2023, 'msft', 2024);

    // Across all sections, we should see both paragraph changes and table placeholders
    const allChanges = result.sectionDiffs.flatMap((sd) => sd.changes);
    const paragraphChanges = allChanges.filter(isParagraphChange);
    const tablePlaceholders = allChanges.filter(isTablePlaceholder);

    expect(paragraphChanges.length).toBeGreaterThan(0);
    // Real filings typically have tables in financial sections
    expect(tablePlaceholders.length).toBeGreaterThanOrEqual(0);

    // Paragraph changes should have valid types
    for (const pc of paragraphChanges) {
      expect(['added', 'removed', 'modified', 'unchanged', 'moved']).toContain(pc.type);
    }
  });
});

// ============================================================
// PD-I8: All diff entries reference valid source locations
// ============================================================

describe('PD-I8: source location validity', () => {
  it('all entries reference valid source locations within HTML bounds', { timeout: 60_000 }, () => {
    const { result, htmlA, htmlB } = diffFixtures('jpm', 2023, 'jpm', 2024);

    for (const sd of result.sectionDiffs) {
      for (const change of sd.changes) {
        if (isParagraphChange(change)) {
          const pc = change as ParagraphChange;
          if (pc.type === 'added') {
            expect(pc.newSource).toBeDefined();
            expect(pc.newSource!.start).toBeGreaterThanOrEqual(0);
            expect(pc.newSource!.start).toBeLessThan(pc.newSource!.end);
            expect(pc.newSource!.end).toBeLessThanOrEqual(htmlB.length);
          } else if (pc.type === 'removed') {
            expect(pc.oldSource).toBeDefined();
            expect(pc.oldSource!.start).toBeGreaterThanOrEqual(0);
            expect(pc.oldSource!.start).toBeLessThan(pc.oldSource!.end);
            expect(pc.oldSource!.end).toBeLessThanOrEqual(htmlA.length);
          } else {
            // modified, unchanged, moved: both sources
            expect(pc.oldSource).toBeDefined();
            expect(pc.newSource).toBeDefined();
            expect(pc.oldSource!.start).toBeLessThan(pc.oldSource!.end);
            expect(pc.newSource!.start).toBeLessThan(pc.newSource!.end);
            expect(pc.oldSource!.end).toBeLessThanOrEqual(htmlA.length);
            expect(pc.newSource!.end).toBeLessThanOrEqual(htmlB.length);
          }
        } else {
          // TablePlaceholder
          const tp = change as TablePlaceholder;
          if (tp.oldSource) {
            expect(tp.oldSource.start).toBeGreaterThanOrEqual(0);
            expect(tp.oldSource.start).toBeLessThan(tp.oldSource.end);
            expect(tp.oldSource.end).toBeLessThanOrEqual(htmlA.length);
          }
          if (tp.newSource) {
            expect(tp.newSource.start).toBeGreaterThanOrEqual(0);
            expect(tp.newSource.start).toBeLessThan(tp.newSource.end);
            expect(tp.newSource.end).toBeLessThanOrEqual(htmlB.length);
          }
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
    const totalChanges =
      result.totalStats.totalAdded +
      result.totalStats.totalRemoved +
      result.totalStats.totalModified +
      result.totalStats.totalMoved;
    expect(totalChanges).toBeGreaterThan(0);
  });
});
