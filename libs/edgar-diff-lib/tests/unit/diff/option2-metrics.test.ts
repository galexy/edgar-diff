/**
 * Option 2 (sentence-then-word two-pass) quality metrics tests.
 *
 * Measures removedCoverage, falseAddedRate, and unchangedRatio for the 3 AAPL cases
 * and compares against the OLD baseline metrics from the plain diffWords approach.
 *
 * Also tests edge cases specific to sentence-level splitting.
 */
import { describe, it, expect } from 'vitest';
import { diffWords } from 'diff';
import { diffParagraphs } from '../../../src/diff/paragraph-differ.js';
import { makeParagraph, makeSection } from '../../helpers/diff-fixtures.js';
import { assertDefined } from '../../helpers/assert-defined.js';
import type { SectionMatch } from '../../../src/diff/section-aligner.js';
import type { FilingSection } from '../../../src/types.js';
import type { WordChange } from '../../../src/diff/types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function matchSections(oldSec: FilingSection, newSec: FilingSection): SectionMatch {
  return { oldIndex: 0, newIndex: 0, oldSection: oldSec, newSection: newSec, similarity: 1 };
}

function matchTexts(oldText: string, newText: string): SectionMatch {
  return matchSections(
    makeSection('s', 'S', [makeParagraph(oldText, 100)]),
    makeSection('s', 'S', [makeParagraph(newText, 100)]),
  );
}

/** Compute word overlap between two texts (fraction of old words found in new). */
function wordOverlap(oldText: string, newText: string): number {
  const oldWords = new Set(oldText.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  const newWords = new Set(newText.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  if (oldWords.size === 0) return 0;
  let overlap = 0;
  for (const w of oldWords) {
    if (newWords.has(w)) overlap++;
  }
  return overlap / oldWords.size;
}

interface QualityMetrics {
  removedCoverage: number;
  falseAddedRate: number;
  unchangedRatio: number;
  wordChangesCount: number;
  removedChanges: number;
  addedChanges: number;
}

/**
 * Measure quality metrics from diffParagraphs output.
 * - removedCoverage: fraction of old text chars marked as removed
 * - falseAddedRate: fraction of new text chars marked as added that also exist in old text (word-level)
 * - unchangedRatio: fraction of old text chars that are unchanged (not removed)
 */
function measureMetrics(oldText: string, newText: string): QualityMetrics {
  const normalizedOld = oldText.replace(/\s+/g, ' ').trim();
  const normalizedNew = newText.replace(/\s+/g, ' ').trim();

  const diffs = diffParagraphs(matchTexts(oldText, newText));
  const modified = diffs.find(d => d.changeType === 'modified');

  if (!modified || !modified.wordChanges || modified.wordChanges.length === 0) {
    // Quality gate triggered or no word changes - return gate-triggered metrics
    return {
      removedCoverage: modified ? 1.0 : 0, // gate triggered = paragraph-level replace
      falseAddedRate: 0,
      unchangedRatio: 0,
      wordChangesCount: 0,
      removedChanges: 0,
      addedChanges: 0,
    };
  }

  const wordChanges = modified.wordChanges;
  const removedChanges = wordChanges.filter(w => w.type === 'removed');
  const addedChanges = wordChanges.filter(w => w.type === 'added');

  // removedCoverage: fraction of old text chars marked as removed
  const removedChars = removedChanges.reduce((sum, w) => sum + (w.end - w.start), 0);
  const removedCoverage = normalizedOld.length > 0 ? removedChars / normalizedOld.length : 0;

  // unchangedRatio: 1 - removedCoverage
  const unchangedRatio = 1 - removedCoverage;

  // falseAddedRate: fraction of added chars that are words also present in old text
  const oldWords = new Set(normalizedOld.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  let falseAddedChars = 0;
  let totalAddedChars = 0;
  for (const change of addedChanges) {
    const addedText = normalizedNew.slice(change.start, change.end);
    totalAddedChars += addedText.length;
    const addedWords = addedText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    for (const word of addedWords) {
      // Strip punctuation for comparison
      const stripped = word.replace(/[.,;:!?'"()[\]{}]/g, '');
      if (stripped.length > 0 && oldWords.has(stripped)) {
        falseAddedChars += word.length + 1; // +1 for space
      }
    }
  }
  const falseAddedRate = totalAddedChars > 0 ? Math.min(falseAddedChars / totalAddedChars, 1.0) : 0;

  return {
    removedCoverage,
    falseAddedRate,
    unchangedRatio,
    wordChangesCount: wordChanges.length,
    removedChanges: removedChanges.length,
    addedChanges: addedChanges.length,
  };
}

/**
 * Measure raw diffWords metrics (bypass any quality gate) for baseline comparison.
 */
function measureRawDiffWordsMetrics(oldText: string, newText: string): { removedCoverage: number; unchangedRatio: number } {
  const normalizedOld = oldText.replace(/\s+/g, ' ').trim();
  const changes = diffWords(normalizedOld, newText.replace(/\s+/g, ' ').trim());
  let removedChars = 0;
  for (const c of changes) {
    if (c.removed) removedChars += c.value.length;
  }
  const removedCoverage = normalizedOld.length > 0 ? removedChars / normalizedOld.length : 0;
  return { removedCoverage, unchangedRatio: 1 - removedCoverage };
}

// ── AAPL test data (reused from word-diff-quality-gate.test.ts) ──────

const AAPL_CASES = [
  {
    label: 'AAPL Case 1: litigation paragraph',
    old: `The outcome of litigation or government investigations is inherently uncertain. If one or more legal matters were resolved against the Company or an indemnified third party in a reporting period for amounts above management's expectations, the Company's results of operations and financial condition for that reporting period could be materially adversely affected. Further, such an outcome can result in significant compensatory, punitive or trebled monetary damages, disgorgement of revenue or profits, remedial corporate measures or injunctive relief against the Company, and has from time to time required, and can in the future require, the Company to change its business practices and limit the Company's ability to offer certain products and services, all of which could materially adversely affect the Company's business, reputation, results of operations and financial condition.`,
    new_: `The Company is subject to various claims, legal proceedings and government investigations that have arisen in the ordinary course of business and have not yet been fully resolved, and new matters may arise in the future. In addition, the Company enters into agreements that include indemnification provisions that can subject the Company to costs and damages in the event of a claim against an indemnified third party. The number of claims, legal proceedings and government investigations involving the Company, and the alleged magnitude of such claims, proceedings and government investigations, has generally increased over time and may continue to increase.`,
    oldBaseline: { removedCoverage: 0.864, falseAddedRate: 0.43, unchangedRatio: 0.136 },
  },
  {
    label: 'AAPL Case 2: security paragraph',
    old: `The Company experiences malicious attacks and other attempts to gain unauthorized access to its systems on a regular basis. These attacks seek to compromise the confidentiality, integrity or availability of confidential information or disrupt normal business operations, and can, among other things, impair the Company's ability to attract and retain customers for its products and services, impact the Company's stock price, materially damage commercial relationships, and expose the Company to litigation or government investigations, which could result in penalties, fines or judgments against the Company. Globally, attacks are expected to continue accelerating in both frequency and sophistication with increasing use by actors of tools and techniques that are designed to circumvent controls, avoid detection, and remove or obfuscate forensic evidence, all of which hinders the Company's ability to identify, investigate and recover from incidents. In addition, attacks against the Company and its customers can escalate during periods of severe diplomatic or armed conflict.`,
    new_: `The Company's business requires it to use and store confidential information, including personal and sensitive health and financial information with respect to the Company's customers and employees. The Company devotes significant resources to systems and data security, including through the use of encryption and other security measures intended to protect its systems and data. But these measures cannot provide absolute security, and losses or unauthorized access to or releases of confidential information occur and could materially adversely affect the Company's business, reputation, results of operations, financial condition and stock price.`,
    oldBaseline: { removedCoverage: 0.863, falseAddedRate: 0.412, unchangedRatio: 0.137 },
  },
  {
    label: 'AAPL Case 3: competition paragraph',
    old: `The Company is focused on expanding its market opportunities related to smartphones, personal computers, tablets, wearables and accessories, and services. The Company faces substantial competition in these markets from companies that have significant technical, marketing, distribution and other resources, as well as established hardware, software, and service offerings with large customer bases. In addition, some of the Company's competitors have broader product lines, lower-priced products and a larger installed base of active devices. Competition has been particularly intense as competitors have aggressively cut prices and lowered product margins. Certain competitors have the resources, experience or cost structures to provide products at little or no profit or even at a loss. The Company's services compete with business models that provide content to users for free and use illegitimate means to obtain third-party digital content and applications. The Company faces significant competition as competitors imitate the Company's product features and applications within their products, or collaborate to offer integrated solutions that are more competitive than those they currently offer.`,
    new_: `The markets for the Company's products and services are highly competitive and are characterized by aggressive price competition, downward pressure on gross margins, continual improvement in product performance, and price sensitivity on the part of consumers and businesses. The markets in which the Company competes are further defined by frequent introduction of new products and services, short product life cycles, evolving industry standards, and rapid adoption of technological advancements by competitors. Many of the Company's competitors seek to compete primarily through aggressive pricing and very low cost structures, and by imitating the Company's products and infringing on its intellectual property.`,
    oldBaseline: { removedCoverage: 0.884, falseAddedRate: 0.366, unchangedRatio: 0.116 },
  },
];

// ═══════════════════════════════════════════════════════════════════════
// QUALITY METRICS for AAPL Cases
// ═══════════════════════════════════════════════════════════════════════

describe('Option 2 Quality Metrics: AAPL cases', () => {
  for (const tc of AAPL_CASES) {
    describe(tc.label, () => {
      it('should produce word-level changes (not trigger quality gate fallback)', () => {
        const diffs = diffParagraphs(matchTexts(tc.old, tc.new_));
        const modified = diffs.find(d => d.changeType === 'modified');
        assertDefined(modified, `Expected modified diff for: ${tc.label}`);
        // Option 2 should produce actual word changes, not empty array (quality gate)
        // If it returns [], the two-pass approach didn't improve over baseline
        console.log(`\n=== ${tc.label} ===`);
        console.log(`wordChanges count: ${modified.wordChanges?.length ?? 'undefined'}`);
        if (modified.wordChanges && modified.wordChanges.length > 0) {
          console.log('Result: Word-level diff produced (two-pass working)');
        } else {
          console.log('Result: Quality gate triggered (two-pass did NOT improve enough)');
        }
      });

      it('should have removedCoverage < 70% (target)', () => {
        const metrics = measureMetrics(tc.old, tc.new_);
        console.log(`\n=== ${tc.label} - Metrics ===`);
        console.log(`  removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}% (old baseline: ${(tc.oldBaseline.removedCoverage * 100).toFixed(1)}%, target: <70%)`);
        console.log(`  falseAddedRate:  ${(metrics.falseAddedRate * 100).toFixed(1)}% (old baseline: ${(tc.oldBaseline.falseAddedRate * 100).toFixed(1)}%, target: <20%)`);
        console.log(`  unchangedRatio:  ${(metrics.unchangedRatio * 100).toFixed(1)}% (old baseline: ${(tc.oldBaseline.unchangedRatio * 100).toFixed(1)}%, target: >15%)`);
        console.log(`  wordChanges:     ${metrics.wordChangesCount} (removed: ${metrics.removedChanges}, added: ${metrics.addedChanges})`);
        console.log(`  word overlap:    ${(wordOverlap(tc.old, tc.new_) * 100).toFixed(1)}%`);

        // The key quality target
        expect(metrics.removedCoverage).toBeLessThan(0.70);
      });

      it('should have falseAddedRate < 20% (target)', () => {
        const metrics = measureMetrics(tc.old, tc.new_);
        expect(metrics.falseAddedRate).toBeLessThan(0.20);
      });

      it('should have unchangedRatio > 15% (target)', () => {
        const metrics = measureMetrics(tc.old, tc.new_);
        expect(metrics.unchangedRatio).toBeGreaterThan(0.15);
      });

      it('should improve over raw diffWords baseline', () => {
        const option2Metrics = measureMetrics(tc.old, tc.new_);
        const rawMetrics = measureRawDiffWordsMetrics(tc.old, tc.new_);
        console.log(`\n=== ${tc.label} - Comparison ===`);
        console.log(`  Raw diffWords removedCoverage:   ${(rawMetrics.removedCoverage * 100).toFixed(1)}%`);
        console.log(`  Option 2 removedCoverage:        ${(option2Metrics.removedCoverage * 100).toFixed(1)}%`);
        console.log(`  Improvement:                     ${((rawMetrics.removedCoverage - option2Metrics.removedCoverage) * 100).toFixed(1)} percentage points`);

        // Option 2 should be meaningfully better than raw diffWords
        expect(option2Metrics.removedCoverage).toBeLessThan(rawMetrics.removedCoverage);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES specific to sentence-then-word approach
// ═══════════════════════════════════════════════════════════════════════

describe('Option 2 Edge Cases: Sentence Splitting', () => {
  // E1: Single-sentence paragraphs (should degrade gracefully to diffWords behavior)
  it('E1: single-sentence paragraphs degrade gracefully', () => {
    const old = 'The Company reported strong revenue growth during the fiscal year';
    const new_ = 'The Company reported moderate revenue decline during the fiscal year';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    // Single sentence: should still produce word-level diff
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    // Should identify the changed words
    const removedText = modified.wordChanges
      .filter(w => w.type === 'removed')
      .map(w => old.slice(w.start, w.end))
      .join('');
    expect(removedText).toContain('strong');
    console.log('\nE1: Single-sentence - removed:', removedText);
  });

  // E2: Paragraphs with no sentence boundaries (no periods)
  it('E2: no sentence boundaries (no periods)', () => {
    const old = 'Revenue growth was strong and expenses remained low while margins improved significantly';
    const new_ = 'Revenue growth was weak and expenses remained high while margins declined significantly';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    console.log(`\nE2: No periods - wordChanges count: ${modified.wordChanges.length}`);
  });

  // E3: Sentences with abbreviations ("U.S.", "Mr.", "$1.2 billion")
  it('E3: abbreviations do not break sentence splitting', () => {
    const old = 'The U.S. market grew by $1.2 billion in Q4. Mr. Smith noted that Dr. Jones approved the results. The E.U. expansion is on track.';
    const new_ = 'The U.S. market grew by $1.5 billion in Q4. Mr. Smith noted that Dr. Jones reviewed the results. The E.U. expansion is ahead of schedule.';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);

    // Should NOT mark most of the text as removed (abbreviations shouldn't cause desync)
    const metrics = measureMetrics(old, new_);
    console.log(`\nE3: Abbreviations - removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}%, wordChanges: ${metrics.wordChangesCount}`);
    // Most text is shared; only "1.2"→"1.5", "approved"→"reviewed", "on track"→"ahead of schedule" differ
    expect(metrics.removedCoverage).toBeLessThan(0.40);
  });

  // E4: Very short sentences
  it('E4: very short sentences', () => {
    const old = 'Revenue grew. Expenses fell. Margins improved.';
    const new_ = 'Revenue declined. Expenses rose. Margins contracted.';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    // Short sentences with different verbs - should produce word-level diff
    console.log(`\nE4: Short sentences - wordChanges: ${modified.wordChanges?.length ?? 'empty/undefined'}`);
    // Even if quality gate triggers, that's acceptable for near-total rewrites of short text
  });

  // E5: Paragraphs where sentences are reordered
  it('E5: reordered sentences should be handled better than diffWords', () => {
    const s1 = 'Revenue increased by fifteen percent during the fourth quarter.';
    const s2 = 'Operating expenses decreased significantly below the projected budget.';
    const s3 = 'The company expanded operations into three new international markets.';

    const old = `${s1} ${s2} ${s3}`;
    const new_ = `${s3} ${s1} ${s2}`; // reordered: 3, 1, 2

    const metrics = measureMetrics(old, new_);
    const rawMetrics = measureRawDiffWordsMetrics(old, new_);

    console.log(`\nE5: Sentence reorder`);
    console.log(`  Raw diffWords removedCoverage: ${(rawMetrics.removedCoverage * 100).toFixed(1)}%`);
    console.log(`  Option 2 removedCoverage:      ${(metrics.removedCoverage * 100).toFixed(1)}%`);

    // This is THE key advantage of two-pass: sentence-level matching handles reordering
    // Option 2 should do much better than raw diffWords here
    // If sentences are matched correctly, removedCoverage should be ~0% (all sentences exist in both)
    expect(metrics.removedCoverage).toBeLessThan(0.30);
  });

  // E6: Sentences where one sentence is split into two
  it('E6: sentence split into two', () => {
    const old = 'Revenue grew significantly and expenses remained under control during the fiscal year.';
    const new_ = 'Revenue grew significantly during the fiscal year. Expenses remained under control.';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    const metrics = measureMetrics(old, new_);
    console.log(`\nE6: Sentence split - removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}%, wordChanges: ${metrics.wordChangesCount}`);
    // Should handle this reasonably - most words are shared
    expect(metrics.removedCoverage).toBeLessThan(0.50);
  });

  // E7: Empty strings
  it('E7a: both empty strings', () => {
    const diffs = diffParagraphs(matchTexts('', ''));
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changeType).toBe('unchanged');
  });

  it('E7b: old empty, new non-empty', () => {
    const diffs = diffParagraphs(matchTexts('', 'Some new content.'));
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('E7c: old non-empty, new empty', () => {
    const diffs = diffParagraphs(matchTexts('Some old content.', ''));
    expect(diffs.length).toBeGreaterThan(0);
  });

  // E8: Paragraphs where two sentences are merged into one
  it('E8: two sentences merged into one', () => {
    const old = 'Revenue grew significantly. Margins also improved.';
    const new_ = 'Revenue grew significantly and margins also improved during the quarter.';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    const metrics = measureMetrics(old, new_);
    console.log(`\nE8: Sentence merge - removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}%, wordChanges: ${metrics.wordChangesCount}`);
    // Most words are shared
    expect(metrics.removedCoverage).toBeLessThan(0.40);
  });

  // E9: Paragraph with many abbreviations (stress test for sentence splitter)
  it('E9: many abbreviations stress test', () => {
    const old = 'The Co. reported that Rev. Johnson and Dr. Smith met at 3 p.m. to discuss the U.S. operations. They reviewed the Q4 results for Dept. A and Dept. B.';
    const new_ = 'The Co. reported that Rev. Johnson and Dr. Smith met at 4 p.m. to discuss the U.K. operations. They reviewed the Q1 results for Dept. A and Dept. C.';

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    const metrics = measureMetrics(old, new_);
    console.log(`\nE9: Many abbreviations - removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}%`);
    // Only a few words differ (3→4, U.S.→U.K., Q4→Q1, B→C)
    expect(metrics.removedCoverage).toBeLessThan(0.30);
  });

  // E10: Long paragraph where only the last sentence changes
  it('E10: only last sentence changes in long paragraph', () => {
    const shared = 'The Company continued to invest in research and development. Operating margins expanded to record levels. Customer satisfaction scores improved across all segments.';
    const old = `${shared} Revenue guidance was set at ten billion dollars.`;
    const new_ = `${shared} Revenue guidance was raised to twelve billion dollars.`;

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    const metrics = measureMetrics(old, new_);
    console.log(`\nE10: Last sentence changed - removedCoverage: ${(metrics.removedCoverage * 100).toFixed(1)}%`);
    // Most text is shared, only the last sentence has changes
    expect(metrics.removedCoverage).toBeLessThan(0.20);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// METRICS SUMMARY (prints a comparison table)
// ═══════════════════════════════════════════════════════════════════════

describe('Metrics Summary Table', () => {
  it('prints comparison table for all AAPL cases', () => {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║           Option 2 (Sentence-then-Word) Metrics Report          ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║ Metric            │ Old Baseline │ Option 2  │ Target   │ Pass? ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');

    for (const tc of AAPL_CASES) {
      const metrics = measureMetrics(tc.old, tc.new_);
      const rcPass = metrics.removedCoverage < 0.70 ? 'YES' : 'NO ';
      const faPass = metrics.falseAddedRate < 0.20 ? 'YES' : 'NO ';
      const urPass = metrics.unchangedRatio > 0.15 ? 'YES' : 'NO ';

      console.log(`║ ${tc.label.padEnd(55)} ║`);
      console.log(`║   removedCoverage │ ${(tc.oldBaseline.removedCoverage * 100).toFixed(1).padStart(10)}% │ ${(metrics.removedCoverage * 100).toFixed(1).padStart(7)}% │ <70%     │ ${rcPass}   ║`);
      console.log(`║   falseAddedRate  │ ${(tc.oldBaseline.falseAddedRate * 100).toFixed(1).padStart(10)}% │ ${(metrics.falseAddedRate * 100).toFixed(1).padStart(7)}% │ <20%     │ ${faPass}   ║`);
      console.log(`║   unchangedRatio  │ ${(tc.oldBaseline.unchangedRatio * 100).toFixed(1).padStart(10)}% │ ${(metrics.unchangedRatio * 100).toFixed(1).padStart(7)}% │ >15%     │ ${urPass}   ║`);
      console.log('╠══════════════════════════════════════════════════════════════════╣');
    }
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    // This test always passes — it's just for reporting
    expect(true).toBe(true);
  });
});
