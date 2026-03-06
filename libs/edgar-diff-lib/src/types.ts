export type { RawFiling, FormType } from './client/types.js';

/** Character offset range in the original HTML string (JS UTF-16 indices). */
export interface SourceLocation {
  /** Offset of the first character (inclusive). */
  start: number;
  /** Offset one past the last character (exclusive). */
  end: number;
}

/** Mixin for any node that maps back to source HTML. */
export interface SourceMapped {
  source: SourceLocation;
  /** Raw HTML substring. Only populated when parseOptions.includeSourceHtml is true. */
  sourceHtml?: string;
}

export interface Paragraph extends SourceMapped {
  type: 'paragraph';
  text: string;
}

export interface TableCell extends SourceMapped {
  text: string;
  numericValue?: number;
  colspan: number;
  rowspan: number;
}

export interface TableRow extends SourceMapped {
  cells: TableCell[];
  isHeader: boolean;
}

export interface Table extends SourceMapped {
  type: 'table';
  rows: TableRow[];
}

export type ContentBlock = Paragraph | Table;

export interface FilingSection extends SourceMapped {
  /** Normalized ID: "item-1a" */
  id: string;
  /** Raw heading text: "Item 1A. Risk Factors" */
  heading: string;
  /** 1 = top-level Item, 2 = subsection */
  level: number;
  blocks: ContentBlock[];
  subsections: FilingSection[];
}

export interface StructuredDocument {
  filing: import('./client/types.js').RawFiling;
  sections: FilingSection[];
  parseWarnings: string[];
}

export interface Logger {
  warn(msg: string): void;
}
