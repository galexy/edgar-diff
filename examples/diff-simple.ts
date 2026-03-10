/**
 * diff-simple.ts — Minimal section-level diff
 *
 * Demonstrates the core pipeline: load HTML → parseFiling() → diffFilings() → summary.
 *
 * Usage:
 *   npx tsx examples/diff-simple.ts                          # defaults: AAPL 2023 vs 2024
 *   npx tsx examples/diff-simple.ts old.html new.html        # any two filings
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFiling } from '../libs/edgar-diff-lib/src/index.js';
import { diffFilings } from '../libs/edgar-diff-lib/src/diff/index.js';
import { loadFilingFromPath, fixturePath, parseFilingArgs } from './shared.js';

const [oldPath, newPath] = parseFilingArgs(
  fixturePath('10k-aapl-2023.html'),
  fixturePath('10k-aapl-2024.html'),
);

console.log(`=== diff-simple ===`);
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
const outputPath = join(import.meta.dirname, 'diff-output.json');
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`\nJSON output written to ${outputPath}`);
