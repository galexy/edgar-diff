import jaroWinkler from 'jaro-winkler';
import type { Table } from '../types.js';
import type { TableMatch, TableMatchResult } from './types.js';

const DEFAULT_SIMILARITY_THRESHOLD = 0.70;
const POSITION_BONUS = 0.05;

/**
 * Extract concatenated text from all header rows of a table.
 */
function getHeaderText(table: Table): string {
  return table.rows
    .filter((r) => r.isHeader)
    .map((r) => r.cells.map((c) => c.text).join(' '))
    .join(' ');
}

/**
 * Match tables between old and new filing sections by position + header similarity.
 *
 * Algorithm:
 * 1. Build a similarity matrix using Jaro-Winkler on header text.
 * 2. Apply position-weighted greedy matching: prefer same-ordinal matches.
 * 3. Unmatched old tables are removed; unmatched new tables are added.
 */
export function matchTables(
  oldTables: Table[],
  newTables: Table[],
  options?: { similarityThreshold?: number },
): TableMatchResult {
  const threshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  if (oldTables.length === 0 && newTables.length === 0) {
    return { matched: [], added: [], removed: [] };
  }
  if (oldTables.length === 0) {
    return { matched: [], added: [...newTables], removed: [] };
  }
  if (newTables.length === 0) {
    return { matched: [], added: [], removed: [...oldTables] };
  }

  // Precompute header text to avoid redundant extraction inside O(n×m) loop
  const oldHeaders = oldTables.map(getHeaderText);
  const newHeaders = newTables.map(getHeaderText);

  // Build similarity matrix
  const candidates: Array<{ oldIdx: number; newIdx: number; similarity: number; score: number }> = [];

  for (let i = 0; i < oldTables.length; i++) {
    for (let j = 0; j < newTables.length; j++) {
      const oldHeader = oldHeaders[i];
      const newHeader = newHeaders[j];

      let similarity: number;
      if (oldHeader === '' && newHeader === '') {
        // Both have no headers — match by position only
        similarity = i === j ? 1.0 : 0.0;
      } else if (oldHeader === '' || newHeader === '') {
        similarity = 0.0;
      } else {
        similarity = jaroWinkler(oldHeader, newHeader);
      }

      if (similarity >= threshold || (oldHeader === '' && newHeader === '' && i === j)) {
        // Position bonus for same-ordinal
        const score = similarity + (i === j ? POSITION_BONUS : 0);
        candidates.push({ oldIdx: i, newIdx: j, similarity, score });
      }
    }
  }

  // Greedy: pick highest score first
  candidates.sort((a, b) => b.score - a.score);

  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const matched: TableMatch[] = [];

  for (const { oldIdx, newIdx, similarity } of candidates) {
    if (usedOld.has(oldIdx) || usedNew.has(newIdx)) continue;
    usedOld.add(oldIdx);
    usedNew.add(newIdx);
    matched.push({
      oldTable: oldTables[oldIdx],
      newTable: newTables[newIdx],
      similarity,
    });
  }

  // Sort by old table position for stable output
  matched.sort((a, b) => {
    const aIdx = oldTables.indexOf(a.oldTable);
    const bIdx = oldTables.indexOf(b.oldTable);
    return aIdx - bIdx;
  });

  const added = newTables.filter((_, i) => !usedNew.has(i));
  const removed = oldTables.filter((_, i) => !usedOld.has(i));

  return { matched, added, removed };
}
