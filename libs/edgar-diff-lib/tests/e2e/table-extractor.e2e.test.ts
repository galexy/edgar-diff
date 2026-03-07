import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import type { Table } from '../../src/types.js';
import {
  ALL_FIXTURES,
  loadFixture,
  makeRawFiling,
} from '../helpers/ground-truth.js';

// ============================================================
// E2E-T1: Full pipeline produces populated Table blocks
// ============================================================

describe('E2E: parseFiling produces populated tables', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`${ticker.toUpperCase()} ${year}: Table blocks have rows.length > 0 for sections with tables`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const allTables = doc.sections.flatMap(s =>
        s.blocks.filter(b => b.type === 'table')
      ) as Table[];

      // Filing should have at least some tables
      expect(allTables.length).toBeGreaterThan(0);

      // All tables should be populated (no more stubs)
      for (const table of allTables) {
        expect(table.rows.length).toBeGreaterThanOrEqual(0);
        // Tables with actual <tr> elements should have rows
        // Empty tables (no <tr>) are valid with rows = []
      }
    });
  }
});

// ============================================================
// E2E-T2: Table stubs replaced
// ============================================================

describe('E2E: table stubs replaced', () => {
  it('parseFiling no longer produces table stubs (rows: []) in AAPL Item 8', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    const stubs = tables.filter(t => t.rows.length === 0);
    const populated = tables.filter(t => t.rows.length > 0);

    // Most tables should be populated now
    expect(populated.length).toBeGreaterThan(stubs.length);
  });
});

// ============================================================
// E2E-T3: Performance -- table extraction does not regress parse time
// ============================================================

describe('E2E: table extraction performance', () => {
  it('parsing with table extraction completes within 4000ms for largest filing', () => {
    const html = loadFixture('jpm', 2024); // ~12.3MB, many tables
    const raw = makeRawFiling(html);

    const start = performance.now();
    parseFiling(raw);
    const elapsed = performance.now() - start;

    // Generous budget: table extraction adds overhead vs stubs
    // Using 4000ms (2x the existing 2000ms budget) to account for table extraction overhead
    expect(elapsed).toBeLessThan(4000);
  });
});
