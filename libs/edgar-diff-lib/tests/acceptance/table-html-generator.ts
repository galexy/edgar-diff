/**
 * TableHtmlGenerator: produces random table HTML paired with expected parse results.
 * Used by property-based tests to verify table extraction across hundreds of
 * randomized inputs per CI run.
 */

export interface TableGenOptions {
  minRows?: number;       // default 0
  maxRows?: number;       // default 20
  minCols?: number;       // default 0
  maxCols?: number;       // default 10
  useColspan?: boolean;   // default true, random colspan 1-3
  useRowspan?: boolean;   // default true, random rowspan 1-3
  useThead?: boolean;     // default: random
  useTbody?: boolean;     // default: random
  useTfoot?: boolean;     // default: random
  useThCells?: boolean;   // default: random
  cellContentTypes?: CellContentType[];
  seed?: number;          // for reproducibility
}

export type CellContentType =
  | 'text'
  | 'currency'
  | 'percentage'
  | 'negative'
  | 'plain-number'
  | 'dash-zero'
  | 'empty'
  | 'nested-span'
  | 'ixbrl';

export interface ExpectedCell {
  text: string;
  numericValue?: number;
  colspan: number;
  rowspan: number;
}

export interface ExpectedRow {
  cellCount: number;
  isHeader: boolean;
  cells: ExpectedCell[];
}

export interface ExpectedTable {
  rowCount: number;
  rows: ExpectedRow[];
}

export interface GeneratedTable {
  html: string;
  expected: ExpectedTable;
}

const DEFAULT_CONTENT_TYPES: CellContentType[] = [
  'text', 'currency', 'percentage', 'negative',
  'plain-number', 'dash-zero', 'empty', 'nested-span',
];

const TEXT_SAMPLES = [
  'Revenue', 'Net income', 'Total assets', 'Operating expenses',
  'Cash', 'Depreciation', 'Interest', 'Goodwill', 'Equity',
  'Liabilities', 'Dividends', 'Shares outstanding', 'EPS',
  'Gross profit', 'Tax provision', 'Retained earnings',
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function randBool(): boolean {
  return Math.random() < 0.5;
}

interface CellGenResult {
  html: string;
  text: string;
  numericValue?: number;
}

function generateCellContent(contentTypes: CellContentType[]): CellGenResult {
  const type = pick(contentTypes);

  switch (type) {
    case 'text': {
      const text = pick(TEXT_SAMPLES);
      return { html: text, text };
    }
    case 'currency': {
      const n = randInt(1, 999999);
      const formatted = n.toLocaleString('en-US');
      return { html: `$${formatted}`, text: `$${formatted}`, numericValue: n };
    }
    case 'percentage': {
      const n = randInt(1, 999);
      const decimal = randBool() ? `.${randInt(1, 9)}` : '';
      const text = `${n}${decimal}%`;
      const numericValue = parseFloat(`${n}${decimal}`);
      return { html: text, text, numericValue };
    }
    case 'negative': {
      const n = randInt(1, 999999);
      const formatted = n.toLocaleString('en-US');
      return {
        html: `(${formatted})`,
        text: `(${formatted})`,
        numericValue: -n,
      };
    }
    case 'plain-number': {
      const n = randInt(1, 999999);
      const formatted = n.toLocaleString('en-US');
      return { html: formatted, text: formatted, numericValue: n };
    }
    case 'dash-zero': {
      const dashes = pick(['\u2014', '\u2013', '--', '---']);
      return { html: dashes, text: dashes, numericValue: 0 };
    }
    case 'empty': {
      return { html: '', text: '' };
    }
    case 'nested-span': {
      const text = pick(TEXT_SAMPLES);
      return {
        html: `<span style="font-weight:bold">${text}</span>`,
        text,
      };
    }
    case 'ixbrl': {
      const n = randInt(1, 999999);
      const formatted = n.toLocaleString('en-US');
      return {
        html: `<ix:nonFraction>${formatted}</ix:nonFraction>`,
        text: formatted,
        numericValue: n,
      };
    }
    default:
      return { html: 'fallback', text: 'fallback' };
  }
}

/**
 * Generate a random table HTML string and the expected parse result.
 */
export function generateTable(options?: TableGenOptions): GeneratedTable {
  const {
    minRows = 0,
    maxRows = 20,
    minCols = 0,
    maxCols = 10,
    useColspan = true,
    useRowspan = true,
    useThead,
    useTbody,
    useTfoot,
    useThCells,
    cellContentTypes = DEFAULT_CONTENT_TYPES,
  } = options ?? {};

  const numRows = randInt(minRows, maxRows);
  const numCols = numRows > 0 ? randInt(Math.max(minCols, 1), maxCols) : 0;

  // Decide structural wrapping
  const wrapThead = useThead ?? (numRows > 0 && randBool());
  const wrapTbody = useTbody ?? (numRows > 1 && randBool());
  const wrapTfoot = useTfoot ?? (numRows > 2 && Math.random() < 0.2);
  const allThCells = useThCells ?? (numRows > 0 && Math.random() < 0.3);

  // Determine which rows are headers
  // thead rows are headers; all-<th> rows are headers; others are not
  const headerRowCount = wrapThead ? Math.min(1, numRows) : 0;
  const footerRowCount = wrapTfoot ? Math.min(1, numRows - headerRowCount) : 0;
  const bodyRowCount = numRows - headerRowCount - footerRowCount;

  const expectedRows: ExpectedRow[] = [];
  const htmlParts: string[] = ['<table>'];

  function generateRow(
    isHeader: boolean,
    useTh: boolean,
  ): { html: string; expectedRow: ExpectedRow } {
    const cellTag = useTh ? 'th' : 'td';
    const cells: ExpectedCell[] = [];
    const cellHtmlParts: string[] = [];

    for (let c = 0; c < numCols; c++) {
      const content = generateCellContent(cellContentTypes);
      const colspan = useColspan && Math.random() < 0.15 ? randInt(2, 3) : 1;
      const rowspan = useRowspan && Math.random() < 0.1 ? randInt(2, 3) : 1;

      const attrs: string[] = [];
      if (colspan > 1) attrs.push(`colspan="${colspan}"`);
      if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`);
      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

      cellHtmlParts.push(`<${cellTag}${attrStr}>${content.html}</${cellTag}>`);
      cells.push({
        text: content.text,
        numericValue: content.numericValue,
        colspan,
        rowspan,
      });
    }

    const rowHtml = `<tr>${cellHtmlParts.join('')}</tr>`;
    return {
      html: rowHtml,
      expectedRow: {
        cellCount: cells.length,
        isHeader,
        cells,
      },
    };
  }

  // Generate thead rows
  if (headerRowCount > 0) {
    htmlParts.push('<thead>');
    for (let r = 0; r < headerRowCount; r++) {
      // thead rows: use <td> or <th> (they're headers regardless due to thead context)
      const useTh = allThCells || randBool();
      const { html, expectedRow } = generateRow(true, useTh);
      htmlParts.push(html);
      expectedRows.push(expectedRow);
    }
    htmlParts.push('</thead>');
  }

  // Generate tbody rows
  const bodyRows: string[] = [];
  for (let r = 0; r < bodyRowCount; r++) {
    // Body rows: if allThCells is true and no thead, first row gets all-<th> and is header
    const isAllThRow = !wrapThead && allThCells && r === 0;
    const { html, expectedRow } = generateRow(isAllThRow, isAllThRow);
    bodyRows.push(html);
    expectedRows.push(expectedRow);
  }

  if (wrapTbody && bodyRows.length > 0) {
    htmlParts.push('<tbody>');
    htmlParts.push(...bodyRows);
    htmlParts.push('</tbody>');
  } else {
    htmlParts.push(...bodyRows);
  }

  // Generate tfoot rows
  if (footerRowCount > 0) {
    htmlParts.push('<tfoot>');
    for (let r = 0; r < footerRowCount; r++) {
      const { html, expectedRow } = generateRow(false, false);
      htmlParts.push(html);
      expectedRows.push(expectedRow);
    }
    htmlParts.push('</tfoot>');
  }

  htmlParts.push('</table>');

  return {
    html: htmlParts.join('\n'),
    expected: {
      rowCount: expectedRows.length,
      rows: expectedRows,
    },
  };
}

/**
 * Wrap table HTML in a section so parseFiling() will detect it as part of Item 8.
 */
export function wrapInSection(tableHtml: string): string {
  return `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements and Supplementary Data</span></div>
${tableHtml}
</body></html>`;
}
