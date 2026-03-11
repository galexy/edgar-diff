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

    // DiffFilingMetadata — value equality (no longer reference equality), no html
    expect(result.oldFiling.accessionNumber).toBe(oldDoc.filing.accessionNumber);
    expect(result.oldFiling.cik).toBe(oldDoc.filing.cik);
    expect(result.newFiling.accessionNumber).toBe(newDoc.filing.accessionNumber);
    expect(result.newFiling.cik).toBe(newDoc.filing.cik);
    expect('html' in result.oldFiling).toBe(false);
    expect('html' in result.newFiling).toBe(false);

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

  it('I-DP-6: diffFilings with multi-section documents containing tables', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Business overview.', 100),
        makeTable([['Metric', 'Value'], ['Employees', '10000']], 200),
      ]),
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('We own several properties.', 400),
      ]),
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('See accompanying notes.', 600),
        makeTable([['Year', 'Revenue'], ['2023', '$100B']], 700),
        makeTable([['Year', 'Expenses'], ['2023', '$80B']], 900),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Updated business overview.', 100),
        makeTable([['Metric', 'Value'], ['Employees', '12000']], 200),
      ]),
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('We own many properties.', 400),
      ]),
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('See accompanying notes.', 600),
        makeTable([['Year', 'Revenue'], ['2024', '$120B']], 700),
        makeTable([['Year', 'Expenses'], ['2024', '$90B']], 900),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);

    // All 3 sections matched
    expect(result.sectionDiffs).toHaveLength(3);

    // item-1 has 1 table → tableDiffs populated
    const item1 = result.sectionDiffs.find((d) => d.id === 'item-1')!;
    expect(item1.tableDiffs.length).toBeGreaterThan(0);

    // item-2 is paragraph-only → tableDiffs empty
    const item2 = result.sectionDiffs.find((d) => d.id === 'item-2')!;
    expect(item2.tableDiffs).toHaveLength(0);

    // item-8 has 2 tables → tableDiffs populated
    const item8 = result.sectionDiffs.find((d) => d.id === 'item-8')!;
    expect(item8.tableDiffs.length).toBeGreaterThanOrEqual(2);

    // BQ6: Verify unchanged paragraphs/tables are filtered from output
    for (const sd of result.sectionDiffs) {
      for (const pd of sd.paragraphDiffs) {
        expect(pd.changeType).not.toBe('unchanged');
      }
      for (const td of sd.tableDiffs) {
        expect(td.changeType).not.toBe('unchanged');
      }
    }
  });

  it('I-DP-7: diffFilings with added and removed sections containing tables', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('zebra', 'Zebra Appendix Alpha', [
        makeParagraph('Content A.', 100),
        makeTable([['A1', 'A2'], ['a', 'b']], 200),
        makeTable([['A3', 'A4'], ['c', 'd']], 400),
      ]),
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('Content B.', 600),
        makeTable([['B1', 'B2'], ['e', 'f']], 700),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('Content B updated.', 600),
        makeTable([['B1', 'B2'], ['e', 'g']], 700),
      ]),
      makeSection('quantum', 'Quantum Regulations Overview', [
        makeParagraph('New content C.', 900),
        makeTable([['C1', 'C2'], ['h', 'i']], 1000),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);

    // zebra removed → tableDiffs has 2 entries, each changeType 'removed'
    const zebraSection = result.sectionDiffs.find((d) => d.id === 'zebra')!;
    expect(zebraSection).toBeDefined();
    expect(zebraSection.changeType).toBe('removed');
    expect(zebraSection.tableDiffs).toHaveLength(2);
    for (const td of zebraSection.tableDiffs) {
      expect(td.changeType).toBe('removed');
      expect('oldTable' in td).toBe(false);
      expect('newTable' in td).toBe(false);
      expect(td.sourceMapping.old).toBeDefined();
    }

    // quantum added → tableDiffs has 1 entry with changeType 'added'
    const quantumSection = result.sectionDiffs.find((d) => d.id === 'quantum')!;
    expect(quantumSection).toBeDefined();
    expect(quantumSection.changeType).toBe('added');
    expect(quantumSection.tableDiffs).toHaveLength(1);
    expect(quantumSection.tableDiffs[0].changeType).toBe('added');
    expect('newTable' in quantumSection.tableDiffs[0]).toBe(false);
    expect('oldTable' in quantumSection.tableDiffs[0]).toBe(false);
    expect(quantumSection.tableDiffs[0].sourceMapping.new).toBeDefined();

    // item-2 matched → tableDiffs computed via diffTables()
    const item2 = result.sectionDiffs.find((d) => d.id === 'item-2')!;
    expect(item2).toBeDefined();
    expect(['unchanged', 'modified'].includes(item2.changeType)).toBe(true);
    expect(item2.tableDiffs.length).toBeGreaterThan(0);
  });

  it('I-DP-8: added/removed table stubs have lightweight structure', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('zebra', 'Zebra Appendix Alpha', [
        makeTable([['X', 'Y'], ['1', '2']], 100),
      ]),
    ]);

    const newDoc = makeStructuredDoc([
      makeSection('quantum', 'Quantum Regulations Overview', [
        makeTable([['P', 'Q'], ['3', '4']], 100),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);

    // Removed section table stubs
    const removedSection = result.sectionDiffs.find((d) => d.changeType === 'removed')!;
    expect(removedSection).toBeDefined();
    for (const td of removedSection.tableDiffs) {
      expect(td.changeType).toBe('removed');
      expect('oldTable' in td).toBe(false);
      expect('newTable' in td).toBe(false);
      expect(td.rowDiffs).toEqual([]);
      expect(td.cellDiffs).toEqual([]);
      expect(td.summary).toEqual({
        rowsAdded: 0,
        rowsRemoved: 0,
        rowsModified: 0,
        rowsUnchanged: 0,
        cellsChanged: 0,
      });
      expect(td.sourceMapping.old).toBeDefined();
      expect(td.sourceMapping.new).toBeUndefined();
    }

    // Added section table stubs
    const addedSection = result.sectionDiffs.find((d) => d.changeType === 'added')!;
    expect(addedSection).toBeDefined();
    for (const td of addedSection.tableDiffs) {
      expect(td.changeType).toBe('added');
      expect('oldTable' in td).toBe(false);
      expect('newTable' in td).toBe(false);
      expect(td.rowDiffs).toEqual([]);
      expect(td.cellDiffs).toEqual([]);
      expect(td.summary).toEqual({
        rowsAdded: 0,
        rowsRemoved: 0,
        rowsModified: 0,
        rowsUnchanged: 0,
        cellsChanged: 0,
      });
      expect(td.sourceMapping.new).toBeDefined();
      expect(td.sourceMapping.old).toBeUndefined();
    }
  });
});

describe('boundary conditions — structured diff', () => {
  it('B-1: section with 0 tables → tableDiffs = []', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeParagraph('Text old.', 100)]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeParagraph('Text new.', 100)]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs[0].tableDiffs).toEqual([]);
  });

  it('B-2: section with 0 paragraphs but tables → paragraphDiffs = [], tableDiffs populated', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8', [
        makeTable([['A', 'B'], ['1', '2']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8', [
        makeTable([['A', 'B'], ['1', '3']], 100),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.paragraphDiffs).toEqual([]);
    expect(sd.tableDiffs.length).toBeGreaterThan(0);
  });

  it('B-3: section with many tables (10+) → all are diffed', () => {
    const tables = Array.from({ length: 10 }, (_, i) =>
      makeTable([['Key', 'Val'], [`row-${i}`, `${i}`]], 100 + i * 100),
    );
    const oldDoc = makeStructuredDoc([makeSection('item-8', 'Item 8', tables)]);
    const newDoc = makeStructuredDoc([makeSection('item-8', 'Item 8', tables)]);

    const result = diffFilings(oldDoc, newDoc);
    // BQ6: identical tables are all unchanged → all filtered from output
    expect(result.sectionDiffs[0].tableDiffs).toHaveLength(0);
    expect(result.sectionDiffs[0].changeType).toBe('unchanged');
  });

  it('B-4: section with single-cell table → tableDiffs produced', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeTable([['Only cell']], 100)]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeTable([['Updated cell']], 100)]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs[0].tableDiffs.length).toBeGreaterThan(0);
  });

  it('B-5: empty sections (no blocks) → empty diffs', () => {
    const oldDoc = makeStructuredDoc([makeSection('item-1', 'Item 1', [])]);
    const newDoc = makeStructuredDoc([makeSection('item-1', 'Item 1', [])]);

    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.paragraphDiffs).toEqual([]);
    expect(sd.tableDiffs).toEqual([]);
  });

  it('B-6: both documents empty (no sections) → empty result', () => {
    const oldDoc = makeStructuredDoc([]);
    const newDoc = makeStructuredDoc([]);

    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs).toEqual([]);
    expect(result.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
      reordered: 0,
    });
  });

  it('B-7: one document empty, other has sections with tables', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [
        makeTable([['A', 'B'], ['1', '2']], 100),
      ]),
      makeSection('item-2', 'Item 2', [
        makeTable([['C', 'D'], ['3', '4']], 300),
      ]),
    ]);
    const newDoc = makeStructuredDoc([]);

    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs).toHaveLength(2);
    for (const sd of result.sectionDiffs) {
      expect(sd.changeType).toBe('removed');
      expect(sd.tableDiffs.length).toBeGreaterThan(0);
      for (const td of sd.tableDiffs) {
        expect(td.changeType).toBe('removed');
      }
    }
  });

  it('B-8: very large section (many paragraphs + many tables) completes', () => {
    const blocks = [];
    for (let i = 0; i < 50; i++) {
      blocks.push(makeParagraph(`Paragraph number ${i} with some content.`, 100 + i * 200));
    }
    for (let i = 0; i < 20; i++) {
      blocks.push(
        makeTable(
          [['Header', 'Value'], [`Row-${i}`, `${i * 100}`]],
          100 + 50 * 200 + i * 100,
        ),
      );
    }

    const oldDoc = makeStructuredDoc([makeSection('item-8', 'Item 8', blocks)]);

    // Slightly modified version
    const newBlocks = [];
    for (let i = 0; i < 50; i++) {
      newBlocks.push(makeParagraph(`Paragraph number ${i} updated content.`, 100 + i * 200));
    }
    for (let i = 0; i < 20; i++) {
      newBlocks.push(
        makeTable(
          [['Header', 'Value'], [`Row-${i}`, `${i * 100 + 1}`]],
          100 + 50 * 200 + i * 100,
        ),
      );
    }
    const newDoc = makeStructuredDoc([makeSection('item-8', 'Item 8', newBlocks)]);

    // Should complete without timeout or error
    expect(() => diffFilings(oldDoc, newDoc)).not.toThrow();
  });
});

describe('error conditions — structured diff', () => {
  it('E-1: section with empty table (0 rows) produces valid tableDiff', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeTable([], 100)]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [makeTable([], 100)]),
    ]);

    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs[0].tableDiffs.length).toBeGreaterThanOrEqual(0);
    // Should not throw
  });

  it('E-2: section with irregular row lengths handled gracefully', () => {
    // Tables with different cell counts per row — grid normalizer pads
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [
        makeTable([['A', 'B', 'C'], ['1', '2']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1', [
        makeTable([['A', 'B', 'C'], ['1', '2', '3']], 100),
      ]),
    ]);

    expect(() => diffFilings(oldDoc, newDoc)).not.toThrow();
    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs[0].tableDiffs.length).toBeGreaterThan(0);
  });

  it('E-3: section with empty blocks array defaults gracefully', () => {
    const oldDoc = makeStructuredDoc([makeSection('item-1', 'Item 1', [])]);
    const newDoc = makeStructuredDoc([makeSection('item-1', 'Item 1', [])]);

    expect(() => diffFilings(oldDoc, newDoc)).not.toThrow();
    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs[0].tableDiffs).toEqual([]);
    expect(result.sectionDiffs[0].paragraphDiffs).toEqual([]);
  });

  it('E-4: StructuredDiff with no matched sections — added/removed get table stubs', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('zebra', 'Zebra Appendix Alpha', [
        makeTable([['X', 'Y']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('quantum', 'Quantum Regulations Overview', [
        makeTable([['P', 'Q']], 100),
      ]),
    ]);

    const result = diffFilings(oldDoc, newDoc);

    const addedSections = result.sectionDiffs.filter((d) => d.changeType === 'added');
    const removedSections = result.sectionDiffs.filter((d) => d.changeType === 'removed');

    expect(addedSections.length).toBeGreaterThan(0);
    expect(removedSections.length).toBeGreaterThan(0);

    for (const sd of addedSections) {
      for (const td of sd.tableDiffs) {
        expect(td.changeType).toBe('added');
      }
    }
    for (const sd of removedSections) {
      for (const td of sd.tableDiffs) {
        expect(td.changeType).toBe('removed');
      }
    }
  });

  it('E-5: diffFilings never throws for valid StructuredDocument inputs', () => {
    // Fuzz with variety of section/block combinations
    const configs = [
      { blocks: [] },
      { blocks: [makeParagraph('text', 100)] },
      { blocks: [makeTable([['a']], 100)] },
      { blocks: [makeParagraph('t', 100), makeTable([['a', 'b']], 200)] },
      { blocks: [makeTable([['a']], 100), makeTable([['b']], 200), makeParagraph('t', 300)] },
    ];

    for (const oldConfig of configs) {
      for (const newConfig of configs) {
        const oldDoc = makeStructuredDoc([makeSection('s1', 'Section 1', oldConfig.blocks)]);
        const newDoc = makeStructuredDoc([makeSection('s1', 'Section 1', newConfig.blocks)]);
        expect(() => diffFilings(oldDoc, newDoc)).not.toThrow();
      }
    }
  });
});
