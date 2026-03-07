import jaroWinkler from 'jaro-winkler';
import type { FilingSection } from '../types.js';
import { normalizeHeading } from '../parser/index.js';
import type { ChangeType, AlignmentOptions } from './types.js';

const DEFAULT_THRESHOLD = 0.75;

/** A matched pair of sections with similarity score. */
export interface SectionMatch {
  oldIndex: number;
  newIndex: number;
  oldSection: FilingSection;
  newSection: FilingSection;
  similarity: number;
}

/** Result of the alignment phase. */
export interface AlignmentResult {
  matched: SectionMatch[];
  added: FilingSection[];
  removed: FilingSection[];
}

/** Serialize a section's content blocks to a canonical string for comparison. */
export function serializeSectionContent(section: FilingSection): string {
  const parts: string[] = [];
  for (const block of section.blocks) {
    if (block.type === 'paragraph') {
      parts.push(block.text);
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          parts.push(cell.text);
        }
      }
    }
  }
  return parts.join('\n');
}

/** Align sections by normalized heading similarity using greedy best-match. */
export function alignSections(
  oldSections: FilingSection[],
  newSections: FilingSection[],
  options?: AlignmentOptions,
): AlignmentResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  // Build similarity matrix (only pairs above threshold)
  const candidates: Array<{ oldIdx: number; newIdx: number; similarity: number }> = [];
  for (let i = 0; i < oldSections.length; i++) {
    const normOld = normalizeHeading(oldSections[i].heading);
    for (let j = 0; j < newSections.length; j++) {
      const normNew = normalizeHeading(newSections[j].heading);
      const sim = jaroWinkler(normOld, normNew);
      if (sim >= threshold) {
        candidates.push({ oldIdx: i, newIdx: j, similarity: sim });
      }
    }
  }

  // Greedy: pick highest similarity first
  candidates.sort((a, b) => b.similarity - a.similarity);

  const matched: SectionMatch[] = [];
  for (const { oldIdx, newIdx, similarity } of candidates) {
    if (usedOld.has(oldIdx) || usedNew.has(newIdx)) continue;
    usedOld.add(oldIdx);
    usedNew.add(newIdx);
    matched.push({
      oldIndex: oldIdx,
      newIndex: newIdx,
      oldSection: oldSections[oldIdx],
      newSection: newSections[newIdx],
      similarity,
    });
  }

  const added = newSections.filter((_, i) => !usedNew.has(i));
  const removed = oldSections.filter((_, i) => !usedOld.has(i));

  return { matched, added, removed };
}

/** Check if a matched pair is reordered relative to other matches. */
export function isReordered(
  allMatches: SectionMatch[],
  target: SectionMatch,
): boolean {
  for (const other of allMatches) {
    if (other === target) continue;
    const oldOrdered = target.oldIndex < other.oldIndex;
    const newOrdered = target.newIndex < other.newIndex;
    if (oldOrdered !== newOrdered) return true;
  }
  return false;
}

/** Classify a matched section pair as modified, unchanged, or reordered. */
export function classifySectionDiff(
  match: SectionMatch,
  allMatches: SectionMatch[],
): ChangeType {
  const oldContent = serializeSectionContent(match.oldSection);
  const newContent = serializeSectionContent(match.newSection);

  if (oldContent !== newContent) {
    return 'modified';
  }

  if (isReordered(allMatches, match)) {
    return 'reordered';
  }

  return 'unchanged';
}
