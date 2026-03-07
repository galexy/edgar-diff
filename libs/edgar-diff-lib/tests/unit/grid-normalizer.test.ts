import { describe, it, expect } from 'vitest';
import { normalizeGrid } from '../../src/diff/grid-normalizer.js';
import { makeTable, makeTableRow, makeTableCell } from '../helpers/table-diff-helpers.js';

describe('normalizeGrid', () => {
  it('simple table (no spans) produces 1:1 grid with all isOrigin=true', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
      makeTableRow([makeTableCell('C'), makeTableCell('D')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(2);
    expect(grid.colCount).toBe(2);
    expect(grid.cells[0][0]?.cell.text).toBe('A');
    expect(grid.cells[0][0]?.isOrigin).toBe(true);
    expect(grid.cells[0][1]?.cell.text).toBe('B');
    expect(grid.cells[0][1]?.isOrigin).toBe(true);
    expect(grid.cells[1][0]?.cell.text).toBe('C');
    expect(grid.cells[1][0]?.isOrigin).toBe(true);
    expect(grid.cells[1][1]?.cell.text).toBe('D');
    expect(grid.cells[1][1]?.isOrigin).toBe(true);
  });

  it('colspan=2 fills two adjacent columns with same cell ref; only first isOrigin=true', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('Merged', { colspan: 2 })]),
      makeTableRow([makeTableCell('A'), makeTableCell('B')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(2);
    expect(grid.colCount).toBe(2);
    expect(grid.cells[0][0]?.cell.text).toBe('Merged');
    expect(grid.cells[0][0]?.isOrigin).toBe(true);
    expect(grid.cells[0][1]?.cell.text).toBe('Merged');
    expect(grid.cells[0][1]?.isOrigin).toBe(false);
  });

  it('rowspan=2 fills two adjacent rows at same column; only first isOrigin=true', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('Span', { rowspan: 2 }), makeTableCell('B')]),
      makeTableRow([makeTableCell('D')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(2);
    expect(grid.colCount).toBe(2);
    expect(grid.cells[0][0]?.cell.text).toBe('Span');
    expect(grid.cells[0][0]?.isOrigin).toBe(true);
    expect(grid.cells[1][0]?.cell.text).toBe('Span');
    expect(grid.cells[1][0]?.isOrigin).toBe(false);
    expect(grid.cells[1][1]?.cell.text).toBe('D');
    expect(grid.cells[1][1]?.isOrigin).toBe(true);
  });

  it('combined colspan=2 rowspan=2 fills a 2x2 block; only top-left isOrigin=true', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('Big', { colspan: 2, rowspan: 2 }), makeTableCell('C')]),
      makeTableRow([makeTableCell('D')]),
      makeTableRow([makeTableCell('E'), makeTableCell('F'), makeTableCell('G')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(3);
    expect(grid.colCount).toBe(3);
    // Top-left is origin
    expect(grid.cells[0][0]?.isOrigin).toBe(true);
    expect(grid.cells[0][0]?.cell.text).toBe('Big');
    // Other cells in 2x2 block are not origin
    expect(grid.cells[0][1]?.isOrigin).toBe(false);
    expect(grid.cells[0][1]?.cell.text).toBe('Big');
    expect(grid.cells[1][0]?.isOrigin).toBe(false);
    expect(grid.cells[1][1]?.isOrigin).toBe(false);
    // Adjacent cells
    expect(grid.cells[0][2]?.cell.text).toBe('C');
    expect(grid.cells[1][2]?.cell.text).toBe('D');
  });

  it('grid dimensions: colCount = max logical width across all rows', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('A')]),
      makeTableRow([makeTableCell('B'), makeTableCell('C'), makeTableCell('D')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.colCount).toBe(3);
    expect(grid.rowCount).toBe(2);
  });

  it('irregular rows (different cell counts) padded with null in missing positions', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B'), makeTableCell('C')]),
      makeTableRow([makeTableCell('D')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.colCount).toBe(3);
    expect(grid.cells[1][0]?.cell.text).toBe('D');
    expect(grid.cells[1][1]).toBeNull();
    expect(grid.cells[1][2]).toBeNull();
  });

  it('empty table (0 rows) => rowCount=0, colCount=0, empty cells array', () => {
    const table = makeTable([]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(0);
    expect(grid.colCount).toBe(0);
    expect(grid.cells).toEqual([]);
  });

  it('header-only table normalizes like any other table', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('H1'), makeTableCell('H2')], { isHeader: true }),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(1);
    expect(grid.colCount).toBe(2);
    expect(grid.cells[0][0]?.cell.text).toBe('H1');
  });

  it('overlapping spans (malformed HTML) clamp to grid bounds, skip occupied cells', () => {
    // Two cells both claiming colspan=2 in a 2-column context
    const table = makeTable([
      makeTableRow([
        makeTableCell('A', { colspan: 2 }),
        makeTableCell('B', { colspan: 2 }),
      ]),
    ]);
    const grid = normalizeGrid(table);
    // A occupies cols 0,1; B should find next free col (2) and expand to 3
    expect(grid.cells[0][0]?.cell.text).toBe('A');
    expect(grid.cells[0][1]?.cell.text).toBe('A');
    expect(grid.cells[0][2]?.cell.text).toBe('B');
    expect(grid.cells[0][3]?.cell.text).toBe('B');
  });

  it('single-cell table => 1x1 grid', () => {
    const table = makeTable([makeTableRow([makeTableCell('Only')])]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(1);
    expect(grid.colCount).toBe(1);
    expect(grid.cells[0][0]?.cell.text).toBe('Only');
    expect(grid.cells[0][0]?.isOrigin).toBe(true);
  });

  it('colspan exceeding row width is clamped to remaining columns', () => {
    // Second row has a cell with colspan=5 but grid is only 3 wide
    const table = makeTable([
      makeTableRow([makeTableCell('A'), makeTableCell('B'), makeTableCell('C')]),
      makeTableRow([makeTableCell('Wide', { colspan: 5 })]),
    ]);
    const grid = normalizeGrid(table);
    // Grid should be 5 wide to accommodate the colspan
    expect(grid.colCount).toBe(5);
    expect(grid.cells[1][0]?.cell.text).toBe('Wide');
    expect(grid.cells[1][4]?.cell.text).toBe('Wide');
  });

  it('rowspan exceeding table height is clamped to remaining rows', () => {
    const table = makeTable([
      makeTableRow([makeTableCell('Tall', { rowspan: 5 }), makeTableCell('B')]),
      makeTableRow([makeTableCell('D')]),
    ]);
    const grid = normalizeGrid(table);
    expect(grid.rowCount).toBe(2);
    // Rowspan clamped to 2 rows
    expect(grid.cells[0][0]?.cell.text).toBe('Tall');
    expect(grid.cells[1][0]?.cell.text).toBe('Tall');
    expect(grid.cells[1][0]?.isOrigin).toBe(false);
  });
});
