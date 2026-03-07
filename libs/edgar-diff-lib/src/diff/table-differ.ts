import { diffArrays } from 'diff';
import type { Table } from '../types.js';
import type { ChangeType, CellDiff, RowDiff, TableDiff, DiffRange, NormalizedGrid } from './types.js';
import { normalizeGrid } from './grid-normalizer.js';
import { matchTables } from './table-matcher.js';

/**
 * Normalize cell text for comparison: collapse whitespace, replace nbsp, trim.
 */
function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Compute a pipe-delimited fingerprint for a row's origin cells.
 */
function rowFingerprint(grid: NormalizedGrid, rowIndex: number): string {
  const parts: string[] = [];
  for (let c = 0; c < grid.colCount; c++) {
    const nc = grid.cells[rowIndex][c];
    if (nc && nc.isOrigin) {
      parts.push(normalizeText(nc.cell.text));
    } else if (nc && !nc.isOrigin) {
      // Skip non-origin cells in fingerprint (they duplicate the origin)
      continue;
    } else {
      parts.push('');
    }
  }
  return parts.join('|');
}

/**
 * Compare two cells and produce a CellDiff if they differ, or null if unchanged.
 */
function compareCells(
  row: number,
  col: number,
  oldCell: NormalizedGrid['cells'][0][0],
  newCell: NormalizedGrid['cells'][0][0],
): CellDiff | null {
  const oldText = oldCell ? normalizeText(oldCell.cell.text) : undefined;
  const newText = newCell ? normalizeText(newCell.cell.text) : undefined;

  // Column added
  if (oldCell === null || oldCell === undefined) {
    if (newCell === null || newCell === undefined) return null; // both empty
    return {
      row,
      col,
      changeType: 'added',
      newValue: newCell.cell.text,
      newNumericValue: newCell.cell.numericValue,
      sourceMapping: { new: newCell.cell.source },
    };
  }

  // Column removed
  if (newCell === null || newCell === undefined) {
    return {
      row,
      col,
      changeType: 'removed',
      oldValue: oldCell.cell.text,
      oldNumericValue: oldCell.cell.numericValue,
      sourceMapping: { old: oldCell.cell.source },
    };
  }

  // Both present — check if text is the same after normalization
  if (oldText === newText) return null;

  // Check for numeric formatting-only change
  if (
    oldCell.cell.numericValue !== undefined &&
    newCell.cell.numericValue !== undefined &&
    oldCell.cell.numericValue === newCell.cell.numericValue
  ) {
    return null; // Same numeric value, formatting only
  }

  // Modified
  const cellDiff: CellDiff = {
    row,
    col,
    changeType: 'modified',
    oldValue: oldCell.cell.text,
    newValue: newCell.cell.text,
    sourceMapping: {
      old: oldCell.cell.source,
      new: newCell.cell.source,
    },
  };

  if (oldCell.cell.numericValue !== undefined) {
    cellDiff.oldNumericValue = oldCell.cell.numericValue;
  }
  if (newCell.cell.numericValue !== undefined) {
    cellDiff.newNumericValue = newCell.cell.numericValue;
  }

  return cellDiff;
}

/**
 * Diff a single matched table pair.
 */
export function diffTable(oldTable: Table, newTable: Table): TableDiff {
  const oldGrid = normalizeGrid(oldTable);
  const newGrid = normalizeGrid(newTable);

  const sourceMapping: DiffRange = {
    old: oldTable.source,
    new: newTable.source,
  };

  // Handle empty tables
  if (oldGrid.rowCount === 0 && newGrid.rowCount === 0) {
    return {
      changeType: 'unchanged',
      oldTable,
      newTable,
      rowDiffs: [],
      cellDiffs: [],
      sourceMapping,
      summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
    };
  }

  // Row alignment via fingerprints + diffArrays
  const oldFingerprints = Array.from({ length: oldGrid.rowCount }, (_, i) => rowFingerprint(oldGrid, i));
  const newFingerprints = Array.from({ length: newGrid.rowCount }, (_, i) => rowFingerprint(newGrid, i));

  const arrayDiff = diffArrays(oldFingerprints, newFingerprints);

  const rowDiffs: RowDiff[] = [];
  let oldRowIdx = 0;
  let newRowIdx = 0;
  const maxCols = Math.max(oldGrid.colCount, newGrid.colCount);

  /** Compare cells across a matched row pair. */
  function diffRowPair(oIdx: number, nIdx: number): RowDiff {
    const cellDiffs: CellDiff[] = [];
    for (let c = 0; c < maxCols; c++) {
      const oldCell = c < oldGrid.colCount ? oldGrid.cells[oIdx][c] : null;
      const newCell = c < newGrid.colCount ? newGrid.cells[nIdx][c] : null;
      if (oldCell && !oldCell.isOrigin) continue;
      if (newCell && !newCell.isOrigin) continue;
      const cd = compareCells(nIdx, c, oldCell, newCell);
      if (cd) cellDiffs.push(cd);
    }
    const ct: ChangeType = cellDiffs.length > 0 ? 'modified' : 'unchanged';
    return { oldRowIndex: oIdx, newRowIndex: nIdx, changeType: ct, cellDiffs };
  }

  function makeRemovedRow(oIdx: number): RowDiff {
    const cellDiffs: CellDiff[] = [];
    for (let c = 0; c < oldGrid.colCount; c++) {
      const oldCell = oldGrid.cells[oIdx][c];
      if (oldCell && !oldCell.isOrigin) continue;
      if (oldCell) {
        cellDiffs.push({
          row: oIdx, col: c, changeType: 'removed',
          oldValue: oldCell.cell.text, oldNumericValue: oldCell.cell.numericValue,
          sourceMapping: { old: oldCell.cell.source },
        });
      }
    }
    return { oldRowIndex: oIdx, changeType: 'removed', cellDiffs };
  }

  function makeAddedRow(nIdx: number): RowDiff {
    const cellDiffs: CellDiff[] = [];
    for (let c = 0; c < newGrid.colCount; c++) {
      const newCell = newGrid.cells[nIdx][c];
      if (newCell && !newCell.isOrigin) continue;
      if (newCell) {
        cellDiffs.push({
          row: nIdx, col: c, changeType: 'added',
          newValue: newCell.cell.text, newNumericValue: newCell.cell.numericValue,
          sourceMapping: { new: newCell.cell.source },
        });
      }
    }
    return { newRowIndex: nIdx, changeType: 'added', cellDiffs };
  }

  let hi = 0;
  while (hi < arrayDiff.length) {
    const hunk = arrayDiff[hi];

    if (!hunk.added && !hunk.removed) {
      // Unchanged fingerprints — compare cells for column changes
      for (let i = 0; i < (hunk.count ?? 0); i++) {
        rowDiffs.push(diffRowPair(oldRowIdx, newRowIdx));
        oldRowIdx++;
        newRowIdx++;
      }
      hi++;
    } else if (hunk.removed) {
      const next = arrayDiff[hi + 1];
      if (next?.added) {
        // Pair removed+added as modifications
        const removedCount = hunk.count ?? 0;
        const addedCount = next.count ?? 0;
        const paired = Math.min(removedCount, addedCount);

        for (let i = 0; i < paired; i++) {
          rowDiffs.push(diffRowPair(oldRowIdx, newRowIdx));
          oldRowIdx++;
          newRowIdx++;
        }
        for (let i = paired; i < removedCount; i++) {
          rowDiffs.push(makeRemovedRow(oldRowIdx));
          oldRowIdx++;
        }
        for (let i = paired; i < addedCount; i++) {
          rowDiffs.push(makeAddedRow(newRowIdx));
          newRowIdx++;
        }
        hi += 2;
      } else {
        for (let i = 0; i < (hunk.count ?? 0); i++) {
          rowDiffs.push(makeRemovedRow(oldRowIdx));
          oldRowIdx++;
        }
        hi++;
      }
    } else {
      // Added without preceding removed
      for (let i = 0; i < (hunk.count ?? 0); i++) {
        rowDiffs.push(makeAddedRow(newRowIdx));
        newRowIdx++;
      }
      hi++;
    }
  }

  // Compute summary
  const allCellDiffs = rowDiffs.flatMap((rd) => rd.cellDiffs);
  const rowsAdded = rowDiffs.filter((rd) => rd.changeType === 'added').length;
  const rowsRemoved = rowDiffs.filter((rd) => rd.changeType === 'removed').length;
  const rowsModified = rowDiffs.filter((rd) => rd.changeType === 'modified').length;
  const rowsUnchanged = rowDiffs.filter((rd) => rd.changeType === 'unchanged').length;
  const cellsChanged = allCellDiffs.length;

  const changeType: ChangeType = cellsChanged === 0 && rowsAdded === 0 && rowsRemoved === 0
    ? 'unchanged'
    : 'modified';

  return {
    changeType,
    oldTable,
    newTable,
    rowDiffs,
    cellDiffs: allCellDiffs,
    sourceMapping,
    summary: { rowsAdded, rowsRemoved, rowsModified, rowsUnchanged, cellsChanged },
  };
}

/**
 * Main entry point: match tables between old and new lists, then diff each pair.
 */
export function diffTables(oldTables: Table[], newTables: Table[]): TableDiff[] {
  const matchResult = matchTables(oldTables, newTables);
  const results: TableDiff[] = [];

  // Matched pairs
  for (const match of matchResult.matched) {
    results.push(diffTable(match.oldTable, match.newTable));
  }

  // Added tables
  for (const table of matchResult.added) {
    results.push({
      changeType: 'added',
      newTable: table,
      rowDiffs: [],
      cellDiffs: [],
      sourceMapping: { new: table.source },
      summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
    });
  }

  // Removed tables
  for (const table of matchResult.removed) {
    results.push({
      changeType: 'removed',
      oldTable: table,
      rowDiffs: [],
      cellDiffs: [],
      sourceMapping: { old: table.source },
      summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
    });
  }

  return results;
}
