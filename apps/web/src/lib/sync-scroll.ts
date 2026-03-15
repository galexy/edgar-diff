import type { SectionDiff } from '@edgar-diff/lib';

/** A source offset correspondence between old and new documents. */
export interface OffsetEntry {
  oldStart: number;
  newStart: number;
}

export type SyncDirection = 'oldToNew' | 'newToOld';

/**
 * Build a sorted offset correspondence table from diff data.
 * Each entry maps a source offset in the old document to the
 * corresponding offset in the new document.
 */
export function buildOffsetTable(sectionDiffs: SectionDiff[]): OffsetEntry[] {
  const entries: OffsetEntry[] = [];

  function collectEntries(sections: SectionDiff[]): void {
    for (const sd of sections) {
      // Section boundaries as entries
      if (sd.sourceMapping.old && sd.sourceMapping.new) {
        entries.push({
          oldStart: sd.sourceMapping.old.start,
          newStart: sd.sourceMapping.new.start,
        });
      }

      // Paragraph mappings
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old && pd.sourceMapping.new) {
          entries.push({
            oldStart: pd.sourceMapping.old.start,
            newStart: pd.sourceMapping.new.start,
          });
        }
      }

      // Table mappings
      for (const td of sd.tableDiffs) {
        if (td.sourceMapping.old && td.sourceMapping.new) {
          entries.push({
            oldStart: td.sourceMapping.old.start,
            newStart: td.sourceMapping.new.start,
          });
        }
      }

      // Recurse into subsections
      if (sd.subsectionDiffs.length > 0) {
        collectEntries(sd.subsectionDiffs);
      }
    }
  }

  collectEntries(sectionDiffs);
  entries.sort((a, b) => a.oldStart - b.oldStart);
  return entries;
}

/**
 * Look up a source offset in the correspondence table and return
 * the corresponding offset in the other document.
 *
 * - Exact match → returns corresponding offset directly
 * - Between entries → linear interpolation
 * - Before first / after last → offset translation
 */
export function lookupCorrespondingOffset(
  table: OffsetEntry[],
  sourceOffset: number,
  direction: SyncDirection,
): number {
  if (table.length === 0) return sourceOffset;

  // For newToOld: sort by newStart
  const sorted = direction === 'oldToNew'
    ? table
    : [...table].sort((a, b) => a.newStart - b.newStart);

  const srcKey = direction === 'oldToNew' ? 'oldStart' : 'newStart';
  const tgtKey = direction === 'oldToNew' ? 'newStart' : 'oldStart';

  // Single entry — offset translation
  if (sorted.length === 1) {
    return sourceOffset - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // Before first entry
  if (sourceOffset <= sorted[0][srcKey]) {
    return sourceOffset - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // After last entry
  const last = sorted[sorted.length - 1];
  if (sourceOffset >= last[srcKey]) {
    return sourceOffset - last[srcKey] + last[tgtKey];
  }

  // Binary search for exact match or bracketing entries
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid][srcKey] <= sourceOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Exact match on lo bracket
  if (sorted[lo][srcKey] === sourceOffset) {
    return sorted[lo][tgtKey];
  }

  // Between entries — linear interpolation
  const a = sorted[lo];
  const b = sorted[hi];
  const srcSpan = b[srcKey] - a[srcKey];
  if (srcSpan === 0) return a[tgtKey];
  const t = (sourceOffset - a[srcKey]) / srcSpan;
  return a[tgtKey] + t * (b[tgtKey] - a[tgtKey]);
}

/**
 * Find the block element whose top edge is at or just above the
 * panel's current viewport top. Returns the element's source offset
 * and pixel distance from the element's top to the viewport top.
 */
export function findBlockAtViewportTop(
  panel: HTMLDivElement,
): { sourceStart: number; pixelOffset: number } | null {
  const elements = panel.querySelectorAll<HTMLElement>('[data-source-start]');
  if (elements.length === 0) return null;

  const panelRect = panel.getBoundingClientRect();
  const viewportTop = panel.scrollTop;

  let bestElement: HTMLElement | null = null;
  let bestAbsTop = -Infinity;

  for (const el of elements) {
    const absTop = el.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
    if (absTop <= viewportTop && absTop > bestAbsTop) {
      bestAbsTop = absTop;
      bestElement = el;
    }
  }

  if (!bestElement) {
    // All elements below viewport top — use the first element
    const first = elements[0];
    const sourceStart = parseInt(first.dataset.sourceStart ?? '', 10);
    if (Number.isNaN(sourceStart)) return null;
    const absTop = first.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
    return {
      sourceStart,
      pixelOffset: viewportTop - absTop,
    };
  }

  const sourceStart = parseInt(bestElement.dataset.sourceStart ?? '', 10);
  if (Number.isNaN(sourceStart)) return null;

  return {
    sourceStart,
    pixelOffset: viewportTop - bestAbsTop,
  };
}

/**
 * Find the annotated element in a panel whose source offset is closest
 * to the target offset. Returns its absolute Y position.
 */
export function findBlockBySourceOffset(
  panel: HTMLDivElement,
  targetOffset: number,
): number | null {
  const elements = panel.querySelectorAll<HTMLElement>('[data-source-start]');
  if (elements.length === 0) return null;

  const panelRect = panel.getBoundingClientRect();
  let bestElement: HTMLElement | null = null;
  let bestDistance = Infinity;

  for (const el of elements) {
    const elOffset = parseInt(el.dataset.sourceStart ?? '', 10);
    if (Number.isNaN(elOffset)) continue;
    const distance = Math.abs(elOffset - targetOffset);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestElement = el;
    }
  }

  if (!bestElement) return null;

  return bestElement.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
}
