import * as fc from 'fast-check';
import type {
  FilingSection,
  StructuredDocument,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  ContentBlock,
  SourceLocation,
} from '../../src/types.js';
import { Temporal } from '@js-temporal/polyfill';
import type { RawFiling } from '../../src/client/types.js';

// --- Atomic generators ---

function arbSourceLocation(maxEnd = 100_000): fc.Arbitrary<SourceLocation> {
  return fc.tuple(fc.nat({ max: maxEnd - 1 }), fc.nat({ max: maxEnd })).map(([a, b]) => {
    const start = Math.min(a, b);
    const end = Math.max(a, b) + 1; // ensure start < end
    return { start, end };
  });
}

export const SEC_ITEMS = [
  'Item 1. Business',
  'Item 1A. Risk Factors',
  'Item 1B. Unresolved Staff Comments',
  'Item 1C. Cybersecurity',
  'Item 2. Properties',
  'Item 3. Legal Proceedings',
  'Item 4. Mine Safety Disclosures',
  'Item 5. Market for Registrant\'s Common Equity',
  'Item 6. [Reserved]',
  'Item 7. Management\'s Discussion and Analysis',
  'Item 7A. Quantitative and Qualitative Disclosures About Market Risk',
  'Item 8. Financial Statements and Supplementary Data',
  'Item 9. Changes in and Disagreements with Accountants',
  'Item 9A. Controls and Procedures',
  'Item 9B. Other Information',
  'Item 10. Directors, Executive Officers and Corporate Governance',
  'Item 11. Executive Compensation',
  'Item 12. Security Ownership',
  'Item 13. Certain Relationships and Related Transactions',
  'Item 14. Principal Accountant Fees and Services',
  'Item 15. Exhibits and Financial Statement Schedules',
];

export function arbHeading(): fc.Arbitrary<string> {
  return fc.constantFrom(...SEC_ITEMS);
}

/**
 * Generate N unique SEC-like headings using shuffledSubarray (no filter needed).
 * This avoids the fast-check anti-pattern of .filter() on uniqueArray which
 * can silently reduce iteration counts.
 */
export function arbUniqueHeadings(n: number): fc.Arbitrary<string[]> {
  if (n === 0) return fc.constant([]);
  return fc.shuffledSubarray(SEC_ITEMS, { minLength: n, maxLength: n });
}

export function arbUniqueHeading(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.array(fc.constantFrom('A', 'B', 'C', 'D', 'X', 'Y', 'Z'), { minLength: 3, maxLength: 8 }).map(a => a.join('')),
    fc.nat({ max: 999 }),
  ).map(([letters, num]) => `Section ${num}${letters}. Unique Topic ${letters}${num}`);
}

function arbParagraph(): fc.Arbitrary<Paragraph> {
  return fc.tuple(
    fc.lorem({ maxCount: 5, mode: 'sentences' }),
    arbSourceLocation(),
  ).map(([text, source]) => ({
    type: 'paragraph' as const,
    text,
    source,
  }));
}

function arbTableCell(): fc.Arbitrary<TableCell> {
  return fc.tuple(
    fc.lorem({ maxCount: 2 }),
    fc.option(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { nil: undefined }),
    arbSourceLocation(),
  ).map(([text, numericValue, source]) => ({
    text,
    numericValue,
    colspan: 1,
    rowspan: 1,
    source,
  }));
}

function arbTableRow(): fc.Arbitrary<TableRow> {
  return fc.tuple(
    fc.array(arbTableCell(), { minLength: 1, maxLength: 4 }),
    fc.boolean(),
    arbSourceLocation(),
  ).map(([cells, isHeader, source]) => ({
    cells,
    isHeader,
    source,
  }));
}

function arbTable(): fc.Arbitrary<Table> {
  return fc.tuple(
    fc.array(arbTableRow(), { minLength: 1, maxLength: 3 }),
    arbSourceLocation(),
  ).map(([rows, source]) => ({
    type: 'table' as const,
    rows,
    source,
  }));
}

export function arbContentBlocks(count?: number): fc.Arbitrary<ContentBlock[]> {
  const minLen = count ?? 0;
  const maxLen = count ?? 5;
  return fc.array(
    fc.oneof(
      { weight: 3, arbitrary: arbParagraph() },
      { weight: 1, arbitrary: arbTable() },
    ),
    { minLength: minLen, maxLength: maxLen },
  );
}

export function arbFilingSection(overrides?: Partial<FilingSection>): fc.Arbitrary<FilingSection> {
  return fc.tuple(
    fc.uuid(),
    arbHeading(),
    arbContentBlocks(),
    arbSourceLocation(),
  ).map(([id, heading, blocks, source]) => ({
    id: overrides?.id ?? id,
    heading: overrides?.heading ?? heading,
    level: overrides?.level ?? 1,
    blocks: overrides?.blocks ?? blocks,
    subsections: overrides?.subsections ?? [],
    source: overrides?.source ?? source,
    ...overrides,
  }));
}

export function arbFilingSectionWithHeading(heading: string): fc.Arbitrary<FilingSection> {
  return arbFilingSection({ heading, id: `item-${heading.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}` });
}

function arbRawFiling(): fc.Arbitrary<RawFiling> {
  return fc.constant({
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K' as const,
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: 'test.htm',
    html: '<html></html>',
    fetchedAt: Temporal.Now.instant(),
  });
}

export function arbStructuredDocument(sectionCount?: number): fc.Arbitrary<StructuredDocument> {
  const min = sectionCount ?? 0;
  const max = sectionCount ?? 10;
  return fc.tuple(
    arbRawFiling(),
    fc.array(arbFilingSection(), { minLength: min, maxLength: max }),
  ).map(([filing, sections]) => ({
    filing,
    sections,
    parseWarnings: [],
  }));
}

/**
 * Build a StructuredDocument from a list of sections with a valid RawFiling.
 */
export function makeDoc(sections: FilingSection[]): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K',
      filingDate: Temporal.PlainDate.from('2024-01-01'),
      primaryDocumentFilename: 'test.htm',
      html: '<html></html>',
      fetchedAt: Temporal.Now.instant(),
    },
    sections,
    parseWarnings: [],
  };
}

/**
 * Create a minimal FilingSection for testing.
 */
export function makeSection(
  id: string,
  heading: string,
  blocks: ContentBlock[] = [],
): FilingSection {
  return {
    id,
    heading,
    level: 1,
    blocks,
    subsections: [],
    source: { start: 0, end: 100 },
  };
}

/**
 * Create a paragraph block with given text.
 */
export function makeParagraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    text,
    source: { start: 0, end: text.length },
  };
}

/**
 * Create a simple table block with given cell texts.
 */
export function makeTable(rows: string[][]): Table {
  return {
    type: 'table',
    rows: rows.map((cells, ri) => ({
      cells: cells.map((text, ci) => ({
        text,
        colspan: 1,
        rowspan: 1,
        source: { start: ri * 100 + ci * 10, end: ri * 100 + ci * 10 + text.length },
      })),
      isHeader: ri === 0,
      source: { start: ri * 100, end: ri * 100 + 99 },
    })),
    source: { start: 0, end: rows.length * 100 },
  };
}
