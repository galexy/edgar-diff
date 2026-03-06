import type { SourceLocation, Logger } from '../types.js';

/** A DOM element that matched the Item heading regex. */
export interface HeadingCandidate {
  /** Raw accumulated text content from the block element and its children. */
  text: string;
  /** Normalized item number: "1", "1a", "7a", etc. */
  itemNumber: string;
  /** Source location of the containing block element. */
  source: SourceLocation;
  /** Heuristic score (higher = more likely a real heading, not TOC/cross-ref). */
  score: number;
}

/** Defines a section boundary after deduplication and scoring. */
export interface SectionBoundary {
  /** Heading candidate that defines this boundary. */
  heading: HeadingCandidate;
  /** Offset where the section's content ends (exclusive). Start of next section or end of document. */
  contentEnd: number;
}

/** Mutable context passed through the extraction pipeline. */
export interface ExtractionContext {
  /** Original HTML string. */
  html: string;
  /** Accumulated parse warnings. */
  warnings: string[];
  /** Whether to populate sourceHtml on nodes. */
  includeSourceHtml: boolean;
  /** Optional logger for warnings. */
  logger?: Logger;
}
