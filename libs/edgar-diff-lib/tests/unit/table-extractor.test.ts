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

describe('tryParseNumeric', () => {
  it('T9: currency values parsed to numericValue', () => {
    expect(tryParseNumeric('$1,234.56')).toBe(1234.56);
    expect(tryParseNumeric('$100')).toBe(100);
    expect(tryParseNumeric('$ 42.00')).toBe(42);
  });

  it('T10: percentage values parsed to numericValue', () => {
    expect(tryParseNumeric('12.5%')).toBe(12.5);
    expect(tryParseNumeric('100%')).toBe(100);
    expect(tryParseNumeric('0.5 %')).toBe(0.5);
  });

  it('T11: parenthetical negatives parsed as negative numbers', () => {
    expect(tryParseNumeric('(1,234)')).toBe(-1234);
    expect(tryParseNumeric('(42)')).toBe(-42);
    expect(tryParseNumeric('$(500.50)')).toBe(-500.50);
  });

  it('T12: plain numbers parsed correctly', () => {
    expect(tryParseNumeric('42')).toBe(42);
    expect(tryParseNumeric('1,000')).toBe(1000);
    expect(tryParseNumeric('3.14')).toBe(3.14);
  });

  it('T13: non-numeric text returns undefined', () => {
    expect(tryParseNumeric('Revenue')).toBeUndefined();
    expect(tryParseNumeric('Total operating expenses')).toBeUndefined();
    expect(tryParseNumeric('N/A')).toBeUndefined();
  });

  it('T14: mixed text with number returns undefined', () => {
    expect(tryParseNumeric('$1,234 million')).toBeUndefined();
    expect(tryParseNumeric('approximately 500')).toBeUndefined();
  });

  it('T25: dash patterns as zero', () => {
    expect(tryParseNumeric('\u2014')).toBe(0);  // em-dash
    expect(tryParseNumeric('\u2013')).toBe(0);  // en-dash
    expect(tryParseNumeric('--')).toBe(0);
    expect(tryParseNumeric('---')).toBe(0);
  });

  it('T26: negative numbers with dash prefix', () => {
    expect(tryParseNumeric('-1,234')).toBe(-1234);
    expect(tryParseNumeric('- 500')).toBe(-500);
    expect(tryParseNumeric('-42.5')).toBe(-42.5);
  });

  it('empty/whitespace returns undefined', () => {
    expect(tryParseNumeric('')).toBeUndefined();
    expect(tryParseNumeric('   ')).toBeUndefined();
  });
});

describe('extractTable — basic extraction', () => {
  it('T1: simple 2x2 table produces correct rows and cells', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Expenses</td><td>$80</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells).toHaveLength(2);
    expect(table.rows[0].cells[0].text).toBe('Revenue');
    expect(table.rows[0].cells[1].text).toBe('$100');
    expect(table.rows[1].cells[0].text).toBe('Expenses');
    expect(table.rows[1].cells[1].text).toBe('$80');
  });

  it('T1b: numeric values populated on cells', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Expenses</td><td>$80</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].numericValue).toBeUndefined();
    expect(table.rows[0].cells[1].numericValue).toBe(100);
    expect(table.rows[1].cells[1].numericValue).toBe(80);
  });

  it('T8: cells without colspan/rowspan default to 1', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Plain cell</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].colspan).toBe(1);
    expect(table.rows[0].cells[0].rowspan).toBe(1);
  });

  it('T15: each cell has valid SourceLocation', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    for (const row of table.rows) {
      expect(row.source.start).toBeGreaterThanOrEqual(0);
      expect(row.source.end).toBeLessThanOrEqual(html.length);
      expect(row.source.start).toBeLessThan(row.source.end);
      for (const cell of row.cells) {
        expect(cell.source.start).toBeGreaterThanOrEqual(0);
        expect(cell.source.end).toBeLessThanOrEqual(html.length);
        expect(cell.source.start).toBeLessThan(cell.source.end);
        const slice = html.slice(cell.source.start, cell.source.end);
        expect(slice).toContain(cell.text);
      }
    }
  });

  it('T16: each row source contains all its cells', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>A</td><td>B</td></tr>
  <tr><td>C</td><td>D</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
        expect(cell.source.end).toBeLessThanOrEqual(row.source.end);
      }
    }
  });

  it('T17: empty table produces empty rows array', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table></table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(0);
  });

  it('T23: multiple tables in one section', () => {
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

  it('T24: rows are in document order', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>First</td></tr>
  <tr><td>Second</td></tr>
  <tr><td>Third</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].text).toBe('First');
    expect(table.rows[1].cells[0].text).toBe('Second');
    expect(table.rows[2].cells[0].text).toBe('Third');
    for (let i = 1; i < table.rows.length; i++) {
      expect(table.rows[i].source.start).toBeGreaterThan(table.rows[i - 1].source.start);
    }
  });
});

describe('extractTable — header detection', () => {
  it('T2: <th> cells mark the row as a header row', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Category</th><th>Amount</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[0].cells[0].text).toBe('Category');
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('T3: rows inside <thead> are marked as header rows', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <thead><tr><td>Year</td><td>Revenue</td></tr></thead>
  <tbody><tr><td>2024</td><td>$100B</td></tr></tbody>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('T4: all-<th> row without <thead> is still a header', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Metric</th><th>2024</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100B</td><td>$90B</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('T4b: no first-row heuristic — all-<td> row is NOT header', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Year</td><td>Revenue</td><td>Income</td></tr>
  <tr><td>2024</td><td>$100B</td><td>$20B</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].isHeader).toBe(false);
    expect(table.rows[1].isHeader).toBe(false);
  });

  it('T28: mixed <th> and <td> in same row — not header', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Label</th><td>Value</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].isHeader).toBe(false);
  });
});

describe('extractTable — colspan/rowspan', () => {
  it('T5: cell with colspan=2 preserved', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td colspan="2">Merged Header</td></tr>
  <tr><td>A</td><td>B</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].colspan).toBe(2);
    expect(table.rows[0].cells[0].text).toBe('Merged Header');
    expect(table.rows[1].cells[0].colspan).toBe(1);
  });

  it('T6: cell with rowspan=3 preserved', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td rowspan="3">Category</td><td>A</td></tr>
  <tr><td>B</td></tr>
  <tr><td>C</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].rowspan).toBe(3);
    expect(table.rows[0].cells[0].text).toBe('Category');
  });

  it('T7: cell with both colspan=2 and rowspan=2', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td colspan="2" rowspan="2">Big Cell</td><td>C</td></tr>
  <tr><td>D</td></tr>
  <tr><td>E</td><td>F</td><td>G</td></tr>
</table>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
    expect(table.rows[0].cells[0].colspan).toBe(2);
    expect(table.rows[0].cells[0].rowspan).toBe(2);
  });
});
