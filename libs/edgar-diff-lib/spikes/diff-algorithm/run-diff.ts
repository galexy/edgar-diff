/**
 * Main runner for the diff algorithm spike.
 * Loads filings, extracts sections, aligns them, runs paragraph diffs,
 * and reports measurements.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections } from './section-extractor.js';
import {
  alignSections,
  alignSectionsHeadingOnly,
  type AlignmentConfig,
} from './section-aligner.js';
import { diffAllSections, type SectionDiff } from './paragraph-differ.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

interface FilingPair {
  label: string;
  oldFile: string;
  newFile: string;
}

const PAIRS: FilingPair[] = [
  { label: 'Apple FY2023 → FY2024', oldFile: 'apple-fy2023.html', newFile: 'apple-fy2024.html' },
  { label: 'Microsoft FY2023 → FY2024', oldFile: 'msft-fy2023.html', newFile: 'msft-fy2024.html' },
];

/** Ground truth: standard 10-K items that should match between consecutive filings */
const EXPECTED_ITEMS = [
  'item 1', 'item 1a', 'item 1b', 'item 1c', 'item 2', 'item 3', 'item 4',
  'item 5', 'item 6', 'item 7', 'item 7a', 'item 8', 'item 9', 'item 9a',
  'item 9b', 'item 10', 'item 11', 'item 12', 'item 13', 'item 14', 'item 15', 'item 16',
];

function hrTime(): number {
  return performance.now();
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function rpad(s: string, len: number): string {
  return s.padStart(len);
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  const sep = colWidths.map((w) => '─'.repeat(w + 2)).join('┼');
  const headerLine = headers.map((h, i) => ` ${pad(h, colWidths[i])} `).join('│');
  console.log(headerLine);
  console.log(sep);
  for (const row of rows) {
    const line = row.map((cell, i) => ` ${pad(cell, colWidths[i])} `).join('│');
    console.log(line);
  }
}

function summarizeDiffs(diffs: SectionDiff[]): void {
  for (const d of diffs) {
    const { stats } = d;
    const changeRate = stats.total > 0
      ? (((stats.added + stats.removed + stats.modified) / stats.total) * 100).toFixed(1)
      : '0.0';
    console.log(
      `  ${pad(d.oldHeading.slice(0, 50), 52)} │ ` +
      `+${rpad(String(stats.added), 3)} -${rpad(String(stats.removed), 3)} ` +
      `~${rpad(String(stats.modified), 3)} =${rpad(String(stats.unchanged), 4)} ` +
      `│ ${changeRate}% changed`,
    );
  }
}

async function loadFiling(filename: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, filename), 'utf-8');
}

/** Try different weight configurations and find the best one */
function experimentWithWeights(
  oldSections: ReturnType<typeof extractSections>,
  newSections: ReturnType<typeof extractSections>,
): { bestConfig: AlignmentConfig; results: Array<{ config: AlignmentConfig; matchCount: number; avgSim: number }> } {
  const configs: AlignmentConfig[] = [
    { headingWeight: 0.0, contentWeight: 1.0, threshold: 0.3 },
    { headingWeight: 0.2, contentWeight: 0.8, threshold: 0.3 },
    { headingWeight: 0.4, contentWeight: 0.6, threshold: 0.3 },
    { headingWeight: 0.5, contentWeight: 0.5, threshold: 0.3 },
    { headingWeight: 0.6, contentWeight: 0.4, threshold: 0.3 },
    { headingWeight: 0.8, contentWeight: 0.2, threshold: 0.3 },
    { headingWeight: 1.0, contentWeight: 0.0, threshold: 0.3 },
  ];

  const results = configs.map((config) => {
    const alignment = alignSections(oldSections, newSections, config);
    const avgSim = alignment.matched.length > 0
      ? alignment.matched.reduce((sum, m) => sum + m.similarity, 0) / alignment.matched.length
      : 0;
    return { config, matchCount: alignment.matched.length, avgSim };
  });

  // Best = most matches, then highest avg similarity
  const best = [...results].sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return b.avgSim - a.avgSim;
  })[0];

  return { bestConfig: best.config, results };
}

async function processPair(pair: FilingPair): Promise<void> {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${pair.label}`);
  console.log(`${'═'.repeat(72)}`);

  // Load filings
  const t0 = hrTime();
  const [oldHtml, newHtml] = await Promise.all([
    loadFiling(pair.oldFile),
    loadFiling(pair.newFile),
  ]);
  const loadTime = hrTime() - t0;

  // Extract sections
  const t1 = hrTime();
  const oldSections = extractSections(oldHtml);
  const newSections = extractSections(newHtml);
  const extractTime = hrTime() - t1;

  console.log(`\n  Old filing: ${oldSections.length} sections extracted`);
  console.log(`  New filing: ${newSections.length} sections extracted`);
  console.log(`  Load time: ${loadTime.toFixed(0)}ms | Extract time: ${extractTime.toFixed(0)}ms`);

  // Show extracted sections
  console.log(`\n  Old sections:`);
  for (const s of oldSections) {
    console.log(`    - ${s.normalizedHeading} (${s.paragraphs.length} paragraphs, ${s.content.length} chars)`);
  }
  console.log(`  New sections:`);
  for (const s of newSections) {
    console.log(`    - ${s.normalizedHeading} (${s.paragraphs.length} paragraphs, ${s.content.length} chars)`);
  }

  // ── Weight experiments ──────────────────────────────────────────────
  console.log(`\n  ── Weight Experiments ──`);
  const { bestConfig, results: weightResults } = experimentWithWeights(oldSections, newSections);

  console.log(`  ${'Head/Cont Weights'.padEnd(20)} | ${'Matches'.padEnd(8)} | Avg Similarity`);
  console.log(`  ${'─'.repeat(20)} | ${'─'.repeat(8)} | ${'─'.repeat(15)}`);
  for (const r of weightResults) {
    const label = `${r.config.headingWeight.toFixed(1)}/${r.config.contentWeight.toFixed(1)}`;
    console.log(`  ${label.padEnd(20)} | ${String(r.matchCount).padEnd(8)} | ${r.avgSim.toFixed(4)}`);
  }
  console.log(`  Best: heading=${bestConfig.headingWeight}, content=${bestConfig.contentWeight}`);

  // ── Heading-only alignment ──────────────────────────────────────────
  const t2 = hrTime();
  const headingOnly = alignSectionsHeadingOnly(oldSections, newSections);
  const headingAlignTime = hrTime() - t2;

  console.log(`\n  ── Heading-Only Alignment (${headingAlignTime.toFixed(1)}ms) ──`);
  console.log(`  Matched: ${headingOnly.matched.length} | Added: ${headingOnly.added.length} | Removed: ${headingOnly.removed.length}`);
  for (const m of headingOnly.matched) {
    console.log(`    "${m.oldSection.normalizedHeading}" ↔ "${m.newSection.normalizedHeading}" (sim: ${m.headingSimilarity.toFixed(3)})`);
  }

  // ── TF-IDF hybrid alignment ────────────────────────────────────────
  const t3 = hrTime();
  const hybrid = alignSections(oldSections, newSections);
  const hybridAlignTime = hrTime() - t3;

  console.log(`\n  ── TF-IDF Hybrid Alignment (${hybridAlignTime.toFixed(1)}ms) ──`);
  console.log(`  Matched: ${hybrid.matched.length} | Added: ${hybrid.added.length} | Removed: ${hybrid.removed.length}`);
  for (const m of hybrid.matched) {
    console.log(
      `    "${m.oldSection.normalizedHeading}" ↔ "${m.newSection.normalizedHeading}" ` +
      `(hybrid: ${m.similarity.toFixed(3)}, head: ${m.headingSimilarity.toFixed(3)}, content: ${m.contentSimilarity.toFixed(3)})`,
    );
  }

  // Check ground truth
  const matchedLabels = new Set(hybrid.matched.map((m) => m.oldSection.normalizedHeading));
  const oldLabels = new Set(oldSections.map((s) => s.normalizedHeading));
  const newLabels = new Set(newSections.map((s) => s.normalizedHeading));
  const expectedPresent = EXPECTED_ITEMS.filter((item) => {
    const norm = item.replace(/\s+/g, ' ').trim();
    return oldLabels.has(norm) && newLabels.has(norm);
  });
  const correctlyMatched = expectedPresent.filter((item) => matchedLabels.has(item));
  console.log(`\n  Ground truth: ${correctlyMatched.length}/${expectedPresent.length} expected items correctly matched`);
  if (correctlyMatched.length < expectedPresent.length) {
    const missed = expectedPresent.filter((item) => !matchedLabels.has(item));
    console.log(`  Missed: ${missed.join(', ')}`);
  }

  // Compare heading-only vs hybrid accuracy
  const headingMatchedLabels = new Set(headingOnly.matched.map((m) => m.oldSection.normalizedHeading));
  const headingCorrect = expectedPresent.filter((item) => headingMatchedLabels.has(item));
  console.log(`  Heading-only accuracy: ${headingCorrect.length}/${expectedPresent.length}`);
  console.log(`  TF-IDF hybrid accuracy: ${correctlyMatched.length}/${expectedPresent.length}`);

  // ── Myers diff ─────────────────────────────────────────────────────
  const t4 = hrTime();
  const myersDiffs = diffAllSections(hybrid.matched, 'myers');
  const myersTime = hrTime() - t4;

  console.log(`\n  ── Myers Diff (${myersTime.toFixed(1)}ms) ──`);
  summarizeDiffs(myersDiffs);

  // ── Patience diff ──────────────────────────────────────────────────
  const t5 = hrTime();
  const patienceDiffs = diffAllSections(hybrid.matched, 'patience');
  const patienceTime = hrTime() - t5;

  console.log(`\n  ── Patience Diff (${patienceTime.toFixed(1)}ms) ──`);
  summarizeDiffs(patienceDiffs);

  // ── Myers vs Patience comparison ──────────────────────────────────
  console.log(`\n  ── Myers vs Patience Comparison ──`);
  for (let i = 0; i < myersDiffs.length; i++) {
    const m = myersDiffs[i];
    const p = patienceDiffs[i];
    const different =
      m.stats.added !== p.stats.added ||
      m.stats.removed !== p.stats.removed ||
      m.stats.modified !== p.stats.modified;
    if (different) {
      console.log(
        `  ${m.oldHeading.slice(0, 40).padEnd(42)} ` +
        `Myers: +${m.stats.added} -${m.stats.removed} ~${m.stats.modified} | ` +
        `Patience: +${p.stats.added} -${p.stats.removed} ~${p.stats.modified}`,
      );
    }
  }

  // ── Total timing ──────────────────────────────────────────────────
  const totalTime = loadTime + extractTime + hybridAlignTime + myersTime;
  console.log(`\n  ── Performance Summary ──`);
  console.log(`  File load:        ${loadTime.toFixed(0)}ms`);
  console.log(`  Section extract:  ${extractTime.toFixed(0)}ms`);
  console.log(`  Heading align:    ${headingAlignTime.toFixed(1)}ms`);
  console.log(`  TF-IDF align:     ${hybridAlignTime.toFixed(1)}ms`);
  console.log(`  Myers diff:       ${myersTime.toFixed(1)}ms`);
  console.log(`  Patience diff:    ${patienceTime.toFixed(1)}ms`);
  console.log(`  Total pipeline:   ${totalTime.toFixed(0)}ms`);
  console.log(`  Target: <2000ms   ${totalTime < 2000 ? '✓ PASS' : '✗ FAIL'}`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Prototype B: TF-IDF Content Similarity + Myers Paragraph Diff     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  for (const pair of PAIRS) {
    await processPair(pair);
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log('  Done. See NOTES.md for analysis.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
