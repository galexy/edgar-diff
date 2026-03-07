import type { Paragraph, Table, TableRow, TableCell, FilingSection, ContentBlock, StructuredDocument } from '../../src/types.js';
import type { RawFiling } from '../../src/client/types.js';
import { Temporal } from '@js-temporal/polyfill';

export function makeParagraph(text: string, start: number): Paragraph {
  return { type: 'paragraph', text, source: { start, end: start + text.length } };
}

export function makeTable(rows: string[][], start: number): Table {
  let offset = start;
  const tableRows: TableRow[] = rows.map((cells, rowIdx) => {
    const tableCells: TableCell[] = cells.map((text) => {
      const cell: TableCell = {
        text,
        colspan: 1,
        rowspan: 1,
        source: { start: offset, end: offset + text.length },
      };
      offset += text.length + 1;
      return cell;
    });
    return {
      cells: tableCells,
      isHeader: rowIdx === 0,
      source: { start: start + rowIdx * 20, end: start + rowIdx * 20 + 19 },
    };
  });
  return { type: 'table', rows: tableRows, source: { start, end: offset } };
}

export function makeSection(
  id: string,
  heading: string,
  blocks: ContentBlock[],
  start?: number,
): FilingSection {
  const sectionStart = start ?? (blocks.length > 0 ? blocks[0].source.start - 10 : 0);
  const sectionEnd = blocks.length > 0 ? blocks[blocks.length - 1].source.end + 10 : sectionStart + 100;
  return {
    id,
    heading,
    level: 1,
    blocks,
    subsections: [],
    source: { start: sectionStart, end: sectionEnd },
  };
}

export function makeStructuredDoc(sections: FilingSection[]): StructuredDocument {
  const maxEnd = sections.reduce(
    (max, s) => Math.max(max, s.source.end),
    100,
  );
  const html = 'x'.repeat(maxEnd + 100);
  const filing: RawFiling = {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: 'test-filing.htm',
    html,
    fetchedAt: Temporal.Now.instant(),
  };
  return {
    filing,
    sections,
    parseWarnings: [],
  };
}
