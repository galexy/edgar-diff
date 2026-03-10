/**
 * diff-simple.ts — Minimal year-over-year diff (AAPL 2023 vs 2024)
 *
 * Demonstrates the core pipeline: load HTML → parseFiling() → diffFilings() → summary.
 *
 * Usage: npx tsx examples/diff-simple.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
    cik: '0000320193',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from(`${year}-10-27`),
    primaryDocumentFilename: `10k-${ticker}-${year}.html`,
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

console.log('=== diff-simple: AAPL 2023 vs 2024 ===\n');

const t0 = performance.now();
const oldDoc = parseFiling(loadFiling('aapl', 2023));
const newDoc = parseFiling(loadFiling('aapl', 2024));
const parseTime = performance.now() - t0;

const t1 = performance.now();
const result = diffFilings(oldDoc, newDoc);
const diffTime = performance.now() - t1;

console.log(`Parse time: ${parseTime.toFixed(0)}ms | Diff time: ${diffTime.toFixed(0)}ms\n`);

// Section-level summary
console.log('Summary:');
console.log(`  added:     ${result.summary.added}`);
console.log(`  removed:   ${result.summary.removed}`);
console.log(`  modified:  ${result.summary.modified}`);
console.log(`  unchanged: ${result.summary.unchanged}`);
console.log(`  reordered: ${result.summary.reordered}`);
console.log(`  total:     ${result.sectionDiffs.length}\n`);

// Per-section detail
console.log('Sections:');
for (const sd of result.sectionDiffs) {
  const tableDiffCount = sd.tableDiffs.length;
  const paraDiffCount = sd.paragraphDiffs.length;
  console.log(`  [${sd.changeType.padEnd(10)}] ${sd.heading}  (${paraDiffCount} para diffs, ${tableDiffCount} table diffs)`);
}

// Write JSON output
const outputPath = join(import.meta.dirname, 'aapl-diff-output.json');
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`\nJSON output written to ${outputPath}`);
