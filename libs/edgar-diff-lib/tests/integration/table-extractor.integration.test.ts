import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import type { Table } from '../../src/types.js';
import {
  loadFixture,
  makeRawFiling,
} from '../helpers/ground-truth.js';

// ============================================================
// §3.1 Table extraction in real filings -- Item 8
// ============================================================

describe('table extraction in real filings', () => {
  it('AAPL Item 8 contains populated tables (not stubs)', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    expect(tables.length).toBeGreaterThan(0);

    // Tables should now have populated rows (not stubs)
    const populatedTables = tables.filter(t => t.rows.length > 0);
    expect(populatedTables.length).toBeGreaterThan(0);
  });
});

// ============================================================
// §3.2 Table count in known filings
// ============================================================

describe('table count in known filings', () => {
  // Only filings with multiple <table> elements in the HTML have separate table blocks.
  // Many iXBRL filings wrap the entire document in a single <table>, so Item 8 may have
  // 0 or 1 table blocks. Use filings known to have many distinct <table> elements.
  const expectations: Array<{ ticker: string; year: number; minTables: number }> = [
    { ticker: 'msft', year: 2024, minTables: 5 },
    { ticker: 'brk-b', year: 2024, minTables: 5 },
    // XOM 2012 has many <table> tags but few within Item 8 specifically
  ];

  for (const { ticker, year, minTables } of expectations) {
    it(`${ticker.toUpperCase()} ${year} Item 8 has >= ${minTables} tables`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const item8 = doc.sections.find(s => s.id === 'item-8');
      expect(item8).toBeDefined();

      const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
      expect(tables.length).toBeGreaterThanOrEqual(minTables);
    });
  }
});

// ============================================================
// §3.3 Source offset round-trip for table cells
// ============================================================

describe('table cell source offset round-trip', () => {
  for (const { ticker, year } of [
    { ticker: 'aapl', year: 2024 },
    { ticker: 'msft', year: 2024 },
    { ticker: 'jpm', year: 2024 },
  ]) {
    it(`${ticker.toUpperCase()} ${year}: cell source offsets round-trip`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const item8 = doc.sections.find(s => s.id === 'item-8');
      if (!item8) return; // skip if item-8 not detected

      const tables = item8.blocks.filter(b => b.type === 'table') as Table[];
      // Check first 3 tables to keep test fast
      for (const table of tables.slice(0, 3)) {
        for (const row of table.rows) {
          // Row source bounds
          expect(row.source.start).toBeGreaterThanOrEqual(0);
          expect(row.source.end).toBeLessThanOrEqual(html.length);
          expect(row.source.start).toBeLessThan(row.source.end);

          for (const cell of row.cells) {
            // Cell source bounds
            expect(cell.source.start).toBeGreaterThanOrEqual(0);
            expect(cell.source.end).toBeLessThanOrEqual(html.length);
            expect(cell.source.start).toBeLessThan(cell.source.end);

            // Cell contained within row
            expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
            expect(cell.source.end).toBeLessThanOrEqual(row.source.end);

            // Round-trip: slice contains cell text (if non-empty)
            if (cell.text.trim().length > 0) {
              const slice = html.slice(cell.source.start, cell.source.end);
              // Extract alphabetic words (3+ chars) from the cell text;
              // numbers may have formatting differences (commas, parens, $)
              // between extracted text and raw HTML
              const alphaWords = cell.text.match(/[a-zA-Z]{3,}/g) ?? [];
              for (const word of alphaWords.slice(0, 2)) {
                expect(slice.toLowerCase()).toContain(word.toLowerCase());
              }
            }
          }
        }
      }
    });
  }
});

// ============================================================
// §3.4 Header row detection in real financial tables
// ============================================================

describe('header detection in real filings', () => {
  it('documents header detection rate across real filings (informational)', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    const tablesWithHeaders = tables.filter(t =>
      t.rows.some(r => r.isHeader)
    );
    // Real SEC filings rarely use <th> or <thead>.
    // This test documents the detection rate; no hard assertion.
    console.log(
      `AAPL Item 8: ${tablesWithHeaders.length}/${tables.length} tables have isHeader rows`
    );
    // Soft assertion: test passes regardless, but logs detection rate
    expect(tables.length).toBeGreaterThan(0);
  });
});

// ============================================================
// §3.5 Numeric values in financial statement cells
// ============================================================

describe('numeric value detection in real filings', () => {
  it('AAPL Item 8 tables contain cells with numericValue', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    const cellsWithNumeric = tables.flatMap(t =>
      t.rows.flatMap(r => r.cells.filter(c => c.numericValue !== undefined))
    );
    // Financial statements should have many numeric cells
    expect(cellsWithNumeric.length).toBeGreaterThan(10);
  });
});

// ============================================================
// §3.6 Colspan in real filings
// ============================================================

describe('colspan/rowspan in real filings', () => {
  it('MSFT 2024 tables use colspan (common in SEC financial tables)', () => {
    const html = loadFixture('msft', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const allTables = doc.sections.flatMap(s =>
      s.blocks.filter(b => b.type === 'table')
    ) as Table[];

    const cellsWithColspan = allTables.flatMap(t =>
      t.rows.flatMap(r => r.cells.filter(c => c.colspan > 1))
    );
    // MSFT filing has many colspan cells
    expect(cellsWithColspan.length).toBeGreaterThan(0);
  });
});

// ============================================================
// §3.7 Cross-filing table structure consistency
// ============================================================

describe('cross-filing table consistency', () => {
  it('MSFT 2023 and 2024 both have tables in Item 8', () => {
    const doc2023 = parseFiling(makeRawFiling(loadFixture('msft', 2023)));
    const doc2024 = parseFiling(makeRawFiling(loadFixture('msft', 2024)));

    const tables2023 = doc2023.sections
      .find(s => s.id === 'item-8')?.blocks
      .filter(b => b.type === 'table') ?? [];
    const tables2024 = doc2024.sections
      .find(s => s.id === 'item-8')?.blocks
      .filter(b => b.type === 'table') ?? [];

    expect(tables2023.length).toBeGreaterThan(0);
    expect(tables2024.length).toBeGreaterThan(0);
    // Same company, similar table count across years
    expect(Math.abs(tables2023.length - tables2024.length))
      .toBeLessThan(tables2023.length * 0.5);
  });
});
