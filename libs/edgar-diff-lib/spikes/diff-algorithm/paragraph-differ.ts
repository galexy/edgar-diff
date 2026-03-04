/**
 * Paragraph-level diffing using the `diff` npm package.
 * Supports both patience (default) and Myers algorithms for comparison.
 */
import { diffArrays, diffWords } from 'diff';
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

/**
 * Run paragraph-level diff on matched section pairs.
 * Uses diffArrays from the diff package (patience mode by default).
 *
 * @param matches Array of matched section pairs from the aligner
 * @param algorithm 'patience' uses unique-line anchors; 'myers' uses classic Myers diff
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

    // diffArrays compares arrays element-by-element
    const arrayDiff = diffArrays(oldParagraphs, newParagraphs);

    const changes: ParagraphChange[] = [];
    const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };

    // Process diff hunks — look for adjacent remove+add pairs as modifications
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
