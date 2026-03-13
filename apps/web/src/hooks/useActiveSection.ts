import { useEffect, useState, type RefObject } from 'react';

/**
 * Observe <section> elements within a scrollable container and return
 * the id of the section currently most visible in the viewport.
 */
export function useActiveSection(
  containerRef: RefObject<HTMLDivElement | null>,
): string | undefined {
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sections = container.querySelectorAll<HTMLElement>('section[id]');
    if (sections.length === 0) return;

    const ratioMap = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          ratioMap.set(id, entry.intersectionRatio);
        }

        let bestId: string | undefined;
        let bestRatio = 0;
        for (const [id, ratio] of ratioMap) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }

        if (bestRatio === 0) {
          setActiveSectionId(undefined);
        } else if (bestId) {
          setActiveSectionId(bestId);
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, [containerRef]);

  return activeSectionId;
}
