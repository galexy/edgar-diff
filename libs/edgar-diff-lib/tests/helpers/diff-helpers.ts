import { Temporal } from '@js-temporal/polyfill';
import type {
  FilingSection,
  StructuredDocument,
  ContentBlock,
  Paragraph,
  Table,
  SourceLocation,
} from '../../src/types.js';
import type { RawFiling } from '../../src/client/types.js';

/** Create a minimal RawFiling for testing. */
function makeRawFiling(overrides?: Partial<RawFiling>): RawFiling {
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: 'test-filing.htm',
    html: '<html></html>',
    fetchedAt: Temporal.Now.instant(),
    ...overrides,
  };
}

/** Create a minimal FilingSection for testing. */
export function makeFilingSection(
  id: string,
  heading: string,
  options?: {
    blocks?: ContentBlock[];
    source?: SourceLocation;
    level?: number;
    subsections?: FilingSection[];
  },
): FilingSection {
  return {
    id,
    heading,
    level: options?.level ?? 1,
    blocks: options?.blocks ?? [],
    subsections: options?.subsections ?? [],
    source: options?.source ?? { start: 0, end: 100 },
  };
}

/** Create a paragraph content block. */
export function makeParagraph(text: string, source?: SourceLocation): Paragraph {
  return {
    type: 'paragraph',
    text,
    source: source ?? { start: 0, end: text.length },
  };
}

/** Create a table content block. */
export function makeTable(rows: string[][], source?: SourceLocation): Table {
  return {
    type: 'table',
    rows: rows.map((cells, rowIdx) => ({
      cells: cells.map((text) => ({
        text,
        colspan: 1,
        rowspan: 1,
        source: source ?? { start: 0, end: 10 },
      })),
      isHeader: rowIdx === 0,
      source: source ?? { start: 0, end: 10 },
    })),
    source: source ?? { start: 0, end: 10 },
  };
}

/** Create a minimal StructuredDocument for testing. */
export function makeStructuredDocument(
  sections: FilingSection[],
  overrides?: Partial<StructuredDocument>,
): StructuredDocument {
  return {
    filing: makeRawFiling(),
    sections,
    parseWarnings: [],
    ...overrides,
  };
}

/** Create a pair of documents with specified section configurations. */
export function makeDocumentPair(
  oldSections: Array<{ id: string; heading: string; content?: string }>,
  newSections: Array<{ id: string; heading: string; content?: string }>,
): { oldDoc: StructuredDocument; newDoc: StructuredDocument } {
  const toFilingSections = (specs: typeof oldSections): FilingSection[] =>
    specs.map((s, i) =>
      makeFilingSection(s.id, s.heading, {
        blocks: s.content ? [makeParagraph(s.content)] : [],
        source: { start: i * 100, end: (i + 1) * 100 },
      }),
    );

  return {
    oldDoc: makeStructuredDocument(toFilingSections(oldSections)),
    newDoc: makeStructuredDocument(toFilingSections(newSections)),
  };
}
