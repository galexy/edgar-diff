// Table-level diff (from main)
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

// Section-level diff
export { diffFilings, buildSummary } from './diff-engine.js';

export {
  alignSections,
  serializeSectionContent,
  isReordered,
  classifySectionDiff,
} from './section-aligner.js';
export type { SectionMatch, AlignmentResult } from './section-aligner.js';

export type {
  SectionDiff, StructuredDiff,
  ParagraphDiff, AlignmentOptions, DiffOptions,
} from './types.js';
