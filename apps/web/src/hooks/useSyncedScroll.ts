import { useEffect, useRef, type RefObject } from 'react';

/** Settling window for scroll guard reset (ms). Exported for test use. */
export const SCROLL_SETTLE_MS = 150;

function createSectionObserver(
  container: HTMLDivElement,
  onActiveSectionChange: (sectionId: string) => void,
): IntersectionObserver {
  const ratioMap = new Map<string, number>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        ratioMap.set(entry.target.id, entry.intersectionRatio);
      }
      let bestId = '';
      let bestRatio = 0;
      for (const [id, ratio] of ratioMap) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (bestId && bestRatio > 0) {
        onActiveSectionChange(bestId);
      }
    },
    { root: container, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] },
  );

  return observer;
}

function observeSections(container: HTMLDivElement, observer: IntersectionObserver): void {
  const sections = container.querySelectorAll<HTMLElement>('section[id]');
  for (const section of sections) {
    observer.observe(section);
  }
}

/**
 * Synchronize scroll position between two panels based on section alignment.
 * When enabled, scrolling one panel scrolls the other to the matching section.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  const scrollSourceRef = useRef<'none' | 'panelA' | 'panelB'>('none');
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSyncedSectionRef = useRef<string>('');

  useEffect(() => {
    const panelA = panelARef.current;
    const panelB = panelBRef.current;
    if (!panelA || !panelB || !enabled) return;

    let activeSectionA = '';
    let activeSectionB = '';

    const observerA = createSectionObserver(panelA, (id) => {
      activeSectionA = id;
    });
    const observerB = createSectionObserver(panelB, (id) => {
      activeSectionB = id;
    });

    observeSections(panelA, observerA);
    observeSections(panelB, observerB);

    let rafIdA = 0;
    let rafIdB = 0;

    const makeScrollHandler = (
      sourcePanel: 'panelA' | 'panelB',
      getActiveSection: () => string,
      targetContainer: HTMLDivElement,
      getRafId: () => number,
      setRafId: (id: number) => void,
    ) => {
      return () => {
        cancelAnimationFrame(getRafId());
        setRafId(requestAnimationFrame(() => {
          if (scrollSourceRef.current !== 'none' && scrollSourceRef.current !== sourcePanel) {
            return;
          }

          const activeId = getActiveSection();
          if (!activeId || activeId === lastSyncedSectionRef.current) return;

          const target = targetContainer.querySelector(`#${CSS.escape(activeId)}`);
          if (!target) return;

          scrollSourceRef.current = sourcePanel;
          lastSyncedSectionRef.current = activeId;
          target.scrollIntoView({ behavior: 'instant', block: 'start' });

          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = setTimeout(() => {
            scrollSourceRef.current = 'none';
          }, SCROLL_SETTLE_MS);
        }));
      };
    };

    const handleScrollA = makeScrollHandler(
      'panelA', () => activeSectionA, panelB,
      () => rafIdA, (id) => { rafIdA = id; },
    );
    const handleScrollB = makeScrollHandler(
      'panelB', () => activeSectionB, panelA,
      () => rafIdB, (id) => { rafIdB = id; },
    );

    panelA.addEventListener('scroll', handleScrollA, { passive: true });
    panelB.addEventListener('scroll', handleScrollB, { passive: true });

    // MutationObserver for dynamically loaded sections
    const mutationObserver = new MutationObserver(() => {
      observerA.disconnect();
      observerB.disconnect();
      observeSections(panelA, observerA);
      observeSections(panelB, observerB);
    });
    mutationObserver.observe(panelA, { childList: true, subtree: true });
    mutationObserver.observe(panelB, { childList: true, subtree: true });

    return () => {
      panelA.removeEventListener('scroll', handleScrollA);
      panelB.removeEventListener('scroll', handleScrollB);
      cancelAnimationFrame(rafIdA);
      cancelAnimationFrame(rafIdB);
      observerA.disconnect();
      observerB.disconnect();
      mutationObserver.disconnect();
      clearTimeout(scrollTimeoutRef.current);
      scrollSourceRef.current = 'none';
      lastSyncedSectionRef.current = '';
    };
  }, [panelARef, panelBRef, enabled]);
}
