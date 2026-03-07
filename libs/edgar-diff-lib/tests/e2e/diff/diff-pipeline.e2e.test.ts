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
