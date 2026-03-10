/**
 * diff-structural.ts — Major structural changes
 *
 * Demonstrates handling of extreme structural changes:
 * added/removed sections, table stubs, alignment algorithm under stress.
 *
 * Usage:
 *   npx tsx examples/diff-structural.ts                      # defaults: XOM 2012 vs 2024
 *   npx tsx examples/diff-structural.ts old.html new.html    # any two filings
 */
import { parseFiling } from '../libs/edgar-diff-lib/src/index.js';
import { diffFilings } from '../libs/edgar-diff-lib/src/diff/index.js';
import { loadFilingFromPath, fixturePath, parseFilingArgs } from './shared.js';

const [oldPath, newPath] = parseFilingArgs(
  fixturePath('10k-xom-2012.html'),
  fixturePath('10k-xom-2024.html'),
);

console.log(`=== diff-structural ===`);
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

// Document structure comparison
console.log('Document structure:');
console.log(`  Old: ${oldDoc.sections.length} sections`);
console.log(`  New: ${newDoc.sections.length} sections`);
console.log();

// Summary
console.log('Diff summary:');
console.log(`  added:     ${result.summary.added}`);
console.log(`  removed:   ${result.summary.removed}`);
console.log(`  modified:  ${result.summary.modified}`);
console.log(`  unchanged: ${result.summary.unchanged}`);
console.log(`  reordered: ${result.summary.reordered}`);
console.log(`  total:     ${result.sectionDiffs.length}`);
console.log();

// Per-section detail
console.log('Section-by-section breakdown:');
for (const sd of result.sectionDiffs) {
  const paraChanges = sd.paragraphDiffs.filter(pd => pd.changeType !== 'unchanged').length;
  const changedTables = sd.tableDiffs.filter(td => td.changeType !== 'unchanged');
  const unchangedTables = sd.tableDiffs.length - changedTables.length;

  let detail = `  [${sd.changeType.padEnd(10)}] ${sd.heading}`;
  detail += ` — ${paraChanges} para changes, ${changedTables.length} table changes`;

  if (changedTables.length > 0) {
    const added = changedTables.filter(t => t.changeType === 'added').length;
    const removed = changedTables.filter(t => t.changeType === 'removed').length;
    const modified = changedTables.filter(t => t.changeType === 'modified').length;
    detail += ` (+${added} -${removed} ~${modified})`;
  }
  if (unchangedTables > 0) {
    detail += ` [${unchangedTables} unchanged]`;
  }

  console.log(detail);
}
