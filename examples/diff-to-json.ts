/**
 * diff-to-json.ts — JSON pipeline for downstream consumers (MSFT 2023 vs 2024)
 *
 * Demonstrates JSON serialization: JSON.stringify(structuredDiff) works natively
 * (Temporal polyfill provides toJSON()), verifies round-trip deserialization.
 *
 * Usage: npx tsx examples/diff-to-json.ts > output.json
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
    cik: '0000789019',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from(`${year}-07-30`),
    primaryDocumentFilename: `10k-${ticker}-${year}.html`,
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

// Use stderr for status so stdout is clean JSON
const log = (msg: string) => process.stderr.write(msg + '\n');

log('=== diff-to-json: MSFT 2023 vs 2024 ===');

const t0 = performance.now();
const oldDoc = parseFiling(loadFiling('msft', 2023));
const newDoc = parseFiling(loadFiling('msft', 2024));
const parseTime = performance.now() - t0;

const t1 = performance.now();
const result = diffFilings(oldDoc, newDoc);
const diffTime = performance.now() - t1;

log(`Parse time: ${parseTime.toFixed(0)}ms | Diff time: ${diffTime.toFixed(0)}ms`);

// Serialize — no custom replacer needed, Temporal polyfill provides toJSON()
const json = JSON.stringify(result, null, 2);
log(`JSON size: ${(json.length / 1024).toFixed(1)} KB`);

// Verify round-trip
const parsed = JSON.parse(json);
log(`\nRound-trip verification:`);
log(`  sectionDiffs count: ${parsed.sectionDiffs.length} (original: ${result.sectionDiffs.length})`);
log(`  summary: ${JSON.stringify(parsed.summary)}`);
log(`  generatedAt: "${parsed.generatedAt}" (type: ${typeof parsed.generatedAt})`);
log(`  oldFiling.filingDate: "${parsed.oldFiling.filingDate}"`);

// Verify Temporal.Instant can be restored
const restored = Temporal.Instant.from(parsed.generatedAt);
log(`  generatedAt restored: ${restored.toString()}`);

// Count total table diffs across all sections
const totalTableDiffs = parsed.sectionDiffs.reduce(
  (sum: number, sd: { tableDiffs: unknown[] }) => sum + sd.tableDiffs.length, 0,
);
log(`  total tableDiffs: ${totalTableDiffs}`);

// Output clean JSON to stdout
console.log(json);
