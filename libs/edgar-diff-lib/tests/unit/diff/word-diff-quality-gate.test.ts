/**
 * Regression tests for the diffWords quality gate (edgar-diff-zkkk).
 *
 * The fix adds a quality gate to computeWordChanges(): if removedCoverage
 * (fraction of old text characters marked as removed by diffWords) exceeds
 * 70%, the function returns an empty WordChange[] — falling back to
 * paragraph-level diff instead of showing misleading word-level highlights.
 *
 * Test categories:
 *   A: Threshold trigger — MUST FAIL before fix, PASS after
 *   B: Below threshold  — MUST PASS both before AND after fix
 *   C: Edge cases       — various boundary conditions
 *   D: Integration      — end-to-end through diffParagraphs()
 */
import { describe, it, expect } from 'vitest';
import { diffWords } from 'diff';
import jaroWinkler from 'jaro-winkler';
import { diffParagraphs } from '../../../src/diff/paragraph-differ.js';
import { makeParagraph, makeSection } from '../../helpers/diff-fixtures.js';
import { assertDefined } from '../../helpers/assert-defined.js';
import type { SectionMatch } from '../../../src/diff/section-aligner.js';
import type { FilingSection } from '../../../src/types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function matchSections(oldSec: FilingSection, newSec: FilingSection): SectionMatch {
  return { oldIndex: 0, newIndex: 0, oldSection: oldSec, newSection: newSec, similarity: 1 };
}

/** Create a section match from a single old/new paragraph pair. */
function matchTexts(oldText: string, newText: string): SectionMatch {
  return matchSections(
    makeSection('s', 'S', [makeParagraph(oldText, 100)]),
    makeSection('s', 'S', [makeParagraph(newText, 100)]),
  );
}

/**
 * Measure removedCoverage by calling diffWords directly (bypasses any gate).
 * Used only as a sanity check to verify test data produces expected coverage.
 */
function rawRemovedCoverage(oldText: string, newText: string): number {
  if (oldText.length === 0) return 0;
  const changes = diffWords(oldText, newText);
  let removedChars = 0;
  for (const c of changes) {
    if (c.removed) removedChars += c.value.length;
  }
  return removedChars / oldText.length;
}

/**
 * Build a text pair with a predictable shared-prefix and unique suffixes.
 * `sharedFraction` controls what fraction of words appear in both texts.
 */
function buildTextPair(sharedFraction: number, totalWords = 100): { old: string; new_: string } {
  const sharedCount = Math.round(totalWords * sharedFraction);
  const uniqueCount = totalWords - sharedCount;
  const sharedWords = Array.from({ length: sharedCount }, (_, i) => `shared${i}`);
  const oldUniqueWords = Array.from({ length: uniqueCount }, (_, i) => `olduniq${i}`);
  const newUniqueWords = Array.from({ length: uniqueCount }, (_, i) => `newuniq${i}`);
  return {
    old: [...sharedWords, ...oldUniqueWords].join(' '),
    new_: [...sharedWords, ...newUniqueWords].join(' '),
  };
}

// ── AAPL 10-K test data (from repro test) ───────────────────────────

const AAPL_CASES = [
  {
    label: 'AAPL Case 1: litigation paragraph',
    old: `The outcome of litigation or government investigations is inherently uncertain. If one or more legal matters were resolved against the Company or an indemnified third party in a reporting period for amounts above management's expectations, the Company's results of operations and financial condition for that reporting period could be materially adversely affected. Further, such an outcome can result in significant compensatory, punitive or trebled monetary damages, disgorgement of revenue or profits, remedial corporate measures or injunctive relief against the Company, and has from time to time required, and can in the future require, the Company to change its business practices and limit the Company's ability to offer certain products and services, all of which could materially adversely affect the Company's business, reputation, results of operations and financial condition.`,
    new_: `The Company is subject to various claims, legal proceedings and government investigations that have arisen in the ordinary course of business and have not yet been fully resolved, and new matters may arise in the future. In addition, the Company enters into agreements that include indemnification provisions that can subject the Company to costs and damages in the event of a claim against an indemnified third party. The number of claims, legal proceedings and government investigations involving the Company, and the alleged magnitude of such claims, proceedings and government investigations, has generally increased over time and may continue to increase.`,
  },
  {
    label: 'AAPL Case 2: security paragraph',
    old: `The Company experiences malicious attacks and other attempts to gain unauthorized access to its systems on a regular basis. These attacks seek to compromise the confidentiality, integrity or availability of confidential information or disrupt normal business operations, and can, among other things, impair the Company's ability to attract and retain customers for its products and services, impact the Company's stock price, materially damage commercial relationships, and expose the Company to litigation or government investigations, which could result in penalties, fines or judgments against the Company. Globally, attacks are expected to continue accelerating in both frequency and sophistication with increasing use by actors of tools and techniques that are designed to circumvent controls, avoid detection, and remove or obfuscate forensic evidence, all of which hinders the Company's ability to identify, investigate and recover from incidents. In addition, attacks against the Company and its customers can escalate during periods of severe diplomatic or armed conflict.`,
    new_: `The Company's business requires it to use and store confidential information, including personal and sensitive health and financial information with respect to the Company's customers and employees. The Company devotes significant resources to systems and data security, including through the use of encryption and other security measures intended to protect its systems and data. But these measures cannot provide absolute security, and losses or unauthorized access to or releases of confidential information occur and could materially adversely affect the Company's business, reputation, results of operations, financial condition and stock price.`,
  },
  {
    label: 'AAPL Case 3: competition paragraph',
    old: `The Company is focused on expanding its market opportunities related to smartphones, personal computers, tablets, wearables and accessories, and services. The Company faces substantial competition in these markets from companies that have significant technical, marketing, distribution and other resources, as well as established hardware, software, and service offerings with large customer bases. In addition, some of the Company's competitors have broader product lines, lower-priced products and a larger installed base of active devices. Competition has been particularly intense as competitors have aggressively cut prices and lowered product margins. Certain competitors have the resources, experience or cost structures to provide products at little or no profit or even at a loss. The Company's services compete with business models that provide content to users for free and use illegitimate means to obtain third-party digital content and applications. The Company faces significant competition as competitors imitate the Company's product features and applications within their products, or collaborate to offer integrated solutions that are more competitive than those they currently offer.`,
    new_: `The markets for the Company's products and services are highly competitive and are characterized by aggressive price competition, downward pressure on gross margins, continual improvement in product performance, and price sensitivity on the part of consumers and businesses. The markets in which the Company competes are further defined by frequent introduction of new products and services, short product life cycles, evolving industry standards, and rapid adoption of technological advancements by competitors. Many of the Company's competitors seek to compete primarily through aggressive pricing and very low cost structures, and by imitating the Company's products and infringing on its intellectual property.`,
  },
];

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY A: Threshold Trigger Tests
// MUST FAIL before fix (gate doesn't exist yet), PASS after
// ═══════════════════════════════════════════════════════════════════════

describe('A: Threshold trigger (FAIL before fix, PASS after)', () => {
  // A1-A3: The 3 AAPL 10-K paragraph pairs from the repro test
  for (const tc of AAPL_CASES) {
    it(`${tc.label}: wordChanges should be empty (removedCoverage > 70%)`, () => {
      // Sanity check: this test data has high removedCoverage
      const coverage = rawRemovedCoverage(tc.old, tc.new_);
      expect(coverage).toBeGreaterThan(0.70);

      // After fix: quality gate returns [] for high-coverage diffs
      const diffs = diffParagraphs(matchTexts(tc.old, tc.new_));
      const modified = diffs.find(d => d.changeType === 'modified');
      assertDefined(modified, `Expected modified diff for: ${tc.label}`);
      expect(modified.wordChanges).toEqual([]);
    });
  }

  // A4: Synthetic paragraph pair designed for ~75% removedCoverage
  it('A4: synthetic high-coverage rewrite returns empty wordChanges', () => {
    const old =
      'The regulatory framework governing data privacy and security has evolved significantly in recent years, with new legislation introduced across multiple jurisdictions requiring organizations to implement comprehensive data protection measures and report breaches within specified timeframes.';
    const new_ =
      'Consumer spending patterns have shifted dramatically toward digital channels, driven by mobile commerce adoption and changing preferences among younger demographics who increasingly favor subscription-based models over traditional one-time purchases in retail markets.';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeGreaterThan(0.70);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });

  // A5: Sentences reordered — same content but completely reversed order
  it('A5: completely reversed sentence order triggers quality gate', () => {
    const sentences = [
      'Revenue grew by fifteen percent during the fourth quarter of the fiscal year.',
      'Operating expenses decreased significantly below the projected budget targets.',
      'The company successfully expanded operations into three new international markets.',
      'Customer satisfaction survey scores improved substantially across all business segments.',
      'Research and development capital spending increased by approximately twenty percent.',
      'Net income exceeded analyst consensus expectations by a considerable margin overall.',
      'Employee retention rates reached their highest recorded levels in the past decade.',
    ];
    const old = sentences.join(' ');
    const new_ = [...sentences].reverse().join(' ');

    const coverage = rawRemovedCoverage(old, new_);
    // Reversed sentences cause diffWords to lose sync — expect high coverage
    expect(coverage).toBeGreaterThan(0.70);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY B: Below-Threshold Tests
// MUST PASS both before AND after fix (good diffs stay good)
// ═══════════════════════════════════════════════════════════════════════

describe('B: Below threshold (PASS both before and after)', () => {
  // B1: Single word substitution
  it('B1: single word substitution preserves word-level diff', () => {
    const old = 'The quick brown fox jumps over the lazy dog';
    const new_ = 'The quick red fox jumps over the lazy dog';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.30);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    // Verify the actual changed word is captured
    const removedText = modified.wordChanges
      .filter(w => w.type === 'removed')
      .map(w => old.slice(w.start, w.end))
      .join('');
    expect(removedText).toContain('brown');
  });

  // B2: Short phrase addition
  it('B2: short phrase addition preserves word-level diff', () => {
    const old = 'Hello world';
    const new_ = 'Hello beautiful world';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.50);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    const addedText = modified.wordChanges
      .filter(w => w.type === 'added')
      .map(w => new_.slice(w.start, w.end))
      .join('');
    expect(addedText).toContain('beautiful');
  });

  // B3: Short phrase removal
  it('B3: short phrase removal preserves word-level diff', () => {
    const old = 'The big red balloon floated away';
    const new_ = 'The red balloon floated away';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.30);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    const removedText = modified.wordChanges
      .filter(w => w.type === 'removed')
      .map(w => old.slice(w.start, w.end))
      .join('');
    expect(removedText).toContain('big');
  });

  // B4: Identical paragraphs — no changes at all
  it('B4: identical paragraphs produce unchanged (no wordChanges)', () => {
    const text = 'Revenue increased by 10% in fiscal 2023.';
    const diffs = diffParagraphs(matchTexts(text, text));
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changeType).toBe('unchanged');
    expect(diffs[0].wordChanges).toBeUndefined();
  });

  // B5: Minor punctuation change
  it('B5: punctuation changes preserve word-level diff', () => {
    const old = 'Hello, world. How are you?';
    const new_ = 'Hello; world! How are you.';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.50);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY C: Edge Cases
// ═══════════════════════════════════════════════════════════════════════

describe('C: Edge cases', () => {
  // C1a: Both paragraphs empty — should be unchanged
  it('C1a: both empty paragraphs are unchanged', () => {
    const old = makeSection('s', 'S', [makeParagraph('', 100)]);
    const neu = makeSection('s', 'S', [makeParagraph('', 100)]);
    const diffs = diffParagraphs(matchSections(old, neu));
    // Empty text normalizes to '' in both — diffArrays sees them as equal
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changeType).toBe('unchanged');
  });

  // C1b: Old empty, new non-empty — should be handled gracefully
  it('C1b: empty old → non-empty new is handled gracefully', () => {
    const old = makeSection('s', 'S', [makeParagraph('', 100)]);
    const neu = makeSection('s', 'S', [makeParagraph('Some new content here.', 100)]);
    const diffs = diffParagraphs(matchSections(old, neu));
    // Should produce some diff (modified or removed+added)
    expect(diffs.length).toBeGreaterThan(0);
    // The quality gate should NOT trigger (nothing to remove from empty old)
    const modified = diffs.find(d => d.changeType === 'modified');
    if (modified?.wordChanges) {
      // If it's a modified diff, word changes should be all 'added'
      expect(modified.wordChanges.every(w => w.type === 'added')).toBe(true);
    }
  });

  // C1c: Old non-empty, new empty — high removedCoverage
  it('C1c: non-empty old → empty new is handled gracefully', () => {
    const old = makeSection('s', 'S', [makeParagraph('Some old content here.', 100)]);
    const neu = makeSection('s', 'S', [makeParagraph('', 100)]);
    const diffs = diffParagraphs(matchSections(old, neu));
    expect(diffs.length).toBeGreaterThan(0);
  });

  // C2: Single word paragraphs — "Hello" → "Goodbye"
  it('C2: single word change has 100% removedCoverage → triggers gate', () => {
    const old = 'Hello';
    const new_ = 'Goodbye';

    // Single word completely replaced → 100% removedCoverage
    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBe(1.0);

    // After fix: quality gate triggers, returns empty wordChanges
    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });

  // C3: Very long paragraph (500+ words) with one word changed — must NOT trigger
  it('C3: 550-word paragraph with one word changed preserves word-level diff', () => {
    const words = Array.from({ length: 550 }, (_, i) => `word${i}`);
    const oldText = words.join(' ');
    const newWords = [...words];
    newWords[275] = 'CHANGED';
    const newText = newWords.join(' ');

    const coverage = rawRemovedCoverage(oldText, newText);
    expect(coverage).toBeLessThan(0.05); // one word in 550 ≈ <1%

    const diffs = diffParagraphs(matchTexts(oldText, newText));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    // Verify both the removed and added word are captured
    expect(modified.wordChanges.some(w => w.type === 'removed')).toBe(true);
    expect(modified.wordChanges.some(w => w.type === 'added')).toBe(true);
  });

  // C4: Paragraph where every word is the same but completely reversed
  //     diffWords loses sync → high coverage → should trigger gate after fix
  it('C4: completely reversed word order triggers quality gate', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango';
    const old = words;
    const new_ = words.split(' ').reverse().join(' ');

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeGreaterThan(0.70);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });

  // C5: Whitespace-only differences — normalizeText makes them identical
  it('C5: whitespace-only differences are treated as unchanged', () => {
    const old = 'Hello   world   test';
    const new_ = 'Hello world test';
    const diffs = diffParagraphs(matchTexts(old, new_));
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changeType).toBe('unchanged');
  });

  // C6: Unicode text with changes
  it('C6: unicode text with word substitution preserves word-level diff', () => {
    const old = 'The café served résumé papers and naïve customers daily';
    const new_ = 'The café served employment papers and sophisticated customers daily';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.50);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
  });

  // C7: Paragraph that is a proper subset of the other
  it('C7: old text is subset of new text — low coverage, word diff preserved', () => {
    const old = 'Revenue grew significantly.';
    const new_ = 'Revenue grew significantly in all geographic segments during the quarter.';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.10); // almost nothing removed

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    // Only additions, no removals (old text is preserved)
    const removed = modified.wordChanges.filter(w => w.type === 'removed');
    expect(removed).toHaveLength(0);
    const added = modified.wordChanges.filter(w => w.type === 'added');
    expect(added.length).toBeGreaterThan(0);
  });

  // C8: Numeric content change
  it('C8: numeric value change preserves word-level diff', () => {
    const old = 'Revenue was $1.2 billion for the quarter ending March 2023';
    const new_ = 'Revenue was $1.5 billion for the quarter ending March 2024';

    const coverage = rawRemovedCoverage(old, new_);
    expect(coverage).toBeLessThan(0.30);

    const diffs = diffParagraphs(matchTexts(old, new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
    // diffWords may tokenize "$1.2" differently (splitting on punctuation),
    // so check that both removed and added changes exist for the numeric parts
    expect(modified.wordChanges.some(w => w.type === 'removed')).toBe(true);
    expect(modified.wordChanges.some(w => w.type === 'added')).toBe(true);
    const addedText = modified.wordChanges
      .filter(w => w.type === 'added')
      .map(w => new_.slice(w.start, w.end))
      .join('');
    // The added text should contain parts of the new values
    expect(addedText).toMatch(/1\.5|2024/);
  });

  // C9a: Just below 70% threshold — word-level diff preserved (PASS both before and after)
  it('C9a: ~65% removedCoverage (below threshold) preserves word-level diff', () => {
    // Build text pair with ~35% shared prefix → ~65% removed
    const pair = buildTextPair(0.35, 80);

    const coverage = rawRemovedCoverage(pair.old, pair.new_);
    // Should be below threshold (allowing some measurement variation)
    expect(coverage).toBeLessThan(0.70);

    const diffs = diffParagraphs(matchTexts(pair.old, pair.new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);
  });

  // C9b: Just above 70% threshold — quality gate triggers (FAIL before fix, PASS after)
  it('C9b: ~75% removedCoverage (above threshold) triggers quality gate', () => {
    // Build text pair with ~25% shared prefix → ~75% removed
    const pair = buildTextPair(0.25, 80);

    const coverage = rawRemovedCoverage(pair.old, pair.new_);
    // Should be above threshold
    expect(coverage).toBeGreaterThan(0.70);

    const diffs = diffParagraphs(matchTexts(pair.old, pair.new_));
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY D: Integration-Level Tests
// Test through diffParagraphs() public API for end-to-end verification
// MUST FAIL before fix, PASS after
// ═══════════════════════════════════════════════════════════════════════

describe('D: Integration via diffParagraphs() (FAIL before fix, PASS after)', () => {
  // D1: Section with modified paragraph that triggers quality gate
  it('D1: structurally rewritten paragraph has empty wordChanges in ParagraphDiff', () => {
    const oldText =
      'The board of directors approved the acquisition of a controlling interest in the subsidiary, ' +
      'which is expected to close in the fourth quarter pending regulatory approval from the relevant ' +
      'government agencies and satisfaction of customary closing conditions.';
    const newText =
      'Management has determined that recent market conditions necessitate a strategic pivot toward ' +
      'organic growth initiatives, including expanded research and development investment, hiring ' +
      'additional engineering talent, and entering previously unexplored geographic territories.';

    const coverage = rawRemovedCoverage(oldText, newText);
    expect(coverage).toBeGreaterThan(0.70);

    const oldSec = makeSection('item1', 'Business', [
      makeParagraph('Unchanged lead paragraph.', 50),
      makeParagraph(oldText, 200),
      makeParagraph('Unchanged trailing paragraph.', 500),
    ]);
    const newSec = makeSection('item1', 'Business', [
      makeParagraph('Unchanged lead paragraph.', 50),
      makeParagraph(newText, 200),
      makeParagraph('Unchanged trailing paragraph.', 500),
    ]);

    const diffs = diffParagraphs(matchSections(oldSec, newSec));

    // Lead and trailing paragraphs are unchanged
    const unchanged = diffs.filter(d => d.changeType === 'unchanged');
    expect(unchanged).toHaveLength(2);

    // The rewritten paragraph is modified with empty wordChanges (gate triggered)
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    expect(modified.wordChanges).toEqual([]);
  });

  // D2: Section with minor edit — word-level diff preserved
  it('D2: minor edit in section preserves word-level diff', () => {
    const oldSec = makeSection('item1a', 'Risk Factors', [
      makeParagraph('The Company faces various risks.', 50),
      makeParagraph('Revenue was $100 billion in fiscal 2023.', 200),
    ]);
    const newSec = makeSection('item1a', 'Risk Factors', [
      makeParagraph('The Company faces various risks.', 50),
      makeParagraph('Revenue was $120 billion in fiscal 2024.', 200),
    ]);

    const diffs = diffParagraphs(matchSections(oldSec, newSec));

    // First paragraph unchanged
    expect(diffs[0].changeType).toBe('unchanged');

    // Second paragraph modified with word-level diff preserved
    const modified = diffs.find(d => d.changeType === 'modified');
    assertDefined(modified);
    assertDefined(modified.wordChanges);
    expect(modified.wordChanges.length).toBeGreaterThan(0);

    // The diff should identify the numeric and year changes
    const removedText = modified.wordChanges
      .filter(w => w.type === 'removed')
      .map(w => 'Revenue was $100 billion in fiscal 2023.'.slice(w.start, w.end))
      .join('');
    expect(removedText).toContain('100');
  });

  // D3: Multiple paragraphs — mix of gate-triggered and preserved diffs
  //     Uses anchor paragraphs so diffArrays properly aligns changed pairs
  it('D3: section with both high and low coverage paragraphs', () => {
    const oldSec = makeSection('item7', 'MD&A', [
      makeParagraph('Revenue increased by 5% year over year.', 50),
      makeParagraph('This anchor paragraph is identical in both versions.', 130),
      makeParagraph(AAPL_CASES[0].old, 200),
      makeParagraph('Another anchor paragraph that does not change.', 900),
      makeParagraph('Operating margin improved to 30%.', 1000),
    ]);
    const newSec = makeSection('item7', 'MD&A', [
      makeParagraph('Revenue increased by 8% year over year.', 50),
      makeParagraph('This anchor paragraph is identical in both versions.', 130),
      makeParagraph(AAPL_CASES[0].new_, 200),
      makeParagraph('Another anchor paragraph that does not change.', 900),
      makeParagraph('Operating margin improved to 32%.', 1000),
    ]);

    const diffs = diffParagraphs(matchSections(oldSec, newSec));
    const modified = diffs.filter(d => d.changeType === 'modified');
    expect(modified).toHaveLength(3);

    // First paragraph: minor edit → word diff preserved
    assertDefined(modified[0].wordChanges);
    expect(modified[0].wordChanges.length).toBeGreaterThan(0);

    // Second paragraph: AAPL rewrite → gate triggers, empty wordChanges
    expect(modified[1].wordChanges).toEqual([]);

    // Third paragraph: minor edit → word diff preserved
    assertDefined(modified[2].wordChanges);
    expect(modified[2].wordChanges.length).toBeGreaterThan(0);
  });

  // D4: Moved paragraph with text changes — detectMoves() caller path
  //     Tests the second call site of computeWordChanges() at paragraph-differ.ts:280
  it('D4: moved paragraph with high-coverage text changes triggers quality gate via detectMoves', () => {
    // Strategy: change one character in the MIDDLE of each content word.
    // - Character-level JW stays high (~0.96) because positions barely shift
    // - Word-level diffWords sees every modified word as a different token → high removedCoverage
    // - Text kept under 100 chars normalized to bypass word-overlap pre-filter
    const movedOld =
      'The company reported strong revenue growth and management believes these results.';
    const movedNew =
      'The compeny reperted strung revonue gruwth and manogement bolieves thuse rosults.';

    // Sanity checks on crafted text
    const coverage = rawRemovedCoverage(movedOld, movedNew);
    expect(coverage).toBeGreaterThan(0.70);

    const normalizedOld = movedOld.replace(/\s+/g, ' ').trim();
    const normalizedNew = movedNew.replace(/\s+/g, ' ').trim();
    expect(normalizedOld.length).toBeLessThan(100); // bypass word-overlap pre-filter

    const jwSim = jaroWinkler(normalizedOld, normalizedNew);
    expect(jwSim).toBeGreaterThanOrEqual(0.9);

    // Section structure forces detectMoves path:
    // Old: [MovedPara_old, UniqueA] → New: [UniqueB, MovedPara_new]
    // diffArrays: removed(M_old), removed(A), added(B), added(M_new)
    // pairRemovedAdded pairs A+B as modified, leaving M_old and M_new unpaired
    // detectMoves matches them via JW >= 0.9
    const oldSec = makeSection('s', 'S', [
      makeParagraph(movedOld, 100),
      makeParagraph('Unique alpha paragraph with completely distinct original content here.', 300),
    ]);
    const newSec = makeSection('s', 'S', [
      makeParagraph('Different beta paragraph containing entirely separate replacement text.', 100),
      makeParagraph(movedNew, 300),
    ]);

    const diffs = diffParagraphs(matchSections(oldSec, newSec));
    const moved = diffs.filter(d => d.changeType === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);

    // The moved paragraph has text changes → computeWordChanges called via detectMoves
    // Quality gate triggers (removedCoverage > 70%) → wordChanges should be empty
    const movedWithChanges = moved.find(m => m.wordChanges !== undefined);
    assertDefined(movedWithChanges, 'Expected a moved paragraph with wordChanges from detectMoves');
    expect(movedWithChanges.wordChanges).toEqual([]);
  });
});
