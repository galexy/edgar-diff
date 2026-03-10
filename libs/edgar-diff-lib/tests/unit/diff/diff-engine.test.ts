import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { buildSummary, diffFilings } from '../../../src/diff/diff-engine.js';
import type { SectionDiff } from '../../../src/diff/types.js';
import {
  makeDocumentPair,
} from '../../helpers/diff-helpers.js';
import {
  makeParagraph,
  makeTable,
  makeSection,
  makeStructuredDoc,
} from '../../helpers/diff-fixtures.js';

function makeSectionDiffStub(changeType: SectionDiff['changeType']): SectionDiff {
  return {
    id: 'test',
    heading: 'Test',
    changeType,
    paragraphDiffs: [],
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping: {},
  };
}

describe('buildSummary', () => {
  it('U-BS-1: all unchanged => unchanged: N, others 0', () => {
    const diffs = [makeSectionDiffStub('unchanged'), makeSectionDiffStub('unchanged')];
    const summary = buildSummary(diffs);
    expect(summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2, reordered: 0 });
  });

  it('U-BS-2: mixed changes => counts match each changeType', () => {
    const diffs = [
      makeSectionDiffStub('added'),
      makeSectionDiffStub('removed'),
      makeSectionDiffStub('modified'),
      makeSectionDiffStub('unchanged'),
      makeSectionDiffStub('reordered'),
    ];
    const summary = buildSummary(diffs);
    expect(summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1, reordered: 1 });
  });

  it('U-BS-3: empty sectionDiffs => all zeros', () => {
    expect(buildSummary([])).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 0, reordered: 0 });
  });

  it('U-BS-4: only added => added: N, all others 0', () => {
    const diffs = [makeSectionDiffStub('added'), makeSectionDiffStub('added')];
    expect(buildSummary(diffs)).toEqual({ added: 2, removed: 0, modified: 0, unchanged: 0, reordered: 0 });
  });

  it('U-BS-5: only removed => removed: N, all others 0', () => {
    const diffs = [makeSectionDiffStub('removed'), makeSectionDiffStub('removed'), makeSectionDiffStub('removed')];
    expect(buildSummary(diffs)).toEqual({ added: 0, removed: 3, modified: 0, unchanged: 0, reordered: 0 });
  });
});

describe('diffFilings', () => {
  it('U-DF-1: returns valid StructuredDiff shape', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [{ id: 'item-1', heading: 'Item 1. Business', content: 'text' }],
      [{ id: 'item-1', heading: 'Item 1. Business', content: 'text' }],
    );
    const result = diffFilings(oldDoc, newDoc);
    expect(result).toHaveProperty('oldFiling');
    expect(result).toHaveProperty('newFiling');
    expect(result).toHaveProperty('sectionDiffs');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('generatedAt');
  });

  it('U-DF-2: oldFiling and newFiling reference input documents', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [{ id: 'item-1', heading: 'Item 1', content: 'a' }],
      [{ id: 'item-1', heading: 'Item 1', content: 'b' }],
    );
    const result = diffFilings(oldDoc, newDoc);
    expect(result.oldFiling).toBe(oldDoc.filing);
    expect(result.newFiling).toBe(newDoc.filing);
  });

  it('U-DF-3: generatedAt is a valid Temporal.Instant', () => {
    const { oldDoc, newDoc } = makeDocumentPair([], []);
    const result = diffFilings(oldDoc, newDoc);
    expect(result.generatedAt).toBeInstanceOf(Temporal.Instant);
  });

  it('U-DF-4: sectionDiffs length equals total unique sections', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-2', heading: 'Zebra Appendix Alpha', content: 'b' },
      ],
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-3', heading: 'Quantum Regulations Overview', content: 'c' },
      ],
    );
    const result = diffFilings(oldDoc, newDoc);
    // item-1 matched, item-2 removed, item-3 added = 3 total
    expect(result.sectionDiffs).toHaveLength(3);
  });

  it('U-DF-5: summary counts match actual sectionDiffs', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'same' },
        { id: 'item-2', heading: 'Item 2. Properties', content: 'old content' },
        { id: 'item-3', heading: 'Item 3. Legal', content: 'removed' },
      ],
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'same' },
        { id: 'item-2', heading: 'Item 2. Properties', content: 'new content' },
        { id: 'item-4', heading: 'Item 4. Mine Safety', content: 'added' },
      ],
    );
    const result = diffFilings(oldDoc, newDoc);
    const counts = { added: 0, removed: 0, modified: 0, unchanged: 0, reordered: 0 };
    for (const d of result.sectionDiffs) counts[d.changeType]++;
    expect(result.summary).toEqual(counts);
  });

  it('U-DF-6: matched sections appear in new-filing order', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-2', heading: 'Item 2. Properties', content: 'b' },
        { id: 'item-3', heading: 'Item 3. Legal', content: 'c' },
      ],
      [
        { id: 'item-3', heading: 'Item 3. Legal', content: 'c' },
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-2', heading: 'Item 2. Properties', content: 'b' },
      ],
    );
    const result = diffFilings(oldDoc, newDoc);
    const matchedDiffs = result.sectionDiffs.filter(
      (d) => d.changeType !== 'added' && d.changeType !== 'removed',
    );
    expect(matchedDiffs[0].heading).toBe('Item 3. Legal');
    expect(matchedDiffs[1].heading).toBe('Item 1. Business');
    expect(matchedDiffs[2].heading).toBe('Item 2. Properties');
  });

  it('U-DF-7: added sections appear in new-filing order interleaved with matched', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [{ id: 'item-1', heading: 'Item 1. Business', content: 'a' }],
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-1c', heading: 'Item 1C. Cybersecurity', content: 'new' },
      ],
    );
    const result = diffFilings(oldDoc, newDoc);
    const nonRemoved = result.sectionDiffs.filter((d) => d.changeType !== 'removed');
    expect(nonRemoved[0].heading).toBe('Item 1. Business');
    expect(nonRemoved[1].heading).toBe('Item 1C. Cybersecurity');
    expect(nonRemoved[1].changeType).toBe('added');
  });

  it('U-DF-8: removed sections grouped at end in old-filing order', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'a' },
        { id: 'item-2', heading: 'Item 2. Properties', content: 'b' },
        { id: 'item-3', heading: 'Item 3. Legal', content: 'c' },
      ],
      [{ id: 'item-2', heading: 'Item 2. Properties', content: 'b' }],
    );
    const result = diffFilings(oldDoc, newDoc);
    const removed = result.sectionDiffs.filter((d) => d.changeType === 'removed');
    expect(removed).toHaveLength(2);
    // Removed sections should be at the end
    expect(result.sectionDiffs[result.sectionDiffs.length - 2].changeType).toBe('removed');
    expect(result.sectionDiffs[result.sectionDiffs.length - 1].changeType).toBe('removed');
    // In old-filing order: item-1 before item-3
    expect(removed[0].heading).toBe('Item 1. Business');
    expect(removed[1].heading).toBe('Item 3. Legal');
  });

  it('U-DF-9: mixed scenario produces correct ordering', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'same' },
        { id: 'zebra', heading: 'Zebra Appendix Alpha', content: 'removed' },
        { id: 'item-3', heading: 'Item 3. Legal', content: 'same' },
      ],
      [
        { id: 'item-1', heading: 'Item 1. Business', content: 'same' },
        { id: 'quantum', heading: 'Quantum Regulations Overview', content: 'new' },
        { id: 'item-3', heading: 'Item 3. Legal', content: 'same' },
      ],
    );
    const result = diffFilings(oldDoc, newDoc);
    expect(result.sectionDiffs).toHaveLength(4);
    // New-filing order first: item-1, quantum (added), item-3
    expect(result.sectionDiffs[0].heading).toBe('Item 1. Business');
    expect(result.sectionDiffs[1].heading).toBe('Quantum Regulations Overview');
    expect(result.sectionDiffs[1].changeType).toBe('added');
    expect(result.sectionDiffs[2].heading).toBe('Item 3. Legal');
    // Removed at end
    expect(result.sectionDiffs[3].heading).toBe('Zebra Appendix Alpha');
    expect(result.sectionDiffs[3].changeType).toBe('removed');
  });
});

describe('diffFilings — table behavior', () => {
  it('U-MSD-1: matched sections with tables produce non-empty tableDiffs', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data follows.', 0),
        makeTable([['Revenue', '$100'], ['Income', '$20']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data follows.', 0),
        makeTable([['Revenue', '$120'], ['Income', '$20']], 100),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sectionDiff = result.sectionDiffs[0];
    expect(sectionDiff.tableDiffs.length).toBeGreaterThanOrEqual(1);
  });

  it('U-MSD-2: matched sections with only paragraphs produce empty tableDiffs', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Old paragraph text.', 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('New paragraph text.', 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sectionDiff = result.sectionDiffs[0];
    expect(sectionDiff.tableDiffs).toHaveLength(0);
  });

  it('U-MSD-3: matched sections with identical tables produce unchanged tableDiffs', () => {
    const table = [['Header', 'Value'], ['Row1', '100']];
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable(table, 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable(table, 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sectionDiff = result.sectionDiffs[0];
    expect(sectionDiff.tableDiffs).toHaveLength(1);
    expect(sectionDiff.tableDiffs[0].changeType).toBe('unchanged');
  });

  it('U-MSD-4: added section WITH tables has tableDiffs with changeType added', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing section.', 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing section.', 0),
      ]),
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$100']], 200),
        makeTable([['Assets', '$500']], 300),
      ], 200),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const addedSection = result.sectionDiffs.find(d => d.changeType === 'added');
    expect(addedSection).toBeDefined();
    expect(addedSection!.tableDiffs).toHaveLength(2);
    for (const td of addedSection!.tableDiffs) {
      expect(td.changeType).toBe('added');
      expect(td.newTable).toBeDefined();
      expect(td.oldTable).toBeUndefined();
      expect(td.rowDiffs).toEqual([]);
      expect(td.cellDiffs).toEqual([]);
    }
  });

  it('U-MSD-5: removed section WITH tables has tableDiffs with changeType removed', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing section.', 0),
      ]),
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$100']], 200),
        makeTable([['Assets', '$500']], 300),
      ], 200),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing section.', 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const removedSection = result.sectionDiffs.find(d => d.changeType === 'removed');
    expect(removedSection).toBeDefined();
    expect(removedSection!.tableDiffs).toHaveLength(2);
    for (const td of removedSection!.tableDiffs) {
      expect(td.changeType).toBe('removed');
      expect(td.oldTable).toBeDefined();
      expect(td.newTable).toBeUndefined();
      expect(td.rowDiffs).toEqual([]);
      expect(td.cellDiffs).toEqual([]);
    }
  });

  it('U-MSD-5a: added section WITHOUT tables has tableDiffs = []', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing.', 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing.', 0),
      ]),
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('New section text.', 200),
      ], 200),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const addedSection = result.sectionDiffs.find(d => d.changeType === 'added');
    expect(addedSection).toBeDefined();
    expect(addedSection!.tableDiffs).toHaveLength(0);
  });

  it('U-MSD-5b: removed section WITHOUT tables has tableDiffs = []', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing.', 0),
      ]),
      makeSection('item-2', 'Item 2. Properties', [
        makeParagraph('Old section text.', 200),
      ], 200),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('Existing.', 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const removedSection = result.sectionDiffs.find(d => d.changeType === 'removed');
    expect(removedSection).toBeDefined();
    expect(removedSection!.tableDiffs).toHaveLength(0);
  });

  it('U-MSD-6: mixed content (paragraphs + tables) produces both paragraphDiffs and tableDiffs', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Old financial summary.', 0),
        makeTable([['Revenue', '$100']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('New financial summary.', 0),
        makeTable([['Revenue', '$120']], 100),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.paragraphDiffs.length).toBeGreaterThan(0);
    expect(sd.tableDiffs.length).toBeGreaterThan(0);
  });

  it('U-MSD-7: matched section with table added (0 old, 1 new) has TableDiff changeType added', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data.', 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data.', 0),
        makeTable([['Revenue', '$100']], 100),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.tableDiffs).toHaveLength(1);
    expect(sd.tableDiffs[0].changeType).toBe('added');
  });

  it('U-MSD-8: matched section with table removed (1 old, 0 new) has TableDiff changeType removed', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data.', 0),
        makeTable([['Revenue', '$100']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data.', 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.tableDiffs).toHaveLength(1);
    expect(sd.tableDiffs[0].changeType).toBe('removed');
  });

  it('U-MSD-9: multiple tables in matched section are all diffed', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$100'], ['Costs', '$80']], 0),
        makeTable([['Assets', '$500'], ['Liabilities', '$300']], 200),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$120'], ['Costs', '$80']], 0),
        makeTable([['Assets', '$500'], ['Liabilities', '$300']], 200),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    expect(sd.tableDiffs).toHaveLength(2);
  });

  it('U-MSD-10: mismatched table counts (3 old, 2 new) produces correct mix', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['T1-Header', 'V1']], 0),
        makeTable([['T2-Header', 'V2']], 100),
        makeTable([['T3-Header', 'V3']], 200),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['T1-Header', 'V1']], 0),
        makeTable([['T2-Header', 'V2-changed']], 100),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const sd = result.sectionDiffs[0];
    // Should have entries for all tables: matched + removed
    expect(sd.tableDiffs.length).toBeGreaterThanOrEqual(2);
    const removed = sd.tableDiffs.filter(td => td.changeType === 'removed');
    expect(removed.length).toBeGreaterThanOrEqual(1);
  });
});

describe('JSON serialization', () => {
  it('U-JSON-1: Temporal.Instant serializes to ISO 8601 string via native toJSON()', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [{ id: 'item-1', heading: 'Item 1. Business', content: 'text' }],
      [{ id: 'item-1', heading: 'Item 1. Business', content: 'text' }],
    );
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.parse(JSON.stringify(result));
    expect(typeof json.generatedAt).toBe('string');
    // ISO 8601 pattern: starts with a year, has T separator
    expect(json.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('U-JSON-2: Temporal.PlainDate serializes to YYYY-MM-DD string via native toJSON()', () => {
    const { oldDoc, newDoc } = makeDocumentPair(
      [{ id: 'item-1', heading: 'Item 1', content: 'a' }],
      [{ id: 'item-1', heading: 'Item 1', content: 'a' }],
    );
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.parse(JSON.stringify(result));
    expect(json.oldFiling.filingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.newFiling.filingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('U-JSON-3: full StructuredDiff round-trips through JSON without data loss', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Financial data.', 0),
        makeTable([['Revenue', '$100'], ['Income', '$20']], 100),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeParagraph('Updated financial data.', 0),
        makeTable([['Revenue', '$120'], ['Income', '$20']], 100),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.parse(JSON.stringify(result));
    expect(json.sectionDiffs).toHaveLength(result.sectionDiffs.length);
    expect(json.summary).toEqual(result.summary);
    expect(json.sectionDiffs[0].tableDiffs.length).toBe(result.sectionDiffs[0].tableDiffs.length);
  });

  it('U-JSON-4: tableDiffs within sectionDiffs survive JSON round-trip', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$100']], 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-8', 'Item 8. Financial Statements', [
        makeTable([['Revenue', '$120']], 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.parse(JSON.stringify(result));
    const td = json.sectionDiffs[0].tableDiffs[0];
    expect(td.changeType).toBe('modified');
    expect(td.summary).toBeDefined();
    expect(td.summary.cellsChanged).toBeGreaterThan(0);
    // cellDiffs retain oldValue/newValue
    expect(td.cellDiffs.length).toBeGreaterThan(0);
    expect(td.cellDiffs[0].oldValue).toBeDefined();
    expect(td.cellDiffs[0].newValue).toBeDefined();
  });

  it('U-JSON-5: paragraphDiffs with wordChanges survive JSON round-trip', () => {
    const oldDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('The company is growing.', 0),
      ]),
    ]);
    const newDoc = makeStructuredDoc([
      makeSection('item-1', 'Item 1. Business', [
        makeParagraph('The company is shrinking.', 0),
      ]),
    ]);
    const result = diffFilings(oldDoc, newDoc);
    const json = JSON.parse(JSON.stringify(result));
    const pd = json.sectionDiffs[0].paragraphDiffs[0];
    expect(pd.wordChanges).toBeDefined();
    expect(pd.wordChanges.length).toBeGreaterThan(0);
    const hasTypeAndValue = pd.wordChanges.every(
      (wc: { type: string; value: string }) => typeof wc.type === 'string' && typeof wc.value === 'string',
    );
    expect(hasTypeAndValue).toBe(true);
  });
});
