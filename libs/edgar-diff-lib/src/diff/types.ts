import type { SourceLocation, Table, TableCell } from '../types.js';

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffRange {
  old?: SourceLocation;
  new?: SourceLocation;
}

export interface CellDiff {
  /** Row index in the normalized grid (0-based). */
  row: number;
  /** Column index in the normalized grid (0-based). */
  col: number;
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  /** Numeric values when both cells are numeric (for magnitude-change detection). */
  oldNumericValue?: number;
  newNumericValue?: number;
  sourceMapping: DiffRange;
}

export interface RowDiff {
  /** Row index in the respective grid. */
  oldRowIndex?: number;
  newRowIndex?: number;
  changeType: ChangeType;
  cellDiffs: CellDiff[];
}

export interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;
  newTable?: Table;
  rowDiffs: RowDiff[];
  /** Flat list of all cell-level changes (convenience accessor, derived from rowDiffs). */
  cellDiffs: CellDiff[];
  sourceMapping: DiffRange;
  summary: {
    rowsAdded: number;
    rowsRemoved: number;
    rowsModified: number;
    rowsUnchanged: number;
    cellsChanged: number;
  };
}

export interface NormalizedCell {
  /** Reference to the original TableCell. */
  cell: TableCell;
  /** Whether this grid position is the "origin" of the cell (top-left of its span). */
  isOrigin: boolean;
}

export interface NormalizedGrid {
  cells: (NormalizedCell | null)[][];
  rowCount: number;
  colCount: number;
  /** Original table reference. */
  table: Table;
}

export interface TableMatch {
  oldTable: Table;
  newTable: Table;
  similarity: number;
}

export interface TableMatchResult {
  matched: TableMatch[];
  added: Table[];
  removed: Table[];
}
