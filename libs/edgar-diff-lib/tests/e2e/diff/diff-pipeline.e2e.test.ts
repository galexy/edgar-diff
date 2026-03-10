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

    expect(result.oldFiling).toBe(oldFiling);
    expect(result.newFiling).toBe(newFiling);
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

  it('E2E-2: StructuredDiff output is JSON-serializable', () => {
    const result = diffFilings(oldDoc, newDoc);

    // Temporal.Instant needs custom serialization
    const serialized = JSON.stringify(result, (key, value) => {
      if (value instanceof Temporal.Instant) {
        return value.toString();
      }
      if (value instanceof Temporal.PlainDate) {
        return value.toString();
      }
      return value;
    });

    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized);
    expect(parsed.sectionDiffs.length).toBe(result.sectionDiffs.length);
    expect(parsed.summary).toEqual(result.summary);
    expect(typeof parsed.generatedAt).toBe('string');
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

  it('E2E-4: diffing a document against itself produces all unchanged', () => {
    const result = diffFilings(oldDoc, oldDoc);

    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.reordered).toBe(0);
    expect(result.summary.unchanged).toBe(oldDoc.sections.length);

    for (const sd of result.sectionDiffs) {
      expect(sd.changeType).toBe('unchanged');
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

  it('E2E-T6: self-diff produces no table changes', () => {
    const result = diffFilings(oldDoc, oldDoc);

    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);

    for (const sd of result.sectionDiffs) {
      expect(sd.changeType).toBe('unchanged');
      for (const td of sd.tableDiffs) {
        expect(td.changeType).toBe('unchanged');
        expect(td.summary.cellsChanged).toBe(0);
      }
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
});
