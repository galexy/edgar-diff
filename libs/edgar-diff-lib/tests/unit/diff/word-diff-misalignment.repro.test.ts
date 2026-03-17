/**
 * Reproduction test for diffWords misalignment bug (GitHub #75).
 *
 * These tests call computeWordChanges() on real AAPL 10-K paragraph pairs
 * and measure the quality of the resulting word-level diff.
 *
 * CURRENT STATE: All "quality target" tests FAIL because diffWords produces
 * poor alignments. The "documents broken behavior" tests PASS and record the
 * exact current metrics — update these when the fix lands.
 *
 * WHAT A FIX SHOULD ACHIEVE:
 * - removedCoverage: fraction of old text chars marked as removed. Lower is
 *   better. Currently 86-88%. A good fix should bring this under 70% — meaning
 *   the old side shows targeted word removals, not a wall of red.
 * - falseAddedRate: fraction of words marked "added" on the new side that
 *   already existed in the old text. Lower is better. Currently 37-43%. A good
 *   fix should bring this under 20%.
 * - unchangedRatio: fraction of old text chars that diffWords correctly
 *   identified as unchanged. Higher is better. Currently ~7%. Given that
 *   38-54% of new-side words exist in the old text, a good fix should find
 *   at least 15% of old chars as unchanged.
 */
import { describe, it, expect } from 'vitest';
import { diffWords } from 'diff';

// ─── Replicate computeWordChanges from paragraph-differ.ts ─────────
// (not exported, so we inline it here for isolated testing)

interface WordChange {
  type: 'added' | 'removed';
  start: number;
  end: number;
}

function computeWordChanges(oldText: string, newText: string): WordChange[] {
  const changes = diffWords(oldText, newText);
  const result: WordChange[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const c of changes) {
    const len = c.value.length;
    if (c.added) {
      result.push({ type: 'added', start: newPos, end: newPos + len });
      newPos += len;
    } else if (c.removed) {
      result.push({ type: 'removed', start: oldPos, end: oldPos + len });
      oldPos += len;
    } else {
      oldPos += len;
      newPos += len;
    }
  }
  return result;
}

// ─── Quality metrics ───────────────────────────────────────────────

interface DiffQuality {
  /** Fraction of old text chars marked as removed (0-1). Lower = better. */
  removedCoverage: number;
  /** Fraction of "added" words that already exist in old text (0-1). Lower = better. */
  falseAddedRate: number;
  /** Fraction of old text chars found as unchanged (0-1). Higher = better. */
  unchangedRatio: number;
  /** Raw counts for debugging. */
  removedChars: number;
  addedChars: number;
  unchangedChars: number;
}

function measureQuality(oldText: string, newText: string): DiffQuality {
  const wordChanges = computeWordChanges(oldText, newText);

  const removedChars = wordChanges
    .filter(wc => wc.type === 'removed')
    .reduce((sum, wc) => sum + (wc.end - wc.start), 0);
  const addedChars = wordChanges
    .filter(wc => wc.type === 'added')
    .reduce((sum, wc) => sum + (wc.end - wc.start), 0);
  const unchangedChars = oldText.length - removedChars;

  const oldWords = new Set(oldText.toLowerCase().split(/\s+/));
  let addedWordsInOld = 0;
  let totalAddedWords = 0;
  for (const wc of wordChanges.filter(w => w.type === 'added')) {
    const words = newText.slice(wc.start, wc.end).split(/\s+/).filter(w => w.length > 0);
    for (const w of words) {
      totalAddedWords++;
      if (oldWords.has(w.toLowerCase())) addedWordsInOld++;
    }
  }

  return {
    removedCoverage: removedChars / oldText.length,
    falseAddedRate: totalAddedWords > 0 ? addedWordsInOld / totalAddedWords : 0,
    unchangedRatio: unchangedChars / oldText.length,
    removedChars,
    addedChars,
    unchangedChars,
  };
}

// ─── Test data: real AAPL 10-K FY2023 vs FY2024 paragraph pairs ───

const CASES = [
  {
    label: 'Case 1: Item 1A Risk Factors — litigation paragraph',
    old: `The outcome of litigation or government investigations is inherently uncertain. If one or more legal matters were resolved against the Company or an indemnified third party in a reporting period for amounts above management's expectations, the Company's results of operations and financial condition for that reporting period could be materially adversely affected. Further, such an outcome can result in significant compensatory, punitive or trebled monetary damages, disgorgement of revenue or profits, remedial corporate measures or injunctive relief against the Company, and has from time to time required, and can in the future require, the Company to change its business practices and limit the Company's ability to offer certain products and services, all of which could materially adversely affect the Company's business, reputation, results of operations and financial condition.`,
    new: `The Company is subject to various claims, legal proceedings and government investigations that have arisen in the ordinary course of business and have not yet been fully resolved, and new matters may arise in the future. In addition, the Company enters into agreements that include indemnification provisions that can subject the Company to costs and damages in the event of a claim against an indemnified third party. The number of claims, legal proceedings and government investigations involving the Company, and the alleged magnitude of such claims, proceedings and government investigations, has generally increased over time and may continue to increase.`,
    sharedPhrases: ['government investigations', 'the Company', 'indemnified third party', 'the future'],
  },
  {
    label: 'Case 2: Item 1A Risk Factors — security/malicious attacks paragraph',
    old: `The Company experiences malicious attacks and other attempts to gain unauthorized access to its systems on a regular basis. These attacks seek to compromise the confidentiality, integrity or availability of confidential information or disrupt normal business operations, and can, among other things, impair the Company's ability to attract and retain customers for its products and services, impact the Company's stock price, materially damage commercial relationships, and expose the Company to litigation or government investigations, which could result in penalties, fines or judgments against the Company. Globally, attacks are expected to continue accelerating in both frequency and sophistication with increasing use by actors of tools and techniques that are designed to circumvent controls, avoid detection, and remove or obfuscate forensic evidence, all of which hinders the Company's ability to identify, investigate and recover from incidents. In addition, attacks against the Company and its customers can escalate during periods of severe diplomatic or armed conflict.`,
    new: `The Company's business requires it to use and store confidential information, including personal and sensitive health and financial information with respect to the Company's customers and employees. The Company devotes significant resources to systems and data security, including through the use of encryption and other security measures intended to protect its systems and data. But these measures cannot provide absolute security, and losses or unauthorized access to or releases of confidential information occur and could materially adversely affect the Company's business, reputation, results of operations, financial condition and stock price.`,
    sharedPhrases: ['confidential information', 'unauthorized access', "the Company's", 'stock price'],
  },
  {
    label: 'Case 3: Item 1 Business — competition paragraph',
    old: `The Company is focused on expanding its market opportunities related to smartphones, personal computers, tablets, wearables and accessories, and services. The Company faces substantial competition in these markets from companies that have significant technical, marketing, distribution and other resources, as well as established hardware, software, and service offerings with large customer bases. In addition, some of the Company's competitors have broader product lines, lower-priced products and a larger installed base of active devices. Competition has been particularly intense as competitors have aggressively cut prices and lowered product margins. Certain competitors have the resources, experience or cost structures to provide products at little or no profit or even at a loss. The Company's services compete with business models that provide content to users for free and use illegitimate means to obtain third-party digital content and applications. The Company faces significant competition as competitors imitate the Company's product features and applications within their products, or collaborate to offer integrated solutions that are more competitive than those they currently offer.`,
    new: `The markets for the Company's products and services are highly competitive and are characterized by aggressive price competition, downward pressure on gross margins, continual improvement in product performance, and price sensitivity on the part of consumers and businesses. The markets in which the Company competes are further defined by frequent introduction of new products and services, short product life cycles, evolving industry standards, and rapid adoption of technological advancements by competitors. Many of the Company's competitors seek to compete primarily through aggressive pricing and very low cost structures, and by imitating the Company's products and infringing on its intellectual property.`,
    sharedPhrases: ["the Company's", 'competitors', 'cost structures', 'products and services'],
  },
];

// ─── Tests ─────────────────────────────────────────────────────────

describe('REPRO: diffWords misalignment in modified paragraphs (#75)', () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      const quality = measureQuality(testCase.old, testCase.new);

      // ── Quality targets (FAIL now, PASS when fixed) ──────────
      //
      // These define what "good enough" looks like. A coding agent
      // should iterate until these pass.

      it('old side: removed coverage should be < 70% (not a wall of red)', () => {
        // CURRENT: 86-88% — nearly all old text is red strikethrough
        // TARGET:  < 70%  — meaningful portions left as unchanged
        expect(quality.removedCoverage).toBeLessThan(0.70);
      });

      it('new side: false-added rate should be < 20% (added words should actually be new)', () => {
        // CURRENT: 37-43% — almost half of "added" words already existed in old
        // TARGET:  < 20%  — most highlights are genuinely new content
        expect(quality.falseAddedRate).toBeLessThan(0.20);
      });

      it('should find > 15% of old text as unchanged (common subsequences)', () => {
        // CURRENT: ~7% — algorithm finds almost nothing in common
        // TARGET:  > 15% — at minimum, shared phrases should be found
        expect(quality.unchangedRatio).toBeGreaterThan(0.15);
      });

      // ── Documents current broken behavior (PASS now) ─────────
      //
      // These record the exact broken metrics. When the fix lands,
      // these will FAIL — delete them and keep only the targets above.

      it('[BROKEN] currently marks > 80% of old text as removed', () => {
        expect(quality.removedCoverage).toBeGreaterThan(0.80);
      });

      it('[BROKEN] currently has > 30% false-added rate', () => {
        expect(quality.falseAddedRate).toBeGreaterThan(0.30);
      });

      it('[BROKEN] currently finds < 10% of old text as unchanged', () => {
        expect(quality.unchangedRatio).toBeLessThan(0.10);
      });
    });
  }
});
