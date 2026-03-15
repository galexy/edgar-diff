import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { SectionDiff } from '@edgar-diff/lib';
import {
  buildOffsetTable,
  findBlockAtViewportTop,
  lookupCorrespondingOffset,
  findBlockBySourceOffset,
  type SyncDirection,
} from '../lib/sync-scroll';

/**
 * Synchronize scroll position between two panels using offset-based
 * content lookup. When enabled, scrolling one panel identifies the
 * content at the viewport top via source offsets, looks up the
 * corresponding content in the other document via diff data,
 * and scrolls to align it.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  sectionDiffs?: SectionDiff[],
): void {
  const isProgrammaticScrollRef = useRef(false);

  // Build offset table once when diff data changes
  const offsetTable = useMemo(
    () => (sectionDiffs ? buildOffsetTable(sectionDiffs) : []),
    [sectionDiffs],
  );

  useEffect(() => {
    const panelA = panelARef.current;
    const panelB = panelBRef.current;
    if (!panelA || !panelB || !enabled) return;

    const makeSyncHandler = (
      source: HTMLDivElement,
      target: HTMLDivElement,
      direction: SyncDirection,
    ) => {
      let rafId = 0;
      return () => {
        if (isProgrammaticScrollRef.current) {
          isProgrammaticScrollRef.current = false;
          return;
        }

        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const block = findBlockAtViewportTop(source);
          if (!block) return;

          const targetOffset = lookupCorrespondingOffset(
            offsetTable,
            block.sourceStart,
            direction,
          );

          const targetY = findBlockBySourceOffset(target, targetOffset);
          if (targetY == null) return;

          isProgrammaticScrollRef.current = true;
          target.scrollTop = targetY + block.pixelOffset;
        });
      };
    };

    const handleScrollA = makeSyncHandler(panelA, panelB, 'oldToNew');
    const handleScrollB = makeSyncHandler(panelB, panelA, 'newToOld');

    panelA.addEventListener('scroll', handleScrollA, { passive: true });
    panelB.addEventListener('scroll', handleScrollB, { passive: true });

    return () => {
      panelA.removeEventListener('scroll', handleScrollA);
      panelB.removeEventListener('scroll', handleScrollB);
      isProgrammaticScrollRef.current = false;
    };
  }, [panelARef, panelBRef, enabled, offsetTable]);
}
