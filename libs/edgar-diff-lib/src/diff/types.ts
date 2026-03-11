import { Temporal } from '@js-temporal/polyfill';
import type {
  SourceLocation,
  Table,
  TableCell,
} from '../types.js';
import type { FormType } from '../client/types.js';

/** Classification of a diff element. */
export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged' | 'reordered' | 'moved';

/** Source locations in the old and/or new filing. */
export interface DiffRange {
  old?: SourceLocation;
  new?: SourceLocation;
}

// --- Table-level diff types ---

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

// --- Paragraph-level diff types (US-1.6) ---

/** A word-level change within a modified or moved paragraph. */
export interface WordChange {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

/** Diff result for a single paragraph. */
export interface ParagraphDiff {
  changeType: ChangeType;
  /** Word-level diff breakdown. Present for 'modified' and 'moved' (when text also changed). */
  wordChanges?: WordChange[];
  sourceMapping: DiffRange;
}

// --- Section-level diff types ---

/** Diff result for a single section. */
export interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}

/** Filing metadata included in diff output (RawFiling minus the html field). */
export interface DiffFilingMetadata {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  fetchedAt: Temporal.Instant;
}

/** Top-level diff result. */
export interface StructuredDiff {
  oldFiling: DiffFilingMetadata;
  newFiling: DiffFilingMetadata;
  sectionDiffs: SectionDiff[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    reordered: number;
  };
  generatedAt: Temporal.Instant;
}

/** Options for section alignment. */
export interface AlignmentOptions {
  /** Minimum Jaro-Winkler similarity to consider a match. Default: 0.75. */
  threshold?: number;
}

/** Options for diffFilings. */
export type DiffOptions = AlignmentOptions;
