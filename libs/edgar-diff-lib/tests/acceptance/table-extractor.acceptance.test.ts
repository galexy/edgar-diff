import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import type { Table } from '../../src/types.js';
import { makeRawFiling } from '../helpers/ground-truth.js';
import { generateTable, wrapInSection } from './table-html-generator.js';
import type { GeneratedTable } from './table-html-generator.js';

// ============================================================
// Property-based tests: table extraction structural invariants
//
// Each iteration generates a random table with varying structure
// (row/col counts, thead/tbody/tfoot, th/td, colspan, rowspan,
// mixed content types) and verifies 10 structural properties.
// Vitest registers each element as an individual test case.
// ============================================================

const TABLE_TEST_COUNT = Number(process.env['TABLE_TEST_COUNT'] ?? 200);

interface LabeledTestCase {
  label: string;
  generated: GeneratedTable;
}

// Pre-generate all test cases so vitest can enumerate them upfront
const tableTestCases: LabeledTestCase[] = Array.from(
  { length: TABLE_TEST_COUNT },
  (_, i) => {
    const generated = generateTable();
    const { expected } = generated;
    const headerCount = expected.rows.filter(r => r.isHeader).length;
    const label = `#${i} (${expected.rowCount} rows, ${headerCount} headers)`;
    return { label, generated };
  },
);

describe('property: table extraction invariants', () => {
  it.each(tableTestCases)(
    'generated table $label: structural invariants hold',
    ({ generated: { html: tableHtml, expected } }) => {
      const html = wrapInSection(tableHtml);
      const doc = parseFiling(makeRawFiling(html));

      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;

      // Empty tables (0 rows) may not produce a table block at all
      if (expected.rowCount === 0) {
        if (!table) return; // acceptable: no table block for empty table
        expect(table.rows).toHaveLength(0);
        return;
      }

      expect(table).toBeDefined();

      // P1: Row count matches expected
      expect(table.rows.length).toBe(expected.rowCount);

      // P2: Each row's cell count matches expected
      for (let r = 0; r < table.rows.length; r++) {
        expect(table.rows[r].cells.length).toBe(expected.rows[r].cellCount);
      }

      // P3: isHeader matches expected
      for (let r = 0; r < table.rows.length; r++) {
        expect(table.rows[r].isHeader).toBe(expected.rows[r].isHeader);
      }

      // P4: All source offsets valid
      for (const row of table.rows) {
        expect(row.source.start).toBeGreaterThanOrEqual(0);
        expect(row.source.end).toBeLessThanOrEqual(html.length);
        expect(row.source.start).toBeLessThan(row.source.end);
        for (const cell of row.cells) {
          expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
          expect(cell.source.end).toBeLessThanOrEqual(row.source.end);
          expect(cell.source.start).toBeLessThan(cell.source.end);
        }
      }

      // P5: colspan/rowspan >= 1
      for (const row of table.rows) {
        for (const cell of row.cells) {
          expect(cell.colspan).toBeGreaterThanOrEqual(1);
          expect(cell.rowspan).toBeGreaterThanOrEqual(1);
        }
      }

      // P6: Cell text matches expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].text).toBe(expected.rows[r].cells[c].text);
        }
      }

      // P7: Numeric values match expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].numericValue)
            .toBe(expected.rows[r].cells[c].numericValue);
        }
      }

      // P8: colspan/rowspan match expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].colspan).toBe(expected.rows[r].cells[c].colspan);
          expect(table.rows[r].cells[c].rowspan).toBe(expected.rows[r].cells[c].rowspan);
        }
      }

      // P9: Rows are in document order (source offsets monotonically increasing)
      for (let r = 1; r < table.rows.length; r++) {
        expect(table.rows[r].source.start)
          .toBeGreaterThan(table.rows[r - 1].source.start);
      }

      // P10: No exception thrown (implicit -- test reaches this point)
    },
  );
});

// ============================================================
// Property-based tests: tryParseNumeric round-trip
// These tests will be enabled once tryParseNumeric is exported.
// For now, test numeric parsing through the full pipeline.
// ============================================================

describe('property: numeric parsing through pipeline', () => {
  it('plain integers always parse correctly', () => {
    for (let i = 0; i < 50; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = n.toLocaleString('en-US');
      const html = wrapInSection(`<table><tr><td>${formatted}</td></tr></table>`);
      const doc = parseFiling(makeRawFiling(html));
      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
      if (table && table.rows.length > 0) {
        expect(table.rows[0].cells[0].numericValue).toBe(n);
      }
    }
  });

  it('currency-formatted values always parse correctly', () => {
    for (let i = 0; i < 50; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = `$${n.toLocaleString('en-US')}`;
      const html = wrapInSection(`<table><tr><td>${formatted}</td></tr></table>`);
      const doc = parseFiling(makeRawFiling(html));
      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
      if (table && table.rows.length > 0) {
        expect(table.rows[0].cells[0].numericValue).toBe(n);
      }
    }
  });

  it('parenthetical negatives always parse correctly', () => {
    for (let i = 0; i < 50; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = `(${n.toLocaleString('en-US')})`;
      const html = wrapInSection(`<table><tr><td>${formatted}</td></tr></table>`);
      const doc = parseFiling(makeRawFiling(html));
      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
      if (table && table.rows.length > 0) {
        expect(table.rows[0].cells[0].numericValue).toBe(-n);
      }
    }
  });

  it('non-numeric strings never produce a value', () => {
    const words = ['Revenue', 'Total', 'N/A', 'abc', 'Item 1', 'million'];
    for (const w of words) {
      const html = wrapInSection(`<table><tr><td>${w}</td></tr></table>`);
      const doc = parseFiling(makeRawFiling(html));
      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
      if (table && table.rows.length > 0) {
        expect(table.rows[0].cells[0].numericValue).toBeUndefined();
      }
    }
  });
});

// ============================================================
// Edge-case property tests (Scenario 7)
// ============================================================

describe('property: edge-case tables handled gracefully', () => {
  it('empty table (0 rows) does not throw', () => {
    const html = wrapInSection('<table></table>');
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
  });

  it('single-cell table works correctly', () => {
    const html = wrapInSection('<table><tr><td>Only cell</td></tr></table>');
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells).toHaveLength(1);
    expect(table.rows[0].cells[0].text).toBe('Only cell');
  });

  it('table with empty rows does not throw', () => {
    const html = wrapInSection('<table><tr></tr><tr><td>Valid</td></tr></table>');
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows.some(r => r.cells.length > 0)).toBe(true);
  });

  it('very large table (100+ rows) does not crash', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      `<tr><td>Row ${i}</td><td>${i * 100}</td></tr>`
    ).join('\n');
    const html = wrapInSection(`<table>${rows}</table>`);
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(100);
  });

  it('malformed table HTML does not throw', () => {
    const html = wrapInSection('<table><tr><td>Cell 1<td>Cell 2<tr><td>Cell 3</table>');
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
  });

  it('table with invalid colspan/rowspan does not throw', () => {
    const html = wrapInSection(
      '<table><tr><td colspan="0">A</td></tr><tr><td colspan="abc">B</td></tr></table>'
    );
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    if (table) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          expect(cell.colspan).toBeGreaterThanOrEqual(1);
          expect(cell.rowspan).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  // B4: Table with only header rows (no data)
  it('table with only header rows works correctly', () => {
    const html = wrapInSection(
      '<table><thead><tr><th>Col A</th><th>Col B</th></tr></thead></table>'
    );
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].isHeader).toBe(true);
  });

  // B5: Nested tables -- inner table text folds into outer cell
  it('nested table text folds into outer cell', () => {
    const html = wrapInSection(
      '<table><tr><td>Outer <table><tr><td>Inner data</td></tr></table></td></tr></table>'
    );
    expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
    const doc = parseFiling(makeRawFiling(html));
    const tables = doc.sections[0]?.blocks.filter(b => b.type === 'table') as Table[];
    // Only the outer table is extracted as a block
    expect(tables).toHaveLength(1);
    // Inner table's text is accumulated into the outer cell
    expect(tables[0].rows[0].cells[0].text).toContain('Inner data');
  });

  // B7: Cells with very long content
  it('cell with long text content does not truncate', () => {
    const longText = 'A'.repeat(5000);
    const html = wrapInSection(`<table><tr><td>${longText}</td></tr></table>`);
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows[0].cells[0].text).toBe(longText);
  });

  // B8: Inconsistent column counts across rows
  it('rows with different numbers of cells are preserved', () => {
    const html = wrapInSection(`<table>
      <tr><td>A</td><td>B</td><td>C</td></tr>
      <tr><td>D</td><td>E</td></tr>
      <tr><td>F</td></tr>
    </table>`);
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].cells).toHaveLength(3);
    expect(table.rows[1].cells).toHaveLength(2);
    expect(table.rows[2].cells).toHaveLength(1);
  });

  // E2: Table with no <tr> elements
  it('table with no <tr> elements produces empty rows', () => {
    const html = wrapInSection(
      '<table><caption>Financial Summary</caption></table>'
    );
    const doc = parseFiling(makeRawFiling(html));
    const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
    expect(table).toBeDefined();
    expect(table.rows).toHaveLength(0);
  });
});

// ============================================================
// Layout table transparency tests
// ============================================================

describe('property: layout wrapper tables are transparent', () => {
  it('single layout wrapper yields inner tables and paragraphs, not one giant table', () => {
    const html = wrapInSection(`
      <table><tr><td>
        <table><tr><td>Revenue</td><td>$100</td></tr></table>
        <p>Some text between tables</p>
        <table><tr><td>Expenses</td><td>$80</td></tr></table>
      </td></tr></table>
    `);
    const doc = parseFiling(makeRawFiling(html));
    const blocks = doc.sections[0]?.blocks ?? [];

    const tables = blocks.filter(b => b.type === 'table') as Table[];
    const paragraphs = blocks.filter(b => b.type === 'paragraph');

    // The outer layout table should be unwrapped, exposing 2 inner data tables
    expect(tables).toHaveLength(2);
    // The paragraph between the tables should be extracted
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs.some(p => p.text.includes('Some text between tables'))).toBe(true);

    // Verify inner table content is intact
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows[0].cells[0].text).toBe('Revenue');
    expect(tables[0].rows[0].cells[1].text).toBe('$100');

    expect(tables[1].rows).toHaveLength(1);
    expect(tables[1].rows[0].cells[0].text).toBe('Expenses');
    expect(tables[1].rows[0].cells[1].text).toBe('$80');
  });

  it('nested layout wrappers are all unwrapped to reach inner data table', () => {
    const html = wrapInSection(`
      <table><tr><td>
        <table><tr><td>
          <table><tr><td>Data</td><td>42</td></tr></table>
        </td></tr></table>
      </td></tr></table>
    `);
    const doc = parseFiling(makeRawFiling(html));
    const blocks = doc.sections[0]?.blocks ?? [];

    const tables = blocks.filter(b => b.type === 'table') as Table[];

    // Both outer layout tables should be unwrapped; only the innermost data table remains
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows[0].cells[0].text).toBe('Data');
    expect(tables[0].rows[0].cells[1].text).toBe('42');
    expect(tables[0].rows[0].cells[1].numericValue).toBe(42);
  });

  it('regular data table with no nesting stays intact', () => {
    const html = wrapInSection(`
      <table>
        <tr><th>Item</th><th>Amount</th></tr>
        <tr><td>Revenue</td><td>$1,000</td></tr>
        <tr><td>Expenses</td><td>$800</td></tr>
      </table>
    `);
    const doc = parseFiling(makeRawFiling(html));
    const blocks = doc.sections[0]?.blocks ?? [];

    const tables = blocks.filter(b => b.type === 'table') as Table[];

    // A plain data table is NOT a layout table; it should be extracted as one block
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[0].rows[0].isHeader).toBe(true);
    expect(tables[0].rows[0].cells[0].text).toBe('Item');
    expect(tables[0].rows[1].cells[0].text).toBe('Revenue');
    expect(tables[0].rows[2].cells[0].text).toBe('Expenses');
  });
});
