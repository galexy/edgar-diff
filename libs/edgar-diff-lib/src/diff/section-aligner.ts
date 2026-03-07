import jaroWinkler from 'jaro-winkler';
import type { FilingSection } from '../types.js';
import { normalizeHeading, extractItemNumber } from '../parser/index.js';
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

/** Align sections using two-phase matching: exact item number first, then Jaro-Winkler fallback. */
export function alignSections(
  oldSections: FilingSection[],
  newSections: FilingSection[],
  options?: AlignmentOptions,
): AlignmentResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const matched: SectionMatch[] = [];

  // Phase 1: Match by exact item number
  const oldItemNumbers = oldSections.map((s) => extractItemNumber(s.heading));
  const newItemNumbers = newSections.map((s) => extractItemNumber(s.heading));

  // Build a map of item number -> indices for new sections
  const newByItemNumber = new Map<string, number[]>();
  for (let j = 0; j < newSections.length; j++) {
    const num = newItemNumbers[j];
    if (num) {
      const list = newByItemNumber.get(num) ?? [];
      list.push(j);
      newByItemNumber.set(num, list);
    }
  }

  for (let i = 0; i < oldSections.length; i++) {
    const num = oldItemNumbers[i];
    if (!num) continue;
    const candidates = newByItemNumber.get(num);
    if (!candidates) continue;
    // Find first unused new section with this item number
    for (const j of candidates) {
      if (usedNew.has(j)) continue;
      usedOld.add(i);
      usedNew.add(j);
      const normOld = normalizeHeading(oldSections[i].heading);
      const normNew = normalizeHeading(newSections[j].heading);
      matched.push({
        oldIndex: i,
        newIndex: j,
        oldSection: oldSections[i],
        newSection: newSections[j],
        similarity: jaroWinkler(normOld, normNew),
      });
      break;
    }
  }

  // Phase 2: Jaro-Winkler fallback for remaining unmatched sections WITHOUT item numbers.
  // Sections with recognized item numbers that didn't match in phase 1 are not eligible
  // for JW fallback — they should only match by item number to prevent false positives.
  const jwCandidates: Array<{ oldIdx: number; newIdx: number; similarity: number }> = [];
  for (let i = 0; i < oldSections.length; i++) {
    if (usedOld.has(i) || oldItemNumbers[i]) continue;
    const normOld = normalizeHeading(oldSections[i].heading);
    for (let j = 0; j < newSections.length; j++) {
      if (usedNew.has(j) || newItemNumbers[j]) continue;
      const normNew = normalizeHeading(newSections[j].heading);
      const sim = jaroWinkler(normOld, normNew);
      if (sim >= threshold) {
        jwCandidates.push({ oldIdx: i, newIdx: j, similarity: sim });
      }
    }
  }

  jwCandidates.sort((a, b) => b.similarity - a.similarity);

  for (const { oldIdx, newIdx, similarity } of jwCandidates) {
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
