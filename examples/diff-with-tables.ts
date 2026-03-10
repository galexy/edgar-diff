/**
 * diff-with-tables.ts — Table-level diff inspection (JPM 2023 vs 2024)
 *
 * Demonstrates table-level diff detail: iterates sectionDiffs, filters for sections
 * with tableDiffs, prints per-table row/cell change counts and numeric value changes.
 *
 * Usage: npx tsx examples/diff-with-tables.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFiling } from '../libs/edgar-diff-lib/src/index.js';
import { diffFilings } from '../libs/edgar-diff-lib/src/diff/index.js';
import type { RawFiling } from '../libs/edgar-diff-lib/src/client/types.js';
import { Temporal } from '@js-temporal/polyfill';

const FIXTURES = join(import.meta.dirname, '..', 'libs', 'edgar-diff-lib', 'tests', 'integration', 'fixtures');

function loadFiling(ticker: string, year: number): RawFiling {
  const html = readFileSync(join(FIXTURES, `10k-${ticker}-${year}.html`), 'utf-8');
  return {
    accessionNumber: `0000000000-${String(year).slice(2)}-000000`,
    cik: '0000019617',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from(`${year}-02-20`),
    primaryDocumentFilename: `10k-${ticker}-${year}.html`,
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

console.log('=== diff-with-tables: JPM 2023 vs 2024 ===\n');

const t0 = performance.now();
const oldDoc = parseFiling(loadFiling('jpm', 2023));
const newDoc = parseFiling(loadFiling('jpm', 2024));
const parseTime = performance.now() - t0;

const t1 = performance.now();
const result = diffFilings(oldDoc, newDoc);
const diffTime = performance.now() - t1;

console.log(`Parse time: ${parseTime.toFixed(0)}ms | Diff time: ${diffTime.toFixed(0)}ms\n`);
console.log(`Total sections: ${result.sectionDiffs.length}`);
console.log(`Summary: added=${result.summary.added} removed=${result.summary.removed} modified=${result.summary.modified} unchanged=${result.summary.unchanged}\n`);

// Filter sections with table diffs
const sectionsWithTables = result.sectionDiffs.filter(sd => sd.tableDiffs.length > 0);
console.log(`Sections with table diffs: ${sectionsWithTables.length}\n`);

for (const sd of sectionsWithTables) {
  console.log(`--- ${sd.heading} [${sd.changeType}] ---`);
  console.log(`  Paragraph diffs: ${sd.paragraphDiffs.length}`);
  console.log(`  Table diffs: ${sd.tableDiffs.length}`);

  for (let i = 0; i < sd.tableDiffs.length; i++) {
    const td = sd.tableDiffs[i];
    console.log(`\n  Table ${i + 1}: ${td.changeType}`);
    console.log(`    Rows: +${td.summary.rowsAdded} -${td.summary.rowsRemoved} ~${td.summary.rowsModified} =${td.summary.rowsUnchanged}`);
    console.log(`    Cells changed: ${td.summary.cellsChanged}`);

    // Show numeric value changes (up to 5)
    const numericChanges = td.cellDiffs.filter(
      cd => cd.oldNumericValue !== undefined && cd.newNumericValue !== undefined,
    );
    if (numericChanges.length > 0) {
      console.log(`    Numeric changes (showing up to 5):`);
      for (const cd of numericChanges.slice(0, 5)) {
        console.log(`      [${cd.row},${cd.col}] ${cd.oldNumericValue} -> ${cd.newNumericValue}`);
      }
      if (numericChanges.length > 5) {
        console.log(`      ... and ${numericChanges.length - 5} more`);
      }
    }
  }
  console.log();
}

if (sectionsWithTables.length === 0) {
  console.log('No sections with table diffs found.');
}
