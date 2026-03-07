import { Temporal } from '@js-temporal/polyfill';
import type {
  SourceLocation,
  FilingSection,
  Paragraph,
  Table,
  TableCell,
  StructuredDocument,
} from '../types.js';
import type { RawFiling } from '../client/types.js';

/** Classification of a diff element. */
export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged' | 'reordered';

/** Source locations in the old and/or new filing. */
export interface DiffRange {
  old?: SourceLocation;
  new?: SourceLocation;
}

// --- Table-level diff types (from main) ---

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

// --- Paragraph-level diff types (placeholder for US-1.6) ---

export interface ParagraphDiff {
  changeType: ChangeType;
  oldParagraph?: Paragraph;
  newParagraph?: Paragraph;
  sentenceDiffs?: Array<{ type: 'equal' | 'insert' | 'delete'; value: string }>;
  sourceMapping: DiffRange;
}

// --- Section-level diff types ---

/** Diff result for a single section. */
export interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  oldSection?: FilingSection;
  newSection?: FilingSection;
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}

/** Top-level diff result. */
export interface StructuredDiff {
  oldFiling: RawFiling;
  newFiling: RawFiling;
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
export interface DiffOptions extends AlignmentOptions {}
