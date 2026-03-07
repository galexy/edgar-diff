import { describe, it, expect } from 'vitest';
import { generateTablePair, generateTableListPair } from './table-diff-generator.js';
import type { GeneratedTablePair, GeneratedTableListPair } from './table-diff-generator.js';
import { diffTable, diffTables } from '../../src/diff/table-differ.js';
import { matchTables } from '../../src/diff/table-matcher.js';
import type { TableDiff } from '../../src/diff/types.js';

// ============================================================
// Property-based tests: table diff structural invariants
//
// Each iteration generates random table pairs with controlled
// mutations and verifies structural properties of the diffs.
// ============================================================

const TABLE_DIFF_TEST_COUNT = Number(process.env['TABLE_DIFF_TEST_COUNT'] ?? 200);

// ── Pre-generate all test cases ──

interface LabeledTablePair {
  label: string;
  pair: GeneratedTablePair;
}

interface LabeledTableListPair {
  label: string;
  listPair: GeneratedTableListPair;
}

function generatePairCases(
  mutation: GeneratedTablePair['mutation']['type'],
  count: number,
): LabeledTablePair[] {
  return Array.from({ length: count }, (_, i) => {
    const pair = generateTablePair(mutation);
    const label = `#${i} (${pair.oldTable.rows.length}→${pair.newTable.rows.length} rows)`;
    return { label, pair };
  });
}

function generateListCases(
  scenario: GeneratedTableListPair['scenario']['type'],
  count: number,
): LabeledTableListPair[] {
  return Array.from({ length: count }, (_, i) => {
    const listPair = generateTableListPair(scenario);
    const label = `#${i} (${listPair.oldTables.length}→${listPair.newTables.length} tables)`;
    return { label, listPair };
  });
}

// ── AC-2: Cell-by-cell diffs for matched tables ──

const cellValueCases = generatePairCases('cell-values', TABLE_DIFF_TEST_COUNT);
const noneCases = generatePairCases('none', TABLE_DIFF_TEST_COUNT);

describe('AC-2: cell diff correctness on value mutations', () => {
  it.each(cellValueCases)(
    'cell-values $label: cell diff properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'modified' (cells were mutated)
      expect(diff.changeType).toBe('modified');

      // P2: at least one cell changed
      expect(diff.summary.cellsChanged).toBeGreaterThanOrEqual(1);

      // P3: Every cellDiff with changeType 'modified' has both oldValue and newValue
      for (const cd of diff.cellDiffs) {
        if (cd.changeType === 'modified') {
          expect(cd.oldValue).toBeDefined();
          expect(cd.newValue).toBeDefined();
        }
      }

      // P4: cellDiff row/col indices within bounds
      const maxRows = Math.max(pair.oldTable.rows.length, pair.newTable.rows.length);
      for (const cd of diff.cellDiffs) {
        expect(cd.row).toBeGreaterThanOrEqual(0);
        expect(cd.row).toBeLessThan(maxRows);
        expect(cd.col).toBeGreaterThanOrEqual(0);
      }

      // P6: summary.rowsModified counts match rows containing changed cells
      const modifiedRowDiffs = diff.rowDiffs.filter(rd => rd.changeType === 'modified');
      expect(diff.summary.rowsModified).toBe(modifiedRowDiffs.length);
    },
  );
});

describe('AC-2: identical tables produce unchanged diff', () => {
  it.each(noneCases)(
    'none $label: unchanged properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'unchanged'
      expect(diff.changeType).toBe('unchanged');

      // P2: no cells changed
      expect(diff.summary.cellsChanged).toBe(0);

      // P3: all rowDiffs have changeType 'unchanged'
      for (const rd of diff.rowDiffs) {
        expect(rd.changeType).toBe('unchanged');
      }

      // P4: cellDiffs flat list is empty
      expect(diff.cellDiffs).toHaveLength(0);
    },
  );
});

// ── AC-3: Added and removed rows ──

const addRowCases = generatePairCases('add-rows', TABLE_DIFF_TEST_COUNT);
const removeRowCases = generatePairCases('remove-rows', TABLE_DIFF_TEST_COUNT);

describe('AC-3: row addition detection', () => {
  it.each(addRowCases)(
    'add-rows $label: row addition properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'modified'
      expect(diff.changeType).toBe('modified');

      // P2: at least one row added
      expect(diff.summary.rowsAdded).toBeGreaterThanOrEqual(1);

      // P3: added RowDiffs have newRowIndex set, oldRowIndex undefined
      const addedRows = diff.rowDiffs.filter(rd => rd.changeType === 'added');
      for (const rd of addedRows) {
        expect(rd.newRowIndex).toBeDefined();
        expect(rd.oldRowIndex).toBeUndefined();
      }

      // P4: summary counts add up
      const total = diff.summary.rowsAdded + diff.summary.rowsRemoved +
        diff.summary.rowsModified + diff.summary.rowsUnchanged;
      const expectedTotal = Math.max(pair.oldTable.rows.length, pair.newTable.rows.length);
      expect(total).toBe(expectedTotal);
    },
  );
});

describe('AC-3: row removal detection', () => {
  it.each(removeRowCases)(
    'remove-rows $label: row removal properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'modified'
      expect(diff.changeType).toBe('modified');

      // P2: at least one row removed
      expect(diff.summary.rowsRemoved).toBeGreaterThanOrEqual(1);

      // P3: removed RowDiffs have oldRowIndex set, newRowIndex undefined
      const removedRows = diff.rowDiffs.filter(rd => rd.changeType === 'removed');
      for (const rd of removedRows) {
        expect(rd.oldRowIndex).toBeDefined();
        expect(rd.newRowIndex).toBeUndefined();
      }
    },
  );
});

// ── AC-4: Added and removed columns ──

const addColCases = generatePairCases('add-columns', TABLE_DIFF_TEST_COUNT);
const removeColCases = generatePairCases('remove-columns', TABLE_DIFF_TEST_COUNT);

describe('AC-4: column addition detection', () => {
  it.each(addColCases)(
    'add-columns $label: column addition properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'modified'
      expect(diff.changeType).toBe('modified');

      // P2: cellDiffs contain entries with changeType 'added'
      const addedCells = diff.cellDiffs.filter(cd => cd.changeType === 'added');
      expect(addedCells.length).toBeGreaterThan(0);

      // P3: Added cellDiffs have newValue set, oldValue undefined
      for (const cd of addedCells) {
        expect(cd.newValue).toBeDefined();
        expect(cd.oldValue).toBeUndefined();
      }
    },
  );
});

describe('AC-4: column removal detection', () => {
  it.each(removeColCases)(
    'remove-columns $label: column removal properties hold',
    ({ pair }) => {
      const diff = diffTable(pair.oldTable, pair.newTable);

      // P1: changeType is 'modified'
      expect(diff.changeType).toBe('modified');

      // P2: cellDiffs contain entries with changeType 'removed'
      const removedCells = diff.cellDiffs.filter(cd => cd.changeType === 'removed');
      expect(removedCells.length).toBeGreaterThan(0);

      // P3: Removed cellDiffs have oldValue set, newValue undefined
      for (const cd of removedCells) {
        expect(cd.oldValue).toBeDefined();
        expect(cd.newValue).toBeUndefined();
      }
    },
  );
});

// ── AC-1: Table matching invariants ──

const matchedListCases = generateListCases('matched', TABLE_DIFF_TEST_COUNT);
const shiftedListCases = generateListCases('shifted', TABLE_DIFF_TEST_COUNT);
const addedListCases = generateListCases('added', TABLE_DIFF_TEST_COUNT);
const removedListCases = generateListCases('removed', TABLE_DIFF_TEST_COUNT);

describe('AC-1: table matching invariants', () => {
  it.each(matchedListCases)(
    'matched $label: matching invariants hold',
    ({ listPair }) => {
      const result = matchTables(listPair.oldTables, listPair.newTables);

      // P2: matched + added = new tables count
      expect(result.matched.length + result.added.length).toBe(listPair.newTables.length);

      // P3: matched + removed = old tables count
      expect(result.matched.length + result.removed.length).toBe(listPair.oldTables.length);

      // P4: No table appears in both matched and added/removed
      const matchedNewTables = new Set(result.matched.map(m => m.newTable));
      for (const t of result.added) {
        expect(matchedNewTables.has(t)).toBe(false);
      }
    },
  );

  it.each(shiftedListCases)(
    'shifted $label: shifted matching works',
    ({ listPair }) => {
      const result = matchTables(listPair.oldTables, listPair.newTables);

      // P2/P3: counts are consistent
      expect(result.matched.length + result.added.length).toBe(listPair.newTables.length);
      expect(result.matched.length + result.removed.length).toBe(listPair.oldTables.length);
    },
  );
});

// ── AC-5: Added table detection ──

describe('AC-5: added table detection', () => {
  it.each(addedListCases)(
    'added $label: added table properties hold',
    ({ listPair }) => {
      const diffs = diffTables(listPair.oldTables, listPair.newTables);

      // P1: At least one TableDiff with changeType 'added'
      const addedDiffs = diffs.filter(d => d.changeType === 'added');
      expect(addedDiffs.length).toBeGreaterThanOrEqual(1);

      // P2: Added TableDiffs have newTable set, oldTable undefined
      for (const d of addedDiffs) {
        expect(d.newTable).toBeDefined();
        expect(d.oldTable).toBeUndefined();
      }

      // P3: Added TableDiffs have empty rowDiffs and cellDiffs
      for (const d of addedDiffs) {
        expect(d.rowDiffs).toHaveLength(0);
        expect(d.cellDiffs).toHaveLength(0);
      }
    },
  );
});

// ── AC-6: Removed table detection ──

describe('AC-6: removed table detection', () => {
  it.each(removedListCases)(
    'removed $label: removed table properties hold',
    ({ listPair }) => {
      const diffs = diffTables(listPair.oldTables, listPair.newTables);

      // P1: At least one TableDiff with changeType 'removed'
      const removedDiffs = diffs.filter(d => d.changeType === 'removed');
      expect(removedDiffs.length).toBeGreaterThanOrEqual(1);

      // P2: Removed TableDiffs have oldTable set, newTable undefined
      for (const d of removedDiffs) {
        expect(d.oldTable).toBeDefined();
        expect(d.newTable).toBeUndefined();
      }

      // P3: Removed TableDiffs have empty rowDiffs and cellDiffs
      for (const d of removedDiffs) {
        expect(d.rowDiffs).toHaveLength(0);
        expect(d.cellDiffs).toHaveLength(0);
      }
    },
  );
});

// ── AC-7: Unchanged tables ──

const unchangedListCases = generateListCases('unchanged', TABLE_DIFF_TEST_COUNT);

describe('AC-7: unchanged table detection', () => {
  it.each(unchangedListCases)(
    'unchanged $label: unchanged table properties hold',
    ({ listPair }) => {
      const diffs = diffTables(listPair.oldTables, listPair.newTables);

      // P1: All TableDiffs have changeType 'unchanged'
      for (const d of diffs) {
        expect(d.changeType).toBe('unchanged');
      }

      // P2: sourceMapping.old and sourceMapping.new are both populated
      for (const d of diffs) {
        expect(d.sourceMapping.old).toBeDefined();
        expect(d.sourceMapping.new).toBeDefined();
      }

      // P3: All summary.cellsChanged are 0
      for (const d of diffs) {
        expect(d.summary.cellsChanged).toBe(0);
      }
    },
  );
});

// ── Structural invariants (all mutations) ──

const allMutationTypes: GeneratedTablePair['mutation']['type'][] = [
  'none', 'cell-values', 'add-rows', 'remove-rows', 'add-columns', 'remove-columns', 'mixed',
];

const structuralCases: LabeledTablePair[] = Array.from(
  { length: TABLE_DIFF_TEST_COUNT },
  (_, i) => {
    const mutation = allMutationTypes[i % allMutationTypes.length];
    const pair = generateTablePair(mutation);
    const label = `#${i} ${mutation} (${pair.oldTable.rows.length}→${pair.newTable.rows.length} rows)`;
    return { label, pair };
  },
);

describe('structural invariants hold for any table pair', () => {
  it.each(structuralCases)(
    'structural $label: invariants hold',
    ({ pair }) => {
      // P1: diffTable never throws
      let diff: TableDiff;
      expect(() => { diff = diffTable(pair.oldTable, pair.newTable); }).not.toThrow();
      diff = diffTable(pair.oldTable, pair.newTable);

      // P3: summary counts are internally consistent
      const total = diff.summary.rowsAdded + diff.summary.rowsRemoved +
        diff.summary.rowsModified + diff.summary.rowsUnchanged;
      const expectedTotal = Math.max(pair.oldTable.rows.length, pair.newTable.rows.length);
      expect(total).toBe(expectedTotal);

      // P4: cellDiffs flat list === flatMap of rowDiffs[].cellDiffs
      const flatFromRows = diff.rowDiffs.flatMap(rd => rd.cellDiffs);
      expect(diff.cellDiffs).toEqual(flatFromRows);

      // P5: changeType is 'unchanged' iff summary.cellsChanged === 0
      if (diff.summary.cellsChanged === 0 &&
          diff.summary.rowsAdded === 0 &&
          diff.summary.rowsRemoved === 0) {
        expect(diff.changeType).toBe('unchanged');
      }
      if (diff.changeType === 'unchanged') {
        expect(diff.summary.cellsChanged).toBe(0);
      }

      // P6: All sourceMapping offsets valid where present
      if (diff.sourceMapping.old) {
        expect(diff.sourceMapping.old.start).toBeLessThan(diff.sourceMapping.old.end);
      }
      if (diff.sourceMapping.new) {
        expect(diff.sourceMapping.new.start).toBeLessThan(diff.sourceMapping.new.end);
      }
    },
  );
});
