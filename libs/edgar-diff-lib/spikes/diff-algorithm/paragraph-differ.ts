/**
 * Paragraph-level diffing using the `diff` npm package (Myers) and
 * a custom patience diff implementation for comparison.
 */
import { diffArrays, diffWords, type ArrayChange } from 'diff';
import type { SectionMatch } from './section-aligner.js';

export interface ParagraphChange {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldText?: string;
  newText?: string;
  /** Word-level diff for modified paragraphs */
  wordDiff?: string;
}

export interface SectionDiff {
  oldHeading: string;
  newHeading: string;
  similarity: number;
  changes: ParagraphChange[];
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export interface DiffResult {
  sectionDiffs: SectionDiff[];
  totalStats: {
    sectionsCompared: number;
    totalAdded: number;
    totalRemoved: number;
    totalModified: number;
    totalUnchanged: number;
  };
}

/**
 * Compute word-level diff between two paragraph texts.
 * Returns a compact string showing insertions [+word] and deletions [-word].
 */
function computeWordDiff(oldText: string, newText: string): string {
  const changes = diffWords(oldText, newText);
  const parts: string[] = [];
  for (const change of changes) {
    if (change.added) {
      parts.push(`[+${change.value.trim()}]`);
    } else if (change.removed) {
      parts.push(`[-${change.value.trim()}]`);
    } else {
      // Show first few words of context
      const words = change.value.trim().split(/\s+/);
      if (words.length <= 6) {
        parts.push(change.value.trim());
      } else {
        parts.push(`${words.slice(0, 3).join(' ')} ... ${words.slice(-3).join(' ')}`);
      }
    }
  }
  return parts.join(' ');
}

/**
 * Normalize paragraph text for comparison.
 * Collapses whitespace and trims to reduce noise.
 */
function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Patience diff implementation ─────────────────────────────────────

/**
 * Find the longest increasing subsequence of indices.
 * Returns the indices into the input array that form the LIS.
 */
function longestIncreasingSubsequence(arr: number[]): number[] {
  if (arr.length === 0) return [];

  // tails[i] = smallest tail element for IS of length i+1
  const tails: number[] = [];
  // tailIndices[i] = index in arr of tails[i]
  const tailIndices: number[] = [];
  // prev[i] = index of previous element in LIS ending at arr[i]
  const prev: number[] = new Array(arr.length).fill(-1);

  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    // Binary search for position
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tails[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = val;
    tailIndices[lo] = i;
    prev[i] = lo > 0 ? tailIndices[lo - 1] : -1;
  }

  // Reconstruct
  const result: number[] = [];
  let idx = tailIndices[tails.length - 1];
  while (idx !== -1) {
    result.push(idx);
    idx = prev[idx];
  }
  return result.reverse();
}

/**
 * Patience diff: anchors on unique lines, then fills gaps with Myers.
 *
 * 1. Find lines appearing exactly once in both old and new
 * 2. Find LIS of their positions to get stable anchors
 * 3. Run Myers diff (via diffArrays) on each gap between anchors
 */
function patienceDiffArrays(oldArr: string[], newArr: string[]): ArrayChange<string>[] {
  // Step 1: Find unique lines in each array
  const oldCounts = new Map<string, number[]>();
  for (let i = 0; i < oldArr.length; i++) {
    const indices = oldCounts.get(oldArr[i]) ?? [];
    indices.push(i);
    oldCounts.set(oldArr[i], indices);
  }

  const newCounts = new Map<string, number[]>();
  for (let i = 0; i < newArr.length; i++) {
    const indices = newCounts.get(newArr[i]) ?? [];
    indices.push(i);
    newCounts.set(newArr[i], indices);
  }

  // Find lines unique in both
  const uniqueMatches: Array<{ oldIdx: number; newIdx: number }> = [];
  for (const [line, oldIndices] of oldCounts) {
    if (oldIndices.length !== 1) continue;
    const newIndices = newCounts.get(line);
    if (!newIndices || newIndices.length !== 1) continue;
    uniqueMatches.push({ oldIdx: oldIndices[0], newIdx: newIndices[0] });
  }

  // Sort by old position
  uniqueMatches.sort((a, b) => a.oldIdx - b.oldIdx);

  // Step 2: LIS on new indices to find stable anchor ordering
  const newIndices = uniqueMatches.map((m) => m.newIdx);
  const lisPositions = longestIncreasingSubsequence(newIndices);
  const anchors = lisPositions.map((i) => uniqueMatches[i]);

  // Step 3: Fill gaps with Myers diff
  if (anchors.length === 0) {
    // No unique anchors — fall back to pure Myers
    return diffArrays(oldArr, newArr);
  }

  const result: ArrayChange<string>[] = [];

  let oldPos = 0;
  let newPos = 0;

  for (const anchor of anchors) {
    // Diff the gap before this anchor
    const oldGap = oldArr.slice(oldPos, anchor.oldIdx);
    const newGap = newArr.slice(newPos, anchor.newIdx);
    if (oldGap.length > 0 || newGap.length > 0) {
      result.push(...diffArrays(oldGap, newGap));
    }

    // Add the anchor as unchanged
    result.push({ value: [oldArr[anchor.oldIdx]], count: 1, added: false, removed: false });

    oldPos = anchor.oldIdx + 1;
    newPos = anchor.newIdx + 1;
  }

  // Diff the trailing gap
  const oldTail = oldArr.slice(oldPos);
  const newTail = newArr.slice(newPos);
  if (oldTail.length > 0 || newTail.length > 0) {
    result.push(...diffArrays(oldTail, newTail));
  }

  return result;
}

// ── Main diff function ───────────────────────────────────────────────

/**
 * Process diff hunks into ParagraphChange array.
 */
function processHunks(arrayDiff: ArrayChange<string>[]): {
  changes: ParagraphChange[];
  stats: { added: number; removed: number; modified: number; unchanged: number };
} {
  const changes: ParagraphChange[] = [];
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  let i = 0;
  while (i < arrayDiff.length) {
    const hunk = arrayDiff[i];

    if (hunk.added) {
      for (const val of hunk.value) {
        changes.push({ type: 'added', newText: val });
        stats.added++;
      }
      i++;
    } else if (hunk.removed) {
      // Check if next hunk is an add — if so, pair them as modifications
      const next = arrayDiff[i + 1];
      if (next?.added) {
        const removedVals = hunk.value;
        const addedVals = next.value;
        const pairCount = Math.min(removedVals.length, addedVals.length);

        for (let p = 0; p < pairCount; p++) {
          const wordDiff = computeWordDiff(removedVals[p], addedVals[p]);
          changes.push({
            type: 'modified',
            oldText: removedVals[p],
            newText: addedVals[p],
            wordDiff,
          });
          stats.modified++;
        }
        // Remaining unpaired removals/additions
        for (let p = pairCount; p < removedVals.length; p++) {
          changes.push({ type: 'removed', oldText: removedVals[p] });
          stats.removed++;
        }
        for (let p = pairCount; p < addedVals.length; p++) {
          changes.push({ type: 'added', newText: addedVals[p] });
          stats.added++;
        }
        i += 2;
      } else {
        for (const val of hunk.value) {
          changes.push({ type: 'removed', oldText: val });
          stats.removed++;
        }
        i++;
      }
    } else {
      // Unchanged
      for (const val of hunk.value) {
        changes.push({ type: 'unchanged', oldText: val, newText: val });
        stats.unchanged++;
      }
      i++;
    }
  }

  return { changes, stats };
}

/**
 * Run paragraph-level diff on matched section pairs.
 *
 * @param matches Array of matched section pairs from the aligner
 * @param algorithm 'patience' uses unique-paragraph anchoring + LIS + Myers on gaps;
 *                  'myers' uses standard Myers diff via the `diff` npm package
 */
export function diffParagraphs(
  matches: SectionMatch[],
  algorithm: 'patience' | 'myers' = 'patience',
): DiffResult {
  const sectionDiffs: SectionDiff[] = [];
  const totalStats = {
    sectionsCompared: 0,
    totalAdded: 0,
    totalRemoved: 0,
    totalModified: 0,
    totalUnchanged: 0,
  };

  for (const match of matches) {
    const oldParagraphs = match.oldSection.paragraphs.map(normalizeParagraph);
    const newParagraphs = match.newSection.paragraphs.map(normalizeParagraph);

    const arrayDiff =
      algorithm === 'patience'
        ? patienceDiffArrays(oldParagraphs, newParagraphs)
        : diffArrays(oldParagraphs, newParagraphs);

    const { changes, stats } = processHunks(arrayDiff);

    sectionDiffs.push({
      oldHeading: match.oldSection.heading,
      newHeading: match.newSection.heading,
      similarity: match.similarity,
      changes,
      stats,
    });

    totalStats.sectionsCompared++;
    totalStats.totalAdded += stats.added;
    totalStats.totalRemoved += stats.removed;
    totalStats.totalModified += stats.modified;
    totalStats.totalUnchanged += stats.unchanged;
  }

  return { sectionDiffs, totalStats };
}
