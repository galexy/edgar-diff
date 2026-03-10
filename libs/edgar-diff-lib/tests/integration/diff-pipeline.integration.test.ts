import { describe, it, expect } from 'vitest';
import { diffFilings } from '../../src/diff/diff-engine.js';
import {
  makeParagraph,
  makeTable,
  makeSection,
  makeStructuredDoc,
} from '../helpers/diff-fixtures.js';

/**
 * Integration tests for US-1.8: diff pipeline with table diffs.
 *
 * These tests verify the full diffFilings() pipeline produces correct
 * tableDiffs alongside paragraphDiffs when sections contain table blocks.
 */
describe('diff pipeline integration', () => {
  it('I-DP-1: sections with paragraphs and tables produce both diff types', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Revenue increased year over year.', 100),
        makeTable(
          [
            ['Metric', 'FY2023'],
            ['Revenue', '$100B'],
            ['Income', '$20B'],
          ],
          200,
        ),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Revenue increased significantly year over year.', 100),
        makeTable(
          [
            ['Metric', 'FY2024'],
            ['Revenue', '$120B'],
            ['Income', '$25B'],
          ],
          200,
        ),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs.find((d) => d.id === 'item-8');
    expect(sd).toBeDefined();
    expect(sd!.paragraphDiffs.length).toBeGreaterThan(0);
    expect(sd!.tableDiffs.length).toBeGreaterThan(0);
  });

  it('I-DP-2: table source mappings point to valid ranges in HTML', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Old text.', 100),
        makeTable(
          [
            ['Label', 'Value'],
            ['Revenue', '$100'],
          ],
          200,
        ),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('New text.', 100),
        makeTable(
          [
            ['Label', 'Value'],
            ['Revenue', '$120'],
          ],
          200,
        ),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    // makeStructuredDoc creates html = 'x'.repeat(maxEnd + 100)
    const oldHtmlLen = oldDoc.filing.html.length;
    const newHtmlLen = newDoc.filing.html.length;

    for (const sd of result.sectionDiffs) {
      for (const td of sd.tableDiffs) {
        if (td.sourceMapping.old) {
          expect(td.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(td.sourceMapping.old.end).toBeGreaterThan(td.sourceMapping.old.start);
          expect(td.sourceMapping.old.end).toBeLessThanOrEqual(oldHtmlLen);
        }
        if (td.sourceMapping.new) {
          expect(td.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(td.sourceMapping.new.end).toBeGreaterThan(td.sourceMapping.new.start);
          expect(td.sourceMapping.new.end).toBeLessThanOrEqual(newHtmlLen);
        }
      }
    }
  });

  it('I-DP-3: cell-level source mappings are valid', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable(
          [
            ['Label', 'Value'],
            ['Revenue', '$100'],
          ],
          200,
        ),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable(
          [
            ['Label', 'Value'],
            ['Revenue', '$120'],
          ],
          200,
        ),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    const oldHtmlLen = oldDoc.filing.html.length;
    const newHtmlLen = newDoc.filing.html.length;

    for (const sd of result.sectionDiffs) {
      for (const td of sd.tableDiffs) {
        for (const cd of td.cellDiffs) {
          if (cd.sourceMapping.old) {
            expect(cd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
            expect(cd.sourceMapping.old.end).toBeGreaterThan(cd.sourceMapping.old.start);
            expect(cd.sourceMapping.old.end).toBeLessThanOrEqual(oldHtmlLen);
          }
          if (cd.sourceMapping.new) {
            expect(cd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
            expect(cd.sourceMapping.new.end).toBeGreaterThan(cd.sourceMapping.new.start);
            expect(cd.sourceMapping.new.end).toBeLessThanOrEqual(newHtmlLen);
          }
        }
      }
    }
  });

  it('I-DP-4: paragraph-level source mappings are valid', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Our company operates globally.', 100),
        makeTable(
          [
            ['Region', 'Revenue'],
            ['US', '$50B'],
          ],
          200,
        ),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Our company operates in many countries.', 100),
        makeTable(
          [
            ['Region', 'Revenue'],
            ['US', '$60B'],
          ],
          200,
        ),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    const oldHtmlLen = oldDoc.filing.html.length;
    const newHtmlLen = newDoc.filing.html.length;

    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old) {
          expect(pd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.old.end).toBeGreaterThan(pd.sourceMapping.old.start);
          expect(pd.sourceMapping.old.end).toBeLessThanOrEqual(oldHtmlLen);
        }
        if (pd.sourceMapping.new) {
          expect(pd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(pd.sourceMapping.new.end).toBeGreaterThan(pd.sourceMapping.new.start);
          expect(pd.sourceMapping.new.end).toBeLessThanOrEqual(newHtmlLen);
        }
      }
    }
  });

  it('I-DP-5: metadata references are preserved through pipeline', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Text', 100),
        makeTable([['A', 'B']], 200),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Text updated', 100),
        makeTable([['A', 'C']], 200),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);

    // Reference equality — diffFilings passes through the filing objects
    expect(result.oldFiling).toBe(oldDoc.filing);
    expect(result.newFiling).toBe(newDoc.filing);

    // Metadata fields are accessible
    expect(result.oldFiling.accessionNumber).toBeDefined();
    expect(result.oldFiling.cik).toBeDefined();
    expect(result.oldFiling.formType).toBeDefined();
    expect(result.oldFiling.filingDate).toBeDefined();
    expect(result.newFiling.accessionNumber).toBeDefined();
    expect(result.newFiling.cik).toBeDefined();
    expect(result.newFiling.formType).toBeDefined();
    expect(result.newFiling.filingDate).toBeDefined();
  });
});
