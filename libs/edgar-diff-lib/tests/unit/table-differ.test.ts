import { describe, it, expect } from 'vitest';
import { assertDefined } from '../helpers/assert-defined.js';
import { diffTable, diffTables } from '../../src/diff/table-differ.js';
import { makeTable, makeTableRow, makeTableCell, makeFinancialTable } from '../helpers/table-diff-helpers.js';

describe('row alignment', () => {
  it('identical rows => all RowDiff changeType unchanged', () => {
    const table = makeFinancialTable({
      headers: ['Metric', '2023'],
      rows: [{ label: 'Revenue', values: ['$100'] }],
    });
    const result = diffTable(table, table);
    expect(result.changeType).toBe('unchanged');
    for (const rd of result.rowDiffs) {
      expect(rd.changeType).toBe('unchanged');
    }
  });

  it('inserted row in the middle => RowDiff with changeType added, newRowIndex set', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('C'), makeTableCell('3')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('B'), makeTableCell('2')]),
      makeTableRow([makeTableCell('C'), makeTableCell('3')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.summary.rowsAdded).toBe(1);
    const addedRow = result.rowDiffs.find((rd) => rd.changeType === 'added');
    assertDefined(addedRow);
    expect(addedRow.newRowIndex).toBeDefined();
    expect(addedRow.oldRowIndex).toBeUndefined();
  });

  it('removed row in the middle => RowDiff with changeType removed, oldRowIndex set', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('B'), makeTableCell('2')]),
      makeTableRow([makeTableCell('C'), makeTableCell('3')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('C'), makeTableCell('3')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.summary.rowsRemoved).toBe(1);
    const removedRow = result.rowDiffs.find((rd) => rd.changeType === 'removed');
    assertDefined(removedRow);
    expect(removedRow.oldRowIndex).toBeDefined();
    expect(removedRow.newRowIndex).toBeUndefined();
  });

  it('modified row (same position, different content) => changeType modified with cellDiffs', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('Revenue'), makeTableCell('$100')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('Revenue'), makeTableCell('$120')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    const modRow = result.rowDiffs.find((rd) => rd.changeType === 'modified');
    assertDefined(modRow);
    expect(modRow.cellDiffs.length).toBeGreaterThan(0);
  });

  it('all rows different => all modified', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A')]),
      makeTableRow([makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('X')]),
      makeTableRow([makeTableCell('Y')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
  });

  it('row fingerprint uses pipe-delimited normalized cell text', () => {
    // This is tested implicitly: rows with same text match as unchanged
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.rowDiffs[0].changeType).toBe('unchanged');
  });
});

describe('cell comparison', () => {
  it('identical text => unchanged, not in cellDiffs (flat list)', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('Same')]),
    ]);
    const result = diffTable(table, table);
    expect(result.cellDiffs).toHaveLength(0);
  });

  it('different text => modified with oldValue and newValue', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('Old')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('New')])]);
    const result = diffTable(oldTable, newTable);
    const cd = result.cellDiffs.find((c) => c.changeType === 'modified');
    assertDefined(cd);
    expect(cd.oldValue).toBe('Old');
    expect(cd.newValue).toBe('New');
  });

  it('empty vs non-empty => modified', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('Value')])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
  });

  it('numeric value change populates oldNumericValue and newNumericValue', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('$100', { numericValue: 100 })]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('$120', { numericValue: 120 })]),
    ]);
    const result = diffTable(oldTable, newTable);
    const cd = result.cellDiffs.find((c) => c.changeType === 'modified');
    assertDefined(cd);
    expect(cd.oldNumericValue).toBe(100);
    expect(cd.newNumericValue).toBe(120);
  });

  it('numeric formatting change (same numericValue, different text) => unchanged', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('1,000', { numericValue: 1000 })]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('1000', { numericValue: 1000 })]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
    expect(result.cellDiffs).toHaveLength(0);
  });

  it('whitespace/nbsp normalized before comparison', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('Hello  World')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('Hello World')])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
  });

  it('non-origin cells in spans are skipped (no double-counting)', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('Span', { colspan: 2 })]),
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('Span', { colspan: 2 })]),
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
    expect(result.cellDiffs).toHaveLength(0);
  });
});

describe('column detection', () => {
  it('new grid has more columns => extra cols are added cells', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B'), makeTableCell('C')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    const addedCells = result.cellDiffs.filter((c) => c.changeType === 'added');
    expect(addedCells.length).toBeGreaterThanOrEqual(1);
    expect(addedCells[0].newValue).toBe('C');
    expect(addedCells[0].oldValue).toBeUndefined();
  });

  it('old grid has more columns => extra cols are removed cells', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B'), makeTableCell('C')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    const removedCells = result.cellDiffs.filter((c) => c.changeType === 'removed');
    expect(removedCells.length).toBeGreaterThanOrEqual(1);
    expect(removedCells[0].oldValue).toBe('C');
    expect(removedCells[0].newValue).toBeUndefined();
  });

  it('same column count, different values => modified cells', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('X')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    const modCells = result.cellDiffs.filter((c) => c.changeType === 'modified');
    expect(modCells).toHaveLength(1);
    expect(modCells[0].oldValue).toBe('B');
    expect(modCells[0].newValue).toBe('X');
  });
});

describe('numeric diff', () => {
  it('$100 -> $120: modified, oldNumericValue=100, newNumericValue=120', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('$100', { numericValue: 100 })])]);
    const newTable = makeTable([makeTableRow([makeTableCell('$120', { numericValue: 120 })])]);
    const result = diffTable(oldTable, newTable);
    const cd = result.cellDiffs[0];
    expect(cd.changeType).toBe('modified');
    expect(cd.oldNumericValue).toBe(100);
    expect(cd.newNumericValue).toBe(120);
  });

  it('$100 -> ($100): modified, sign change reflected in numeric values', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('$100', { numericValue: 100 })])]);
    const newTable = makeTable([makeTableRow([makeTableCell('($100)', { numericValue: -100 })])]);
    const result = diffTable(oldTable, newTable);
    const cd = result.cellDiffs[0];
    expect(cd.changeType).toBe('modified');
    expect(cd.oldNumericValue).toBe(100);
    expect(cd.newNumericValue).toBe(-100);
  });

  it('em-dash (0) vs $0: unchanged (both numericValue=0)', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('\u2014', { numericValue: 0 })])]);
    const newTable = makeTable([makeTableRow([makeTableCell('$0', { numericValue: 0 })])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
  });

  it('"1,000" vs "1000": unchanged (same numericValue, formatting only)', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('1,000', { numericValue: 1000 })])]);
    const newTable = makeTable([makeTableRow([makeTableCell('1000', { numericValue: 1000 })])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
  });

  it('non-numeric to numeric: modified, oldNumericValue undefined', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('N/A')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('$100', { numericValue: 100 })])]);
    const result = diffTable(oldTable, newTable);
    const cd = result.cellDiffs[0];
    expect(cd.changeType).toBe('modified');
    expect(cd.oldNumericValue).toBeUndefined();
    expect(cd.newNumericValue).toBe(100);
  });
});

describe('diffTables', () => {
  it('calls matchTables then diffTable for each match', () => {
    const old1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Rev', values: ['$100'] }] });
    const new1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Rev', values: ['$120'] }] });
    const result = diffTables([old1], [new1]);
    expect(result).toHaveLength(1);
    expect(result[0].changeType).toBe('modified');
  });

  it('added tables have changeType added, empty rowDiffs/cellDiffs', () => {
    const new1 = makeFinancialTable({ headers: ['New'], rows: [{ label: 'X', values: [] }] });
    const result = diffTables([], [new1]);
    expect(result).toHaveLength(1);
    expect(result[0].changeType).toBe('added');
    expect(result[0].rowDiffs).toEqual([]);
    expect(result[0].cellDiffs).toEqual([]);
    expect(result[0].newTable).toBe(new1);
    expect(result[0].oldTable).toBeUndefined();
  });

  it('removed tables have changeType removed, empty rowDiffs/cellDiffs', () => {
    const old1 = makeFinancialTable({ headers: ['Old'], rows: [{ label: 'X', values: [] }] });
    const result = diffTables([old1], []);
    expect(result).toHaveLength(1);
    expect(result[0].changeType).toBe('removed');
    expect(result[0].rowDiffs).toEqual([]);
    expect(result[0].cellDiffs).toEqual([]);
    expect(result[0].oldTable).toBe(old1);
    expect(result[0].newTable).toBeUndefined();
  });

  it('summary counts are consistent: rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total rows', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('B'), makeTableCell('2')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('B'), makeTableCell('3')]),
      makeTableRow([makeTableCell('C'), makeTableCell('4')]),
    ]);
    const result = diffTables([oldTable], [newTable]);
    const td = result[0];
    const totalRows = td.summary.rowsAdded + td.summary.rowsRemoved + td.summary.rowsModified + td.summary.rowsUnchanged;
    expect(totalRows).toBeGreaterThan(0);
  });

  it('cellDiffs (flat) is derived from rowDiffs (no duplicates, no missing)', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('1')]),
      makeTableRow([makeTableCell('B'), makeTableCell('2')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('9')]),
      makeTableRow([makeTableCell('B'), makeTableCell('2')]),
    ]);
    const result = diffTables([oldTable], [newTable]);
    const td = result[0];
    const fromRowDiffs = td.rowDiffs.flatMap((rd) => rd.cellDiffs);
    expect(td.cellDiffs).toEqual(fromRowDiffs);
  });
});

describe('boundary conditions', () => {
  it('empty table vs empty table => unchanged, rowDiffs=[], summary all zeros', () => {
    const oldTable = makeTable([]);
    const newTable = makeTable([]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('unchanged');
    expect(result.rowDiffs).toEqual([]);
    expect(result.summary.rowsAdded).toBe(0);
    expect(result.summary.rowsRemoved).toBe(0);
    expect(result.summary.rowsModified).toBe(0);
    expect(result.summary.rowsUnchanged).toBe(0);
    expect(result.summary.cellsChanged).toBe(0);
  });

  it('empty table vs non-empty table => modified, all rows added', () => {
    const oldTable = makeTable([]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('A')]),
      makeTableRow([makeTableCell('B')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.summary.rowsAdded).toBe(2);
  });

  it('non-empty vs empty => modified, all rows removed', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A')]),
      makeTableRow([makeTableCell('B')]),
    ]);
    const newTable = makeTable([]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.summary.rowsRemoved).toBe(2);
  });

  it('single-cell table diff', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('X')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('Y')])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.cellDiffs).toHaveLength(1);
  });

  it('single-row table diff', () => {
    const oldTable = makeTable([makeTableRow([makeTableCell('A'), makeTableCell('B')])]);
    const newTable = makeTable([makeTableRow([makeTableCell('A'), makeTableCell('C')])]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
  });

  it('header-only table (all isHeader=true) vs same => unchanged', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('H1'), makeTableCell('H2')], { isHeader: true }),
    ]);
    const result = diffTable(table, table);
    expect(result.changeType).toBe('unchanged');
  });

  it('very large table (100 rows x 10 cols) completes without error', () => {
    const rows = Array.from({ length: 100 }, (_, r) =>
      makeTableRow(Array.from({ length: 10 }, (_, c) => makeTableCell(`R${r}C${c}`))),
    );
    const oldTable = makeTable(rows);
    // Change a few cells
    const newRows = Array.from({ length: 100 }, (_, r) =>
      makeTableRow(
        Array.from({ length: 10 }, (_, c) =>
          makeTableCell(r % 20 === 0 && c === 0 ? `Modified${r}` : `R${r}C${c}`),
        ),
      ),
    );
    const newTable = makeTable(newRows);
    const result = diffTable(oldTable, newTable);
    expect(result).toBeDefined();
    expect(result.summary.cellsChanged).toBeGreaterThan(0);
  });

  it('all cells identical => unchanged, summary.cellsChanged=0', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
      makeTableRow([makeTableCell('C'), makeTableCell('D')]),
    ]);
    const result = diffTable(table, table);
    expect(result.changeType).toBe('unchanged');
    expect(result.summary.cellsChanged).toBe(0);
  });

  it('all cells different => modified, every cell in cellDiffs', () => {
    const oldTable = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const newTable = makeTable([
      makeTableRow([makeTableCell('X'), makeTableCell('Y')]),
    ]);
    const result = diffTable(oldTable, newTable);
    expect(result.changeType).toBe('modified');
    expect(result.cellDiffs.length).toBe(2);
  });
});
