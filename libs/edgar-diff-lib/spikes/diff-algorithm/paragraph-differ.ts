/**
 * Paragraph-level diff using Myers algorithm (via `diff` package).
 * Compares paragraphs within matched sections and provides word-level detail
 * for modified paragraphs.
 */
import { diffArrays, diffWords } from 'diff';
import type { Section } from './section-extractor.js';

export interface ParagraphChange {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldText?: string;
  newText?: string;
  wordChanges?: WordChange[];
}

export interface WordChange {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
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
    total: number;
  };
}

/**
 * Diff paragraphs between two sections using Myers algorithm (default).
 * The `diff` package uses Myers by default for diffArrays.
 */
export function diffParagraphsMyers(
  oldSection: Section,
  newSection: Section,
  similarity: number,
): SectionDiff {
  return diffParagraphs(oldSection, newSection, similarity, false);
}

/**
 * Diff paragraphs between two sections using Patience algorithm.
 * Uses a two-pass approach: first identify unique lines (patience), then fill gaps with Myers.
 */
export function diffParagraphsPatience(
  oldSection: Section,
  newSection: Section,
  similarity: number,
): SectionDiff {
  return diffParagraphs(oldSection, newSection, similarity, true);
}

function diffParagraphs(
  oldSection: Section,
  newSection: Section,
  similarity: number,
  usePatience: boolean,
): SectionDiff {
  const oldParas = oldSection.paragraphs;
  const newParas = newSection.paragraphs;

  let arrayDiffs;
  if (usePatience) {
    // Patience: first identify unique matching lines to anchor the diff
    arrayDiffs = patienceDiffArrays(oldParas, newParas);
  } else {
    // Standard Myers diff
    arrayDiffs = diffArrays(oldParas, newParas);
  }

  const changes: ParagraphChange[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (const part of arrayDiffs) {
    const count = part.count ?? 0;
    if (part.added) {
      for (let i = 0; i < count; i++) {
        changes.push({ type: 'added', newText: newParas[newIdx + i] });
      }
      newIdx += count;
    } else if (part.removed) {
      for (let i = 0; i < count; i++) {
        changes.push({ type: 'removed', oldText: oldParas[oldIdx + i] });
      }
      oldIdx += count;
    } else {
      for (let i = 0; i < count; i++) {
        changes.push({
          type: 'unchanged',
          oldText: oldParas[oldIdx + i],
          newText: newParas[newIdx + i],
        });
      }
      oldIdx += count;
      newIdx += count;
    }
  }

  // Post-process: merge adjacent removed+added into "modified" with word-level diff
  const merged = mergeModifications(changes);

  const stats = {
    added: merged.filter((c) => c.type === 'added').length,
    removed: merged.filter((c) => c.type === 'removed').length,
    modified: merged.filter((c) => c.type === 'modified').length,
    unchanged: merged.filter((c) => c.type === 'unchanged').length,
    total: merged.length,
  };

  return {
    oldHeading: oldSection.heading,
    newHeading: newSection.heading,
    similarity,
    changes: merged,
    stats,
  };
}

/**
 * Patience diff: anchor on unique lines shared between old and new,
 * then fill gaps with standard Myers diff.
 */
function patienceDiffArrays(
  oldArr: string[],
  newArr: string[],
): Array<{ count: number; added?: boolean; removed?: boolean }> {
  // Find unique lines in each array
  const oldCounts = new Map<string, number>();
  const newCounts = new Map<string, number>();
  for (const line of oldArr) oldCounts.set(line, (oldCounts.get(line) || 0) + 1);
  for (const line of newArr) newCounts.set(line, (newCounts.get(line) || 0) + 1);

  // Unique in both: lines appearing exactly once in each
  const uniqueInBoth = new Set<string>();
  for (const [line, count] of oldCounts) {
    if (count === 1 && newCounts.get(line) === 1) {
      uniqueInBoth.add(line);
    }
  }

  if (uniqueInBoth.size === 0) {
    // Fall back to standard Myers
    return diffArrays(oldArr, newArr);
  }

  // Find positions of unique lines
  const oldPositions: Array<{ line: string; idx: number }> = [];
  const newPositions = new Map<string, number>();

  for (let i = 0; i < oldArr.length; i++) {
    if (uniqueInBoth.has(oldArr[i])) oldPositions.push({ line: oldArr[i], idx: i });
  }
  for (let i = 0; i < newArr.length; i++) {
    if (uniqueInBoth.has(newArr[i])) newPositions.set(newArr[i], i);
  }

  // Find longest increasing subsequence of matching unique lines
  const anchors: Array<{ oldIdx: number; newIdx: number }> = [];
  const candidates: Array<{ oldIdx: number; newIdx: number }> = [];

  for (const { line, idx } of oldPositions) {
    const newIdx = newPositions.get(line);
    if (newIdx !== undefined) {
      candidates.push({ oldIdx: idx, newIdx });
    }
  }

  // Simple LIS on newIdx values
  const lis = longestIncreasingSubsequence(candidates.map((c) => c.newIdx));
  for (const i of lis) {
    anchors.push(candidates[i]);
  }

  // Now diff between anchors using Myers for the gaps
  const result: Array<{ count: number; added?: boolean; removed?: boolean }> = [];
  let oldPos = 0;
  let newPos = 0;

  for (const anchor of anchors) {
    // Diff the gap before this anchor
    if (oldPos < anchor.oldIdx || newPos < anchor.newIdx) {
      const gapOld = oldArr.slice(oldPos, anchor.oldIdx);
      const gapNew = newArr.slice(newPos, anchor.newIdx);
      if (gapOld.length > 0 || gapNew.length > 0) {
        result.push(...diffArrays(gapOld, gapNew));
      }
    }
    // Add the anchor as unchanged
    result.push({ count: 1 });
    oldPos = anchor.oldIdx + 1;
    newPos = anchor.newIdx + 1;
  }

  // Diff remaining tail
  if (oldPos < oldArr.length || newPos < newArr.length) {
    const gapOld = oldArr.slice(oldPos);
    const gapNew = newArr.slice(newPos);
    if (gapOld.length > 0 || gapNew.length > 0) {
      result.push(...diffArrays(gapOld, gapNew));
    }
  }

  return result;
}

/** Find indices of longest increasing subsequence */
function longestIncreasingSubsequence(arr: number[]): number[] {
  if (arr.length === 0) return [];

  const n = arr.length;
  const tails: number[] = [];       // indices into arr
  const prevs: number[] = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    // Binary search for position
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1;
      else hi = mid;
    }

    if (lo > 0) prevs[i] = tails[lo - 1];
    tails[lo] = i;
  }

  // Reconstruct
  const result: number[] = [];
  let idx = tails[tails.length - 1];
  for (let i = tails.length - 1; i >= 0; i--) {
    result[i] = idx;
    idx = prevs[idx];
  }

  return result;
}

/**
 * Merge adjacent removed+added pairs into "modified" entries with word-level diffs.
 */
function mergeModifications(changes: ParagraphChange[]): ParagraphChange[] {
  const result: ParagraphChange[] = [];

  let i = 0;
  while (i < changes.length) {
    if (
      changes[i].type === 'removed' &&
      i + 1 < changes.length &&
      changes[i + 1].type === 'added'
    ) {
      // This is a modification: old paragraph replaced by new
      const oldText = changes[i].oldText!;
      const newText = changes[i + 1].newText!;

      const wordDiffs = diffWords(oldText, newText);
      const wordChanges: WordChange[] = wordDiffs.map((part) => ({
        type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
        value: part.value,
      }));

      result.push({
        type: 'modified',
        oldText,
        newText,
        wordChanges,
      });
      i += 2;
    } else {
      result.push(changes[i]);
      i++;
    }
  }

  return result;
}

/**
 * Compute diff for all matched section pairs.
 */
export function diffAllSections(
  matchedPairs: Array<{
    oldSection: Section;
    newSection: Section;
    similarity: number;
  }>,
  algorithm: 'myers' | 'patience' = 'myers',
): SectionDiff[] {
  const diffFn = algorithm === 'patience' ? diffParagraphsPatience : diffParagraphsMyers;
  return matchedPairs.map(({ oldSection, newSection, similarity }) =>
    diffFn(oldSection, newSection, similarity),
  );
}
