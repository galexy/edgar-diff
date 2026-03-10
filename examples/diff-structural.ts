/**
 * diff-structural.ts — Major structural changes (XOM 2012 vs 2024)
 *
 * Demonstrates handling of extreme structural changes across a 12-year gap:
 * added/removed sections, table stubs, alignment algorithm under stress.
 *
 * Usage: npx tsx examples/diff-structural.ts
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
    cik: '0000034088',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from(`${year}-02-27`),
    primaryDocumentFilename: `10k-${ticker}-${year}.html`,
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

console.log('=== diff-structural: XOM 2012 vs 2024 ===\n');

const t0 = performance.now();
const oldDoc = parseFiling(loadFiling('xom', 2012));
const newDoc = parseFiling(loadFiling('xom', 2024));
const parseTime = performance.now() - t0;

const t1 = performance.now();
const result = diffFilings(oldDoc, newDoc);
const diffTime = performance.now() - t1;

console.log(`Parse time: ${parseTime.toFixed(0)}ms | Diff time: ${diffTime.toFixed(0)}ms\n`);

// Document structure comparison
console.log('Document structure:');
console.log(`  Old (2012): ${oldDoc.sections.length} sections`);
console.log(`  New (2024): ${newDoc.sections.length} sections`);
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
  const tableCount = sd.tableDiffs.length;
  const paraCount = sd.paragraphDiffs.length;
  const tableStubTypes = sd.tableDiffs.map(td => td.changeType);

  let detail = `  [${sd.changeType.padEnd(10)}] ${sd.heading}`;
  detail += ` — ${paraCount} para diffs, ${tableCount} table diffs`;

  if (tableCount > 0) {
    const added = tableStubTypes.filter(t => t === 'added').length;
    const removed = tableStubTypes.filter(t => t === 'removed').length;
    const modified = tableStubTypes.filter(t => t === 'modified').length;
    const unchanged = tableStubTypes.filter(t => t === 'unchanged').length;
    detail += ` (tables: +${added} -${removed} ~${modified} =${unchanged})`;
  }

  console.log(detail);
}
