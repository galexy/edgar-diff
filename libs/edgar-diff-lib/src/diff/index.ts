export type {
  ChangeType,
  DiffRange,
  CellDiff,
  RowDiff,
  TableDiff,
  NormalizedCell,
  NormalizedGrid,
  TableMatch,
  TableMatchResult,
} from './types.js';

export { normalizeGrid } from './grid-normalizer.js';
export { matchTables } from './table-matcher.js';
export { diffTable, diffTables } from './table-differ.js';
