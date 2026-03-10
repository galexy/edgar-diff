/**
 * diff-with-tables.ts — Table-level diff inspection
 *
 * Demonstrates table-level diff detail: iterates sectionDiffs, filters for sections
 * with tableDiffs, prints per-table row/cell change counts and numeric value changes.
 *
 * Usage:
 *   npx tsx examples/diff-with-tables.ts                     # defaults: JPM 2023 vs 2024
 *   npx tsx examples/diff-with-tables.ts old.html new.html   # any two filings
 */
import { parseFiling } from '../libs/edgar-diff-lib/src/index.js';
import { diffFilings } from '../libs/edgar-diff-lib/src/diff/index.js';
import { loadFilingFromPath, fixturePath, parseFilingArgs } from './shared.js';

const [oldPath, newPath] = parseFilingArgs(
  fixturePath('10k-jpm-2023.html'),
  fixturePath('10k-jpm-2024.html'),
);

console.log(`=== diff-with-tables ===`);
console.log(`Old: ${oldPath}`);
console.log(`New: ${newPath}\n`);

const t0 = performance.now();
const oldDoc = parseFiling(loadFilingFromPath(oldPath));
const newDoc = parseFiling(loadFilingFromPath(newPath));
const parseTime = performance.now() - t0;

const t1 = performance.now();
const result = diffFilings(oldDoc, newDoc);
const diffTime = performance.now() - t1;

console.log(`Parse time: ${parseTime.toFixed(0)}ms | Diff time: ${diffTime.toFixed(0)}ms\n`);
console.log(`Total sections: ${result.sectionDiffs.length}`);
console.log(`Summary: added=${result.summary.added} removed=${result.summary.removed} modified=${result.summary.modified} unchanged=${result.summary.unchanged}\n`);

// Filter sections with actual table changes (exclude unchanged)
const sectionsWithTableChanges = result.sectionDiffs.filter(
  sd => sd.tableDiffs.some(td => td.changeType !== 'unchanged'),
);
console.log(`Sections with table changes: ${sectionsWithTableChanges.length}\n`);

for (const sd of sectionsWithTableChanges) {
  const changedTables = sd.tableDiffs.filter(td => td.changeType !== 'unchanged');
  const paraChanges = sd.paragraphDiffs.filter(pd => pd.changeType !== 'unchanged').length;
  console.log(`--- ${sd.heading} [${sd.changeType}] ---`);
  console.log(`  Paragraph changes: ${paraChanges}`);
  console.log(`  Table changes: ${changedTables.length} (${sd.tableDiffs.length - changedTables.length} unchanged)`);

  for (let i = 0; i < changedTables.length; i++) {
    const td = changedTables[i];
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

if (sectionsWithTableChanges.length === 0) {
  console.log('No sections with table changes found.');
}
