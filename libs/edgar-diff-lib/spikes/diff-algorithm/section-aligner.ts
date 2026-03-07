/**
 * Section alignment using Jaro-Winkler string similarity on normalized headings.
 */
import jaroWinkler from 'jaro-winkler';
import type { Section } from './section-extractor.js';

export interface SectionMatch {
  oldSection: Section;
  newSection: Section;
  similarity: number;
}

export interface AlignmentResult {
  matched: SectionMatch[];
  added: Section[];
  removed: Section[];
}

export interface ThresholdResult {
  threshold: number;
  matched: number;
  added: number;
  removed: number;
  avgSimilarity: number;
}

/**
 * Compute Jaro-Winkler similarity between two strings.
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  return jaroWinkler(a, b);
}

/**
 * Align sections between an old and new filing using Jaro-Winkler similarity
 * on normalized headings. Uses a greedy best-match approach.
 *
 * @param oldSections Sections from the older filing
 * @param newSections Sections from the newer filing
 * @param threshold Minimum similarity to consider a match (0.0-1.0)
 */
export function alignSections(
  oldSections: Section[],
  newSections: Section[],
  threshold = 0.75,
): AlignmentResult {
  const matched: SectionMatch[] = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  // Build similarity matrix
  const similarities: Array<{ oldIdx: number; newIdx: number; similarity: number }> = [];
  for (let i = 0; i < oldSections.length; i++) {
    for (let j = 0; j < newSections.length; j++) {
      const sim = jaroWinklerSimilarity(
        oldSections[i].normalizedHeading,
        newSections[j].normalizedHeading,
      );
      if (sim >= threshold) {
        similarities.push({ oldIdx: i, newIdx: j, similarity: sim });
      }
    }
  }

  // Greedy: pick highest similarity first
  similarities.sort((a, b) => b.similarity - a.similarity);

  for (const { oldIdx, newIdx, similarity } of similarities) {
    if (usedOld.has(oldIdx) || usedNew.has(newIdx)) continue;
    usedOld.add(oldIdx);
    usedNew.add(newIdx);
    matched.push({
      oldSection: oldSections[oldIdx],
      newSection: newSections[newIdx],
      similarity,
    });
  }

  // Sort matched by document order (old filing position)
  matched.sort((a, b) => a.oldSection.startIndex - b.oldSection.startIndex);

  const added = newSections.filter((_, i) => !usedNew.has(i));
  const removed = oldSections.filter((_, i) => !usedOld.has(i));

  return { matched, added, removed };
}

/**
 * Experiment with multiple thresholds and report accuracy for each.
 */
export function experimentThresholds(
  oldSections: Section[],
  newSections: Section[],
  thresholds: number[] = [0.6, 0.7, 0.75, 0.8, 0.85, 0.9],
): ThresholdResult[] {
  return thresholds.map((threshold) => {
    const result = alignSections(oldSections, newSections, threshold);
    const avgSim =
      result.matched.length > 0
        ? result.matched.reduce((sum, m) => sum + m.similarity, 0) / result.matched.length
        : 0;
    return {
      threshold,
      matched: result.matched.length,
      added: result.added.length,
      removed: result.removed.length,
      avgSimilarity: avgSim,
    };
  });
}
