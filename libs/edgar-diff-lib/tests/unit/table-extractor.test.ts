import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { tryParseNumeric } from '../../src/parser/table-extractor.js';
import { parseFiling } from '../../src/parser/parser.js';
import type { RawFiling } from '../../src/client/types.js';
import type { Table } from '../../src/types.js';

function makeRawFiling(html: string, overrides?: Partial<RawFiling>): RawFiling {
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: 'test-filing.htm',
    html,
    fetchedAt: Temporal.Now.instant(),
    ...overrides,
  };
}

/** Helper: parse HTML with an Item 8 heading wrapper, return first table. */
function parseTable(tableHtml: string, opts?: { includeSourceHtml?: boolean }): { table: Table; html: string } {
  const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
${tableHtml}
</body></html>`;
  const doc = parseFiling(makeRawFiling(html), opts);
  const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
  return { table, html };
}

describe('tryParseNumeric', () => {
  it.each<{ label: string; input: string; expected: number | undefined }>([
    { label: 'currency: $1,234.56',       input: '$1,234.56',                expected: 1234.56 },
    { label: 'currency: $100',            input: '$100',                     expected: 100 },
    { label: 'currency: $ 42.00',         input: '$ 42.00',                 expected: 42 },
    { label: 'percent: 12.5%',            input: '12.5%',                   expected: 12.5 },
    { label: 'percent: 100%',             input: '100%',                    expected: 100 },
    { label: 'percent: 0.5 %',            input: '0.5 %',                   expected: 0.5 },
    { label: 'paren negative: (1,234)',    input: '(1,234)',                 expected: -1234 },
    { label: 'paren negative: (42)',       input: '(42)',                    expected: -42 },
    { label: 'paren negative: $(500.50)',  input: '$(500.50)',               expected: -500.50 },
    { label: 'plain: 42',                 input: '42',                      expected: 42 },
    { label: 'plain: 1,000',              input: '1,000',                   expected: 1000 },
    { label: 'plain: 3.14',               input: '3.14',                    expected: 3.14 },
    { label: 'non-numeric: Revenue',      input: 'Revenue',                 expected: undefined },
    { label: 'non-numeric: Total…',       input: 'Total operating expenses', expected: undefined },
    { label: 'non-numeric: N/A',          input: 'N/A',                     expected: undefined },
    { label: 'mixed: $1,234 million',     input: '$1,234 million',          expected: undefined },
    { label: 'mixed: approximately 500',  input: 'approximately 500',       expected: undefined },
    { label: 'dash: em-dash',             input: '\u2014',                  expected: 0 },
    { label: 'dash: en-dash',             input: '\u2013',                  expected: 0 },
    { label: 'dash: --',                  input: '--',                      expected: 0 },
    { label: 'dash: ---',                 input: '---',                     expected: 0 },
    { label: 'negative: -1,234',          input: '-1,234',                  expected: -1234 },
    { label: 'negative: - 500',           input: '- 500',                   expected: -500 },
    { label: 'negative: -42.5',           input: '-42.5',                   expected: -42.5 },
    { label: 'empty string',              input: '',                        expected: undefined },
    { label: 'whitespace only',           input: '   ',                     expected: undefined },
  ])('$label', ({ input, expected }) => {
    expect(tryParseNumeric(input)).toBe(expected);
  });
});

describe('extractTable — basic extraction', () => {
  it('simple 2x2 table: rows, cells, text, and numericValue', () => {
    const { table } = parseTable(`<table>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Expenses</td><td>$80</td></tr>
</table>`);
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells).toHaveLength(2);
    expect(table.rows[0].cells[0].text).toBe('Revenue');
    expect(table.rows[0].cells[1].text).toBe('$100');
    expect(table.rows[1].cells[0].text).toBe('Expenses');
    expect(table.rows[1].cells[1].text).toBe('$80');
    // numericValue integration: tryParseNumeric wired into cell extraction
    expect(table.rows[0].cells[0].numericValue).toBeUndefined();
    expect(table.rows[0].cells[1].numericValue).toBe(100);
    expect(table.rows[1].cells[1].numericValue).toBe(80);
  });

  it('cells default to colspan=1 and rowspan=1', () => {
    const { table } = parseTable(`<table><tr><td>Plain cell</td></tr></table>`);
    expect(table.rows[0].cells[0].colspan).toBe(1);
    expect(table.rows[0].cells[0].rowspan).toBe(1);
  });

  it('cell and row SourceLocations are valid and round-trip', () => {
    const { table, html } = parseTable(`<table>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>`);
    for (const row of table.rows) {
      expect(row.source.start).toBeGreaterThanOrEqual(0);
      expect(row.source.end).toBeLessThanOrEqual(html.length);
      expect(row.source.start).toBeLessThan(row.source.end);
      for (const cell of row.cells) {
        expect(cell.source.start).toBeGreaterThanOrEqual(0);
        expect(cell.source.end).toBeLessThanOrEqual(html.length);
        expect(cell.source.start).toBeLessThan(cell.source.end);
        // Cell contained within row
        expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
        expect(cell.source.end).toBeLessThanOrEqual(row.source.end);
        // Round-trip
        const slice = html.slice(cell.source.start, cell.source.end);
        expect(slice).toContain(cell.text);
      }
    }
  });

  it('empty table produces empty rows array', () => {
    const { table } = parseTable(`<table></table>`);
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(0);
  });

  it('multiple tables in one section', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Table 1</td></tr></table>
<p>Some text between tables.</p>
<table><tr><td>Table 2</td></tr></table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const tables = doc.sections[0].blocks.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
  });

  it('rows are in document order', () => {
    const { table } = parseTable(`<table>
  <tr><td>First</td></tr>
  <tr><td>Second</td></tr>
  <tr><td>Third</td></tr>
</table>`);
    expect(table.rows[0].cells[0].text).toBe('First');
    expect(table.rows[1].cells[0].text).toBe('Second');
    expect(table.rows[2].cells[0].text).toBe('Third');
    for (let i = 1; i < table.rows.length; i++) {
      expect(table.rows[i].source.start).toBeGreaterThan(table.rows[i - 1].source.start);
    }
  });
});

describe('extractTable — header detection', () => {
  it('<thead> with <td> cells marks row as header', () => {
    const { table } = parseTable(`<table>
  <thead><tr><td>Year</td><td>Revenue</td></tr></thead>
  <tbody><tr><td>2024</td><td>$100B</td></tr></tbody>
</table>`);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('all-<th> row without <thead> is header', () => {
    const { table } = parseTable(`<table>
  <tr><th>Metric</th><th>2024</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100B</td><td>$90B</td></tr>
</table>`);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[0].cells[0].text).toBe('Metric');
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('all-<td> row is NOT header (no first-row heuristic)', () => {
    const { table } = parseTable(`<table>
  <tr><td>Year</td><td>Revenue</td><td>Income</td></tr>
  <tr><td>2024</td><td>$100B</td><td>$20B</td></tr>
</table>`);
    expect(table.rows[0].isHeader).toBe(false);
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('mixed <th> and <td> in same row is NOT header', () => {
    const { table } = parseTable(`<table>
  <tr><th>Label</th><td>Value</td></tr>
</table>`);
    expect(table.rows[0].isHeader).toBe(false);
  });
});

describe('extractTable — colspan/rowspan', () => {
  it('colspan=2 preserved', () => {
    const { table } = parseTable(`<table>
  <tr><td colspan="2">Merged Header</td></tr>
  <tr><td>A</td><td>B</td></tr>
</table>`);
    expect(table.rows[0].cells[0].colspan).toBe(2);
    expect(table.rows[0].cells[0].text).toBe('Merged Header');
    expect(table.rows[1].cells[0].colspan).toBe(1);
  });

  it('rowspan=3 preserved', () => {
    const { table } = parseTable(`<table>
  <tr><td rowspan="3">Category</td><td>A</td></tr>
  <tr><td>B</td></tr>
  <tr><td>C</td></tr>
</table>`);
    expect(table.rows[0].cells[0].rowspan).toBe(3);
    expect(table.rows[0].cells[0].text).toBe('Category');
  });

  it('combined colspan=2 and rowspan=2', () => {
    const { table } = parseTable(`<table>
  <tr><td colspan="2" rowspan="2">Big Cell</td><td>C</td></tr>
  <tr><td>D</td></tr>
  <tr><td>E</td><td>F</td><td>G</td></tr>
</table>`);
    expect(table.rows[0].cells[0].colspan).toBe(2);
    expect(table.rows[0].cells[0].rowspan).toBe(2);
  });
});

describe('extractTable — edge cases', () => {
  it('nested spans, bold, iXBRL wrappers flatten to plain text', () => {
    const { table } = parseTable(`<table>
  <tr>
    <td><span style="font-weight:bold">Revenue</span></td>
    <td><b><i>$100</i></b></td>
    <td><ix:nonFraction>42</ix:nonFraction></td>
  </tr>
</table>`);
    expect(table.rows[0].cells[0].text).toBe('Revenue');
    expect(table.rows[0].cells[1].text).toBe('$100');
    expect(table.rows[0].cells[2].text).toBe('42');
    expect(table.rows[0].cells[2].numericValue).toBe(42);
  });

  it('whitespace/nbsp cells normalize to empty string, not filtered', () => {
    const { table } = parseTable(`<table>
  <tr>
    <td>&nbsp;</td>
    <td>   </td>
    <td> Revenue </td>
  </tr>
</table>`);
    expect(table.rows[0].cells).toHaveLength(3);
    expect(table.rows[0].cells[0].text).toBe('');
    expect(table.rows[0].cells[1].text).toBe('');
    expect(table.rows[0].cells[2].text).toBe('Revenue');
    expect(table.rows[0].cells[0].numericValue).toBeUndefined();
  });

  it('thead/tbody/tfoot: header, body, and footer rows', () => {
    const { table } = parseTable(`<table>
  <thead><tr><th>Metric</th><th>2024</th></tr></thead>
  <tbody>
    <tr><td>Revenue</td><td>$100B</td></tr>
    <tr><td>Income</td><td>$20B</td></tr>
  </tbody>
  <tfoot><tr><td>Total</td><td>$120B</td></tr></tfoot>
</table>`);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
    expect(table.rows[3].isHeader).toBe(false); // tfoot rows are not headers
  });

  it('<br> tags insert a space between adjacent text', () => {
    const { table } = parseTable(`<table>
  <tr><td>Line1<br>Line2</td></tr>
  <tr><td>Multi<br/>Line<br>Text</td></tr>
</table>`);
    expect(table.rows[0].cells[0].text).toContain('Line1');
    expect(table.rows[0].cells[0].text).toContain('Line2');
    expect(table.rows[0].cells[0].text).not.toBe('Line1Line2');
  });

  it('sourceHtml populated when opted in', () => {
    const { table } = parseTable(
      `<table><tr><td>Revenue</td><td>$100</td></tr></table>`,
      { includeSourceHtml: true },
    );
    expect(table.sourceHtml).toBeDefined();
    expect(table.sourceHtml).toContain('<table');
    expect(table.rows[0].sourceHtml).toBeDefined();
    expect(table.rows[0].sourceHtml).toContain('Revenue');
    expect(table.rows[0].cells[0].sourceHtml).toBeDefined();
    expect(table.rows[0].cells[0].sourceHtml).toContain('Revenue');
  });

  it('sourceHtml undefined by default', () => {
    const { table } = parseTable(`<table><tr><td>Revenue</td></tr></table>`);
    expect(table.rows[0].sourceHtml).toBeUndefined();
    expect(table.rows[0].cells[0].sourceHtml).toBeUndefined();
  });
});
