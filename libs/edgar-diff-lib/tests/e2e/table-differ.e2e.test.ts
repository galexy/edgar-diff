import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import type { Table } from '../../src/types.js';
import { diffTables } from '../../src/diff/table-differ.js';
import { loadFixture, makeRawFiling } from '../helpers/ground-truth.js';
import type { TableDiff } from '../../src/diff/types.js';

// ============================================================
// E2E: Full pipeline with committed fixture HTML files
// ============================================================

function extractTablesFromItem8(html: string): Table[] {
  const doc = parseFiling(makeRawFiling(html));
  const item8 = doc.sections.find(s => s.id === 'item-8');
  if (!item8) return [];
  return item8.blocks.filter(b => b.type === 'table') as Table[];
}

describe('table diff e2e', () => {
  let diffs: TableDiff[];
  let oldHtml: string;
  let newHtml: string;

  // Use MSFT 2023 vs 2024 as our e2e fixture pair
  beforeAll(() => {
    oldHtml = loadFixture('msft', 2023);
    newHtml = loadFixture('msft', 2024);

    const oldTables = extractTablesFromItem8(oldHtml);
    const newTables = extractTablesFromItem8(newHtml);

    expect(oldTables.length).toBeGreaterThan(0);
    expect(newTables.length).toBeGreaterThan(0);

    diffs = diffTables(oldTables, newTables);
  });

  it('full pipeline with committed fixture HTML files produces tableDiffs', () => {
    expect(diffs.length).toBeGreaterThan(0);

    // No exceptions thrown (implicit by reaching here)
    // At least some tables should be matched (modified or unchanged)
    const matched = diffs.filter(d => d.changeType === 'modified' || d.changeType === 'unchanged');
    expect(matched.length).toBeGreaterThan(0);
  });

  it('tableDiff summary counts are internally consistent', () => {
    for (const diff of diffs) {
      if (diff.changeType === 'added' || diff.changeType === 'removed') {
        // Added/removed tables have empty diffs
        expect(diff.rowDiffs).toHaveLength(0);
        expect(diff.cellDiffs).toHaveLength(0);
        continue;
      }

      // Summary counts should add up
      const total = diff.summary.rowsAdded + diff.summary.rowsRemoved +
        diff.summary.rowsModified + diff.summary.rowsUnchanged;
      const maxRows = Math.max(
        diff.oldTable?.rows.length ?? 0,
        diff.newTable?.rows.length ?? 0,
      );
      expect(total).toBe(maxRows);

      // cellDiffs.length should equal summary.cellsChanged
      expect(diff.cellDiffs.length).toBe(diff.summary.cellsChanged);
    }
  });

  it('all cellDiff source mappings are valid', () => {
    for (const diff of diffs) {
      for (const cd of diff.cellDiffs) {
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

  it('cellDiffs flat list matches rowDiffs contents', () => {
    for (const diff of diffs) {
      const flatFromRows = diff.rowDiffs.flatMap(rd => rd.cellDiffs);
      expect(diff.cellDiffs).toEqual(flatFromRows);
    }
  });
});
