/**
 * Main runner for the diff algorithm spike.
 * Loads filings, extracts sections, aligns them, and runs paragraph diffs.
 * Reports measurements and comparison between patience and Myers.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections } from './section-extractor.js';
import { alignSections, experimentThresholds } from './section-aligner.js';
import { diffParagraphs, type DiffResult } from './paragraph-differ.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

interface FilingPair {
  label: string;
  oldFile: string;
  newFile: string;
}

const FILING_PAIRS: FilingPair[] = [
  { label: 'Apple FY2023 → FY2024', oldFile: 'apple-fy2023.htm', newFile: 'apple-fy2024.htm' },
  {
    label: 'Microsoft FY2023 → FY2024',
    oldFile: 'microsoft-fy2023.htm',
    newFile: 'microsoft-fy2024.htm',
  },
];

/** Standard 10-K items that should always match between consecutive filings */
const STANDARD_ITEMS = [
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8', '9', '9a', '9b',
  '10', '11', '12', '13', '14', '15',
];

function loadFiling(filename: string): string {
  const path = join(FIXTURES_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`Filing not found: ${path}\nRun fetch-filings.ts first.`);
  }
  return readFileSync(path, 'utf-8');
}

function extractItemNumber(heading: string): string | null {
  const match = heading.match(/item\s+(\d+[a-z]?)/i);
  return match ? match[1].toLowerCase() : null;
}

function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const separator = colWidths.map((w) => '─'.repeat(w + 2)).join('┼');
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${(cell ?? '').padEnd(colWidths[i])} `).join('│');

  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function reportDiffResults(label: string, result: DiffResult, algorithm: string): void {
  console.log(`\n  ${algorithm} diff results:`);
  const rows: string[][] = [];
  for (const sd of result.sectionDiffs) {
    const total = sd.stats.added + sd.stats.removed + sd.stats.modified + sd.stats.unchanged;
    const changeRate = total > 0 ? ((sd.stats.added + sd.stats.removed + sd.stats.modified) / total * 100).toFixed(1) : '0';
    rows.push([
      sd.oldHeading.slice(0, 40),
      String(sd.stats.unchanged),
      String(sd.stats.modified),
      String(sd.stats.added),
      String(sd.stats.removed),
      `${changeRate}%`,
    ]);
  }
  printTable(['Section', 'Unch', 'Mod', 'Add', 'Rem', 'Change%'], rows);

  const ts = result.totalStats;
  console.log(
    `  Total: ${ts.sectionsCompared} sections, ` +
    `${ts.totalUnchanged} unchanged, ${ts.totalModified} modified, ` +
    `${ts.totalAdded} added, ${ts.totalRemoved} removed`,
  );
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SPIKE B / PROTOTYPE A: Jaro-Winkler + Patience Diff');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const pair of FILING_PAIRS) {
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`  ${pair.label}`);
    console.log(`${'─'.repeat(55)}`);

    // Load filings
    const oldHtml = loadFiling(pair.oldFile);
    const newHtml = loadFiling(pair.newFile);
    console.log(`  Old filing: ${(oldHtml.length / 1024).toFixed(0)} KB`);
    console.log(`  New filing: ${(newHtml.length / 1024).toFixed(0)} KB`);

    // Extract sections
    const t0 = performance.now();
    const oldSections = extractSections(oldHtml);
    const newSections = extractSections(newHtml);
    const extractTime = performance.now() - t0;

    console.log(`\n  Sections extracted: ${oldSections.length} old, ${newSections.length} new`);
    console.log(`  Extraction time: ${extractTime.toFixed(0)} ms`);

    // List found sections
    console.log('\n  Old sections:');
    for (const s of oldSections) {
      console.log(`    - [${extractItemNumber(s.heading) ?? '?'}] ${s.heading.slice(0, 60)} (${s.paragraphs.length} paragraphs)`);
    }
    console.log('  New sections:');
    for (const s of newSections) {
      console.log(`    - [${extractItemNumber(s.heading) ?? '?'}] ${s.heading.slice(0, 60)} (${s.paragraphs.length} paragraphs)`);
    }

    // Threshold experiments
    console.log('\n  ── Jaro-Winkler Threshold Experiments ──');
    const thresholdResults = experimentThresholds(oldSections, newSections);
    const thresholdRows = thresholdResults.map((r) => [
      r.threshold.toFixed(2),
      String(r.matched),
      String(r.added),
      String(r.removed),
      r.avgSimilarity.toFixed(3),
    ]);
    printTable(['Threshold', 'Matched', 'Added', 'Removed', 'AvgSim'], thresholdRows);

    // Section alignment with default threshold
    const t1 = performance.now();
    const alignment = alignSections(oldSections, newSections, 0.75);
    const alignTime = performance.now() - t1;

    console.log(`\n  ── Section Alignment (threshold=0.75) ──`);
    console.log(`  Matched: ${alignment.matched.length}, Added: ${alignment.added.length}, Removed: ${alignment.removed.length}`);
    console.log(`  Alignment time: ${alignTime.toFixed(1)} ms`);

    for (const m of alignment.matched) {
      const oldItem = extractItemNumber(m.oldSection.heading) ?? '?';
      const newItem = extractItemNumber(m.newSection.heading) ?? '?';
      console.log(
        `    ${oldItem} ↔ ${newItem}  sim=${m.similarity.toFixed(3)}  "${m.oldSection.heading.slice(0, 35)}" ↔ "${m.newSection.heading.slice(0, 35)}"`,
      );
    }

    // Check alignment accuracy against ground truth
    const oldExtracted = new Set(oldSections.map((s) => extractItemNumber(s.heading)));
    const newExtracted = new Set(newSections.map((s) => extractItemNumber(s.heading)));

    let correctMatches = 0;
    let expectedMatches = 0;
    for (const item of STANDARD_ITEMS) {
      if (oldExtracted.has(item) && newExtracted.has(item)) {
        expectedMatches++;
        // Check if the old item N matched with new item N
        const match = alignment.matched.find(
          (m) => extractItemNumber(m.oldSection.heading) === item && extractItemNumber(m.newSection.heading) === item,
        );
        if (match) correctMatches++;
      }
    }
    const accuracy = expectedMatches > 0 ? (correctMatches / expectedMatches * 100).toFixed(1) : 'N/A';
    console.log(`\n  Alignment accuracy: ${correctMatches}/${expectedMatches} standard items correctly matched (${accuracy}%)`);

    // Paragraph diff — Patience
    const t2 = performance.now();
    const patienceResult = diffParagraphs(alignment.matched, 'patience');
    const patienceTime = performance.now() - t2;
    console.log(`\n  ── Paragraph Diff (Patience) ── [${patienceTime.toFixed(0)} ms]`);
    reportDiffResults(pair.label, patienceResult, 'Patience');

    // Paragraph diff — Myers
    const t3 = performance.now();
    const myersResult = diffParagraphs(alignment.matched, 'myers');
    const myersTime = performance.now() - t3;
    console.log(`\n  ── Paragraph Diff (Myers) ── [${myersTime.toFixed(0)} ms]`);
    reportDiffResults(pair.label, myersResult, 'Myers');

    // Compare patience vs Myers
    console.log('\n  ── Patience vs Myers Comparison ──');
    const pStats = patienceResult.totalStats;
    const mStats = myersResult.totalStats;
    printTable(
      ['Metric', 'Patience', 'Myers', 'Diff'],
      [
        ['Unchanged', String(pStats.totalUnchanged), String(mStats.totalUnchanged), String(pStats.totalUnchanged - mStats.totalUnchanged)],
        ['Modified', String(pStats.totalModified), String(mStats.totalModified), String(pStats.totalModified - mStats.totalModified)],
        ['Added', String(pStats.totalAdded), String(mStats.totalAdded), String(pStats.totalAdded - mStats.totalAdded)],
        ['Removed', String(pStats.totalRemoved), String(mStats.totalRemoved), String(pStats.totalRemoved - mStats.totalRemoved)],
        ['Time (ms)', patienceTime.toFixed(0), myersTime.toFixed(0), (patienceTime - myersTime).toFixed(0)],
      ],
    );

    // Total time
    const totalTime = extractTime + alignTime + patienceTime + myersTime;
    console.log(`\n  Total pipeline time: ${totalTime.toFixed(0)} ms (target: <2000 ms)`);
    console.log(`  ${totalTime < 2000 ? '✓ PASS' : '✗ FAIL'}: Performance target`);

    // Show a few example modified paragraphs
    console.log('\n  ── Sample Modified Paragraphs (first 3) ──');
    let shown = 0;
    for (const sd of patienceResult.sectionDiffs) {
      for (const c of sd.changes) {
        if (c.type === 'modified' && shown < 3) {
          console.log(`\n  Section: ${sd.oldHeading.slice(0, 40)}`);
          console.log(`  Word diff: ${c.wordDiff?.slice(0, 200)}...`);
          shown++;
        }
      }
      if (shown >= 3) break;
    }
  }

  console.log('\n' + '═'.repeat(55));
  console.log('  SPIKE COMPLETE');
  console.log('═'.repeat(55));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
