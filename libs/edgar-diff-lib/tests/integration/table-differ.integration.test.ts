import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import type { Table } from '../../src/types.js';
import { diffTable, diffTables } from '../../src/diff/table-differ.js';
import { makeRawFiling } from '../helpers/ground-truth.js';

// ============================================================
// Helper: wrap tables in a section
// ============================================================

function wrapInSection(...tableHtmls: string[]): string {
  return `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements and Supplementary Data</span></div>
${tableHtmls.join('\n')}
</body></html>`;
}

function extractTablesFromItem8(html: string): Table[] {
  const doc = parseFiling(makeRawFiling(html));
  const item8 = doc.sections.find(s => s.id === 'item-8');
  if (!item8) return [];
  return item8.blocks.filter(b => b.type === 'table') as Table[];
}

// ============================================================
// 3.1 Parse and diff two HTML tables end-to-end
// ============================================================

describe('table diff integration', () => {
  it('parses two inline HTML documents with financial tables, diffs end-to-end', () => {
    const oldHtml = wrapInSection(`<table>
  <tr><th>Metric</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Net Income</td><td>$20</td></tr>
</table>`);

    const newHtml = wrapInSection(`<table>
  <tr><th>Metric</th><th>2024</th></tr>
  <tr><td>Revenue</td><td>$120</td></tr>
  <tr><td>Net Income</td><td>$25</td></tr>
</table>`);

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);
    expect(oldTables.length).toBe(1);
    expect(newTables.length).toBe(1);

    const diffs = diffTables(oldTables, newTables);
    expect(diffs).toHaveLength(1);

    const diff = diffs[0];
    expect(diff.changeType).toBe('modified');

    // Header row changed (2023 -> 2024)
    // Revenue changed ($100 -> $120)
    // Net Income changed ($20 -> $25)
    expect(diff.summary.cellsChanged).toBeGreaterThanOrEqual(1);

    // cellDiffs should reflect the value changes
    const modifiedCells = diff.cellDiffs.filter(cd => cd.changeType === 'modified');
    expect(modifiedCells.length).toBeGreaterThanOrEqual(1);

    // At least one cell should have numeric values
    const numericCells = modifiedCells.filter(
      cd => cd.oldNumericValue !== undefined && cd.newNumericValue !== undefined,
    );
    expect(numericCells.length).toBeGreaterThanOrEqual(1);
  });

  // ============================================================
  // 3.2 Source mapping round-trip
  // ============================================================

  it('cellDiff sourceMapping.old/new point to correct HTML ranges', () => {
    const oldHtml = wrapInSection(`<table>
  <tr><th>Item</th><th>Amount</th></tr>
  <tr><td>Revenue</td><td>$500</td></tr>
</table>`);

    const newHtml = wrapInSection(`<table>
  <tr><th>Item</th><th>Amount</th></tr>
  <tr><td>Revenue</td><td>$600</td></tr>
</table>`);

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);
    const diff = diffTable(oldTables[0], newTables[0]);

    // Modified cellDiffs should have valid source mappings
    for (const cd of diff.cellDiffs) {
      if (cd.changeType === 'modified') {
        if (cd.sourceMapping.old) {
          expect(cd.sourceMapping.old.start).toBeLessThan(cd.sourceMapping.old.end);
          expect(cd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
        }
        if (cd.sourceMapping.new) {
          expect(cd.sourceMapping.new.start).toBeLessThan(cd.sourceMapping.new.end);
          expect(cd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('tableDiff sourceMapping covers the full table element', () => {
    const oldHtml = wrapInSection(`<table>
  <tr><td>A</td></tr>
</table>`);
    const newHtml = wrapInSection(`<table>
  <tr><td>B</td></tr>
</table>`);

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);
    const diff = diffTable(oldTables[0], newTables[0]);

    // sourceMapping should reference the table's source
    expect(diff.sourceMapping.old).toBeDefined();
    expect(diff.sourceMapping.new).toBeDefined();
    if (diff.sourceMapping.old) {
      expect(diff.sourceMapping.old.start).toBeLessThan(diff.sourceMapping.old.end);
    }
    if (diff.sourceMapping.new) {
      expect(diff.sourceMapping.new.start).toBeLessThan(diff.sourceMapping.new.end);
    }
  });

  // ============================================================
  // 3.3 Multiple tables within a section
  // ============================================================

  it('diffs multiple tables within a single matched section', () => {
    const table1 = `<table>
  <tr><th>Metric</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>`;
    const table2 = `<table>
  <tr><th>Asset</th><th>Amount</th></tr>
  <tr><td>Cash</td><td>$50</td></tr>
</table>`;

    const oldHtml = wrapInSection(table1, table2);

    const newTable1 = `<table>
  <tr><th>Metric</th><th>2024</th></tr>
  <tr><td>Revenue</td><td>$120</td></tr>
</table>`;
    const newTable2 = `<table>
  <tr><th>Asset</th><th>Amount</th></tr>
  <tr><td>Cash</td><td>$60</td></tr>
</table>`;

    const newHtml = wrapInSection(newTable1, newTable2);

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);
    expect(oldTables.length).toBe(2);
    expect(newTables.length).toBe(2);

    const diffs = diffTables(oldTables, newTables);
    expect(diffs).toHaveLength(2);
  });

  it('handles different table counts (1 old, 2 new)', () => {
    const oldHtml = wrapInSection(`<table>
  <tr><th>Metric</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>`);

    const newHtml = wrapInSection(
      `<table>
  <tr><th>Metric</th><th>2024</th></tr>
  <tr><td>Revenue</td><td>$120</td></tr>
</table>`,
      `<table>
  <tr><th>New Table</th><th>Data</th></tr>
  <tr><td>Entry</td><td>$50</td></tr>
</table>`,
    );

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);
    expect(oldTables.length).toBe(1);
    expect(newTables.length).toBe(2);

    const diffs = diffTables(oldTables, newTables);

    // Should have one matched + one added
    const matched = diffs.filter(d => d.changeType !== 'added');
    const added = diffs.filter(d => d.changeType === 'added');
    expect(matched.length).toBe(1);
    expect(added.length).toBe(1);
    expect('newTable' in added[0]).toBe(false);
    expect('oldTable' in added[0]).toBe(false);
    expect(added[0].sourceMapping.new).toBeDefined();
  });
});
