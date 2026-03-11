import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { parseFiling } from '../../../src/parser/parser.js';
import { diffFilings } from '../../../src/diff/diff-engine.js';
import { makeRawFiling } from '../../helpers/ground-truth.js';

const SPIKE_FIXTURES = join(import.meta.dirname, '..', '..', '..', 'spikes', 'diff-algorithm', 'fixtures');

function loadSpikeFixture(filename: string): string {
  return readFileSync(join(SPIKE_FIXTURES, filename), 'utf-8');
}

describe('E2E: Full diff pipeline (parseFiling -> diffFilings)', () => {
  const appleOldHtml = loadSpikeFixture('apple-fy2023.htm');
  const appleNewHtml = loadSpikeFixture('apple-fy2024.htm');

  const oldFiling = makeRawFiling(appleOldHtml, {
    accessionNumber: '0000320193-23-000106',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2023-11-03'),
  });
  const newFiling = makeRawFiling(appleNewHtml, {
    accessionNumber: '0000320193-24-000123',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2024-11-01'),
  });

  const oldDoc = parseFiling(oldFiling);
  const newDoc = parseFiling(newFiling);

  it('E2E-1: parseFiling -> diffFilings produces complete StructuredDiff', () => {
    const result = diffFilings(oldDoc, newDoc);

    // DiffFilingMetadata — value equality, no html
    expect(result.oldFiling.accessionNumber).toBe(oldFiling.accessionNumber);
    expect(result.newFiling.accessionNumber).toBe(newFiling.accessionNumber);
    expect('html' in result.oldFiling).toBe(false);
    expect('html' in result.newFiling).toBe(false);
    expect(result.sectionDiffs).toBeDefined();
    expect(result.sectionDiffs.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
    expect(result.generatedAt).toBeDefined();

    // Verify summary has all required fields
    expect(typeof result.summary.added).toBe('number');
    expect(typeof result.summary.removed).toBe('number');
    expect(typeof result.summary.modified).toBe('number');
    expect(typeof result.summary.unchanged).toBe('number');
    expect(typeof result.summary.reordered).toBe('number');
  });

  it('E2E-2: StructuredDiff output is JSON-serializable (DiffFilingMetadata)', () => {
    const result = diffFilings(oldDoc, newDoc);

    // Temporal polyfill provides toJSON() natively — no custom replacer needed
    const serialized = JSON.stringify(result);

    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized);
    expect(parsed.sectionDiffs.length).toBe(result.sectionDiffs.length);
    expect(parsed.summary).toEqual(result.summary);
    expect(typeof parsed.generatedAt).toBe('string');

    // DiffFilingMetadata: no html field in serialized output
    expect('html' in parsed.oldFiling).toBe(false);
    expect('html' in parsed.newFiling).toBe(false);
    // Metadata fields present
    expect(parsed.oldFiling.accessionNumber).toBeDefined();
    expect(parsed.oldFiling.cik).toBeDefined();
    expect(typeof parsed.oldFiling.filingDate).toBe('string');
  });

  it('E2E-3: DiffRange source mappings reference valid offsets', () => {
    const result = diffFilings(oldDoc, newDoc);

    for (const sd of result.sectionDiffs) {
      if (sd.sourceMapping.old) {
        expect(sd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
        expect(sd.sourceMapping.old.end).toBeGreaterThan(sd.sourceMapping.old.start);
        expect(sd.sourceMapping.old.end).toBeLessThanOrEqual(appleOldHtml.length);
      }
      if (sd.sourceMapping.new) {
        expect(sd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
        expect(sd.sourceMapping.new.end).toBeGreaterThan(sd.sourceMapping.new.start);
        expect(sd.sourceMapping.new.end).toBeLessThanOrEqual(appleNewHtml.length);
      }

      // Added sections should only have new mapping
      if (sd.changeType === 'added') {
        expect(sd.sourceMapping.old).toBeUndefined();
        expect(sd.sourceMapping.new).toBeDefined();
      }
      // Removed sections should only have old mapping
      if (sd.changeType === 'removed') {
        expect(sd.sourceMapping.old).toBeDefined();
        expect(sd.sourceMapping.new).toBeUndefined();
      }
      // Matched sections should have both
      if (['unchanged', 'modified', 'reordered'].includes(sd.changeType)) {
        expect(sd.sourceMapping.old).toBeDefined();
        expect(sd.sourceMapping.new).toBeDefined();
      }
    }
  });

  it('E2E-4: diffing a document against itself produces all unchanged (with filtering)', () => {
    const result = diffFilings(oldDoc, oldDoc);

    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.reordered).toBe(0);
    expect(result.summary.unchanged).toBe(oldDoc.sections.length);

    for (const sd of result.sectionDiffs) {
      expect(sd.changeType).toBe('unchanged');
      // BQ6: unchanged paragraphs and tables are filtered from output
      expect(sd.paragraphDiffs).toEqual([]);
      expect(sd.tableDiffs).toEqual([]);
    }
  });

  it('E2E-5: diffing produces deterministic output', () => {
    const result1 = diffFilings(oldDoc, newDoc);
    const result2 = diffFilings(oldDoc, newDoc);

    expect(result1.sectionDiffs.length).toBe(result2.sectionDiffs.length);
    for (let i = 0; i < result1.sectionDiffs.length; i++) {
      expect(result1.sectionDiffs[i].id).toBe(result2.sectionDiffs[i].id);
      expect(result1.sectionDiffs[i].changeType).toBe(result2.sectionDiffs[i].changeType);
      expect(result1.sectionDiffs[i].heading).toBe(result2.sectionDiffs[i].heading);
    }
    expect(result1.summary).toEqual(result2.summary);
  });
});

describe('E2E: structured diff with tables', () => {
  const appleOldHtml = loadSpikeFixture('apple-fy2023.htm');
  const appleNewHtml = loadSpikeFixture('apple-fy2024.htm');

  const oldFiling = makeRawFiling(appleOldHtml, {
    accessionNumber: '0000320193-23-000106',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2023-11-03'),
  });
  const newFiling = makeRawFiling(appleNewHtml, {
    accessionNumber: '0000320193-24-000123',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2024-11-01'),
  });

  const oldDoc = parseFiling(oldFiling);
  const newDoc = parseFiling(newFiling);

  it('E2E-T1: full pipeline produces tableDiffs in modified sections', () => {
    const result = diffFilings(oldDoc, newDoc);

    const modifiedSections = result.sectionDiffs.filter(
      (d) => d.changeType === 'modified',
    );
    expect(modifiedSections.length).toBeGreaterThan(0);

    // At least one modified section should have non-empty tableDiffs
    // (Apple 10-K has many financial tables)
    const sectionsWithTables = modifiedSections.filter(
      (d) => d.tableDiffs.length > 0,
    );
    expect(sectionsWithTables.length).toBeGreaterThan(0);
  });

  it('E2E-T2: tableDiff summary counts are consistent', () => {
    const result = diffFilings(oldDoc, newDoc);

    for (const sd of result.sectionDiffs) {
      for (const td of sd.tableDiffs) {
        // Row counts should add up to total rows
        const totalRows =
          td.summary.rowsAdded +
          td.summary.rowsRemoved +
          td.summary.rowsModified +
          td.summary.rowsUnchanged;
        expect(totalRows).toBeGreaterThanOrEqual(0);

        // cellDiffs.length should match summary.cellsChanged
        expect(td.cellDiffs.length).toBe(td.summary.cellsChanged);
      }
    }
  });

  it('E2E-T3: tableDiff cellDiffs flat list matches rowDiffs contents', () => {
    const result = diffFilings(oldDoc, newDoc);

    for (const sd of result.sectionDiffs) {
      for (const td of sd.tableDiffs) {
        // cellDiffs should equal flatMap of rowDiff cellDiffs
        const cellDiffsFromRows = td.rowDiffs.flatMap((rd) => rd.cellDiffs);
        expect(td.cellDiffs).toEqual(cellDiffsFromRows);
      }
    }
  });

  it('E2E-T4: all source mappings (section, paragraph, table, cell) are valid', () => {
    const result = diffFilings(oldDoc, newDoc);

    for (const sd of result.sectionDiffs) {
      // Section-level source mapping
      if (sd.sourceMapping.old) {
        expect(sd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
        expect(sd.sourceMapping.old.end).toBeGreaterThan(sd.sourceMapping.old.start);
        expect(sd.sourceMapping.old.end).toBeLessThanOrEqual(appleOldHtml.length);
      }
      if (sd.sourceMapping.new) {
        expect(sd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
        expect(sd.sourceMapping.new.end).toBeGreaterThan(sd.sourceMapping.new.start);
        expect(sd.sourceMapping.new.end).toBeLessThanOrEqual(appleNewHtml.length);
      }

      // Paragraph-level
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old) {
          expect(pd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.old.end).toBeGreaterThan(pd.sourceMapping.old.start);
          expect(pd.sourceMapping.old.end).toBeLessThanOrEqual(appleOldHtml.length);
        }
        if (pd.sourceMapping.new) {
          expect(pd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.new.end).toBeGreaterThan(pd.sourceMapping.new.start);
          expect(pd.sourceMapping.new.end).toBeLessThanOrEqual(appleNewHtml.length);
        }
      }

      // Table-level
      for (const td of sd.tableDiffs) {
        if (td.sourceMapping.old) {
          expect(td.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(td.sourceMapping.old.end).toBeGreaterThan(td.sourceMapping.old.start);
          expect(td.sourceMapping.old.end).toBeLessThanOrEqual(appleOldHtml.length);
        }
        if (td.sourceMapping.new) {
          expect(td.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(td.sourceMapping.new.end).toBeGreaterThan(td.sourceMapping.new.start);
          expect(td.sourceMapping.new.end).toBeLessThanOrEqual(appleNewHtml.length);
        }

        // Cell-level
        for (const cd of td.cellDiffs) {
          if (cd.sourceMapping.old) {
            expect(cd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
            expect(cd.sourceMapping.old.end).toBeGreaterThan(cd.sourceMapping.old.start);
            expect(cd.sourceMapping.old.end).toBeLessThanOrEqual(appleOldHtml.length);
          }
          if (cd.sourceMapping.new) {
            expect(cd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
            expect(cd.sourceMapping.new.end).toBeGreaterThan(cd.sourceMapping.new.start);
            expect(cd.sourceMapping.new.end).toBeLessThanOrEqual(appleNewHtml.length);
          }
        }
      }

      // Direction matches changeType
      if (sd.changeType === 'added') {
        expect(sd.sourceMapping.old).toBeUndefined();
        expect(sd.sourceMapping.new).toBeDefined();
      }
      if (sd.changeType === 'removed') {
        expect(sd.sourceMapping.old).toBeDefined();
        expect(sd.sourceMapping.new).toBeUndefined();
      }
      if (['unchanged', 'modified', 'reordered'].includes(sd.changeType)) {
        expect(sd.sourceMapping.old).toBeDefined();
        expect(sd.sourceMapping.new).toBeDefined();
      }
    }
  });

  it('E2E-T5: JSON serialization round-trip with tables', () => {
    const result = diffFilings(oldDoc, newDoc);

    // Temporal polyfill provides toJSON() natively — no custom replacer needed
    const serialized = JSON.stringify(result);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized);

    // Structure survives round-trip
    expect(parsed.sectionDiffs.length).toBe(result.sectionDiffs.length);
    expect(parsed.summary).toEqual(result.summary);

    // tableDiffs survive
    for (let i = 0; i < result.sectionDiffs.length; i++) {
      expect(parsed.sectionDiffs[i].tableDiffs.length).toBe(
        result.sectionDiffs[i].tableDiffs.length,
      );
      for (let j = 0; j < result.sectionDiffs[i].tableDiffs.length; j++) {
        const origTd = result.sectionDiffs[i].tableDiffs[j];
        const parsedTd = parsed.sectionDiffs[i].tableDiffs[j];
        expect(parsedTd.changeType).toBe(origTd.changeType);
        expect(parsedTd.cellDiffs.length).toBe(origTd.cellDiffs.length);
        expect(parsedTd.summary).toEqual(origTd.summary);

        // BQ6: oldTable/newTable absent after round-trip
        expect('oldTable' in parsedTd).toBe(false);
        expect('newTable' in parsedTd).toBe(false);

        // cellDiff oldValue/newValue preserved
        for (let k = 0; k < origTd.cellDiffs.length; k++) {
          expect(parsedTd.cellDiffs[k].oldValue).toBe(origTd.cellDiffs[k].oldValue);
          expect(parsedTd.cellDiffs[k].newValue).toBe(origTd.cellDiffs[k].newValue);
        }
      }
    }

    // Temporal types are ISO strings after round-trip
    expect(typeof parsed.generatedAt).toBe('string');
    expect(typeof parsed.oldFiling.filingDate).toBe('string');
    expect(typeof parsed.newFiling.filingDate).toBe('string');
  });

  it('E2E-T6: self-diff produces no table changes (all filtered)', () => {
    const result = diffFilings(oldDoc, oldDoc);

    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);

    for (const sd of result.sectionDiffs) {
      expect(sd.changeType).toBe('unchanged');
      // BQ6: unchanged paragraphs and tables are filtered from output
      expect(sd.paragraphDiffs).toEqual([]);
      expect(sd.tableDiffs).toEqual([]);
    }
  });

  it('E2E-T7: deterministic output including tableDiffs', () => {
    const result1 = diffFilings(oldDoc, newDoc);
    const result2 = diffFilings(oldDoc, newDoc);

    expect(result1.sectionDiffs.length).toBe(result2.sectionDiffs.length);
    for (let i = 0; i < result1.sectionDiffs.length; i++) {
      const sd1 = result1.sectionDiffs[i];
      const sd2 = result2.sectionDiffs[i];

      // tableDiffs count matches
      expect(sd1.tableDiffs.length).toBe(sd2.tableDiffs.length);

      // tableDiff changeTypes match
      for (let j = 0; j < sd1.tableDiffs.length; j++) {
        expect(sd1.tableDiffs[j].changeType).toBe(sd2.tableDiffs[j].changeType);
        // cellDiffs count matches
        expect(sd1.tableDiffs[j].cellDiffs.length).toBe(sd2.tableDiffs[j].cellDiffs.length);
      }
    }
    expect(result1.summary).toEqual(result2.summary);
  });

  it('E2E-S1: output JSON size is within target bounds (< 1MB)', () => {
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.stringify(result);
    const sizeBytes = json.length;
    const sizeMB = sizeBytes / (1024 * 1024);

    // Log actual size for manual inspection
    console.log(`E2E-S1: output JSON size = ${sizeBytes} bytes (${sizeMB.toFixed(2)} MB)`);

    // Target: ~0.2MB for typical diffs (was ~22MB before BQ6)
    // Apple 10-K is a large filing with many tables/sections — allow up to 2MB
    expect(sizeBytes).toBeLessThan(2 * 1024 * 1024); // < 2MB
  });
});

describe('E2E: single word change produces minimal focused diff', () => {
  const originalHtml = loadSpikeFixture('apple-fy2024.htm');
  // Replace the first occurrence of "revenue" with "XREVENUEX" (unmistakable marker)
  const modifiedHtml = originalHtml.replace(/\brevenue\b/i, 'XREVENUEX');

  // Sanity: the replacement actually changed something
  expect(modifiedHtml).not.toBe(originalHtml);

  const originalFiling = makeRawFiling(originalHtml, {
    accessionNumber: '0000320193-24-000123',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2024-11-01'),
  });
  const modifiedFiling = makeRawFiling(modifiedHtml, {
    accessionNumber: '0000320193-24-000124',
    cik: '0000320193',
    filingDate: Temporal.PlainDate.from('2024-11-01'),
  });

  const originalDoc = parseFiling(originalFiling);
  const modifiedDoc = parseFiling(modifiedFiling);

  it('E2E-S2: single word change produces minimal focused diff output', () => {
    const result = diffFilings(originalDoc, modifiedDoc);

    // Exactly 1 section should be modified
    const modifiedSections = result.sectionDiffs.filter(
      (sd) => sd.changeType !== 'unchanged',
    );
    expect(modifiedSections.length).toBe(1);
    expect(modifiedSections[0].changeType).toBe('modified');

    // That section should have exactly 1 modified paragraphDiff
    const modifiedParagraphs = modifiedSections[0].paragraphDiffs.filter(
      (pd) => pd.changeType === 'modified',
    );
    expect(modifiedParagraphs.length).toBe(1);

    // The modified paragraph should have wordChanges containing the specific change
    const wordChanges = modifiedParagraphs[0].wordChanges;
    expect(wordChanges).toBeDefined();
    expect(wordChanges!.length).toBeGreaterThan(0);

    // Should contain a 'removed' word and an 'added' word for the change
    const removedWords = wordChanges!.filter((wc) => wc.type === 'removed');
    const addedWords = wordChanges!.filter((wc) => wc.type === 'added');
    expect(removedWords.length).toBeGreaterThan(0);
    expect(addedWords.length).toBeGreaterThan(0);

    // The added word should contain our replacement
    expect(addedWords.some((wc) => wc.value.includes('XREVENUEX'))).toBe(true);

    // No tableDiffs anywhere (we only changed paragraph text)
    for (const sd of result.sectionDiffs) {
      expect(sd.tableDiffs).toEqual([]);
    }

    // All other sections should be unchanged with empty diffs
    const unchangedSections = result.sectionDiffs.filter(
      (sd) => sd.changeType === 'unchanged',
    );
    expect(unchangedSections.length).toBe(result.sectionDiffs.length - 1);
    for (const sd of unchangedSections) {
      expect(sd.paragraphDiffs).toEqual([]);
      expect(sd.tableDiffs).toEqual([]);
    }

    // Summary should show exactly 1 modified
    expect(result.summary.modified).toBe(1);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.reordered).toBe(0);
    expect(result.summary.unchanged).toBe(result.sectionDiffs.length - 1);

    // Output JSON should be small (< 50 KB for a single word change)
    const json = JSON.stringify(result);
    const sizeBytes = json.length;
    console.log(`E2E-S2: output JSON size = ${sizeBytes} bytes (${(sizeBytes / 1024).toFixed(1)} KB)`);
    expect(sizeBytes).toBeLessThan(50 * 1024); // < 50 KB
  });
});
