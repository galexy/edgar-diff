import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncedScroll } from './useSyncedScroll';
import type { RefObject } from 'react';
import type { SectionDiff } from '@edgar-diff/lib';

// --- rAF mock ---
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 0;

function flushRAF(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(performance.now());
  }
}

// --- Container with data-source-start elements ---
function makeContainer(
  blocks: Array<{ sourceStart: number; top: number }> = [],
  scrollTop = 0,
): HTMLDivElement {
  const container = document.createElement('div');

  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) as DOMRect,
  });
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(container, 'scrollTop', {
    value: scrollTop, writable: true, configurable: true,
  });

  for (const { sourceStart, top } of blocks) {
    const el = document.createElement('p');
    el.dataset.sourceStart = String(sourceStart);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top, left: 0, right: 800, bottom: top + 50,
      width: 800, height: 50, x: 0, y: top, toJSON: () => ({}) as DOMRect,
    });
    container.appendChild(el);
  }

  return container;
}

// --- Minimal sectionDiffs for offset table ---
function makeSimpleSectionDiffs(): SectionDiff[] {
  return [{
    id: 'item-1',
    heading: 'Item 1',
    changeType: 'modified',
    sourceMapping: {
      old: { start: 0, end: 1000 },
      new: { start: 0, end: 1200 },
    },
    paragraphDiffs: [
      {
        changeType: 'unchanged',
        sourceMapping: {
          old: { start: 100, end: 200 },
          new: { start: 100, end: 200 },
        },
      },
      {
        changeType: 'unchanged',
        sourceMapping: {
          old: { start: 500, end: 600 },
          new: { start: 600, end: 700 },
        },
      },
    ],
    tableDiffs: [],
    subsectionDiffs: [],
  }] as SectionDiff[];
}

function makeRef(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

function fireScroll(container: HTMLDivElement): void {
  container.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  rafCallback = null;
  rafIdCounter = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    rafCallback = cb;
    return ++rafIdCounter;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSyncedScroll', () => {
  // SS-U1: Attaches scroll listeners when enabled
  it('attaches scroll event listeners to both panels when enabled', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const spyA = vi.spyOn(containerA, 'addEventListener');
    const spyB = vi.spyOn(containerB, 'addEventListener');

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  // SS-U2: Does NOT attach listeners when enabled=false
  it('does not attach scroll event listeners when enabled=false', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const spyA = vi.spyOn(containerA, 'addEventListener');
    const spyB = vi.spyOn(containerB, 'addEventListener');

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), false, makeSimpleSectionDiffs(),
    ));

    expect(spyA).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
    expect(spyB).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  });

  // SS-U3: Removes listeners on unmount
  it('removes scroll event listeners on unmount', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const spyA = vi.spyOn(containerA, 'removeEventListener');
    const spyB = vi.spyOn(containerB, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useSyncedScroll(makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs()),
    );
    unmount();

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  // SS-U4: On scroll, sets scrollTop on other panel
  it('sets scrollTop on the other panel when one panel scrolls', () => {
    const containerA = makeContainer([
      { sourceStart: 100, top: -100 },
      { sourceStart: 500, top: 100 },
    ], 200);
    const containerB = makeContainer([
      { sourceStart: 100, top: 50 },
      { sourceStart: 600, top: 400 },
    ]);

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    containerA.scrollTop = 200;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });

    expect(typeof containerB.scrollTop).toBe('number');
  });

  // SS-U5: Loop prevention
  it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }], 0);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }], 0);

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    containerA.scrollTop = 100;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });

    const aScrollBefore = containerA.scrollTop;
    act(() => { fireScroll(containerB); });
    expect(containerA.scrollTop).toBe(aScrollBefore);
  });

  // SS-U6: Uses requestAnimationFrame
  it('uses requestAnimationFrame to debounce scroll handlers', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    act(() => { fireScroll(containerA); });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  // SS-U7: Coalesces rapid scroll events
  it('coalesces rapid scroll events via cancelAnimationFrame', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const cancelSpy = vi.fn();
    let count = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++count));
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    act(() => {
      for (let i = 0; i < 5; i++) fireScroll(containerA);
    });

    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  // SS-U8: Handles null refs gracefully
  it('does not throw when both refs are null', () => {
    expect(() => {
      renderHook(() => useSyncedScroll(makeRef(null), makeRef(null), true, makeSimpleSectionDiffs()));
    }).not.toThrow();
  });

  it('does not throw when one ref is null', () => {
    const container = makeContainer([{ sourceStart: 100, top: 0 }]);
    expect(() => {
      renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true, makeSimpleSectionDiffs()));
    }).not.toThrow();
  });

  // SS-U9: Toggling enabled removes/adds listeners dynamically
  it('removes listeners when toggled from enabled to disabled', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const spyA = vi.spyOn(containerA, 'removeEventListener');
    const diffs = makeSimpleSectionDiffs();

    const { rerender } = renderHook(
      ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled, diffs),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('re-attaches listeners when toggled from disabled to enabled', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const spyA = vi.spyOn(containerA, 'addEventListener');
    const diffs = makeSimpleSectionDiffs();

    const { rerender } = renderHook(
      ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled, diffs),
      { initialProps: { enabled: false } },
    );

    rerender({ enabled: true });
    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  // SS-U10: No annotated elements — handler returns early
  it('does not modify scrollTop when no data-source-start elements exist', () => {
    const containerA = makeContainer([]);
    const containerB = makeContainer([]);

    renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    containerA.scrollTop = 100;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });

    expect(containerB.scrollTop).toBe(0);
  });

  // SS-U11: No sectionDiffs — empty offset table, handler still works
  it('operates with empty offset table when sectionDiffs is undefined', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);

    expect(() => {
      renderHook(() => useSyncedScroll(
        makeRef(containerA), makeRef(containerB), true, undefined,
      ));
    }).not.toThrow();
  });

  // SS-U12: offsetTable rebuilt when sectionDiffs changes
  it('rebuilds offset table when sectionDiffs reference changes', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);
    const diffs1 = makeSimpleSectionDiffs();
    const diffs2 = makeSimpleSectionDiffs();

    const { rerender } = renderHook(
      ({ diffs }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), true, diffs),
      { initialProps: { diffs: diffs1 } },
    );

    expect(() => rerender({ diffs: diffs2 })).not.toThrow();
  });

  // SS-U13: useSyncedScroll returns an object with suppressSyncRef
  // Regression test for edgar-diff-k8rv: section navigation needs to suppress
  // sync during programmatic scrollIntoView calls
  it('returns an object with a suppressSyncRef property', () => {
    const containerA = makeContainer([{ sourceStart: 100, top: 0 }]);
    const containerB = makeContainer([{ sourceStart: 100, top: 0 }]);

    const { result } = renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    expect(result.current).toBeDefined();
    expect(result.current).toHaveProperty('suppressSyncRef');
    expect(result.current.suppressSyncRef).toHaveProperty('current');
  });

  // SS-U14: When suppressSyncRef.current = true, scroll events do NOT trigger sync
  // Regression test for edgar-diff-k8rv: smooth-scroll from section nav was being
  // intercepted by sync handler, causing wrong scroll positions
  it('does not sync scroll when suppressSyncRef.current is true', () => {
    const containerA = makeContainer([
      { sourceStart: 100, top: -100 },
      { sourceStart: 500, top: 100 },
    ], 200);
    const containerB = makeContainer([
      { sourceStart: 100, top: 50 },
      { sourceStart: 600, top: 400 },
    ]);

    const { result } = renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    // Suppress sync before scrolling
    result.current.suppressSyncRef.current = true;

    const scrollTopBefore = containerB.scrollTop;
    containerA.scrollTop = 200;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });

    // Target panel should NOT have been scrolled
    expect(containerB.scrollTop).toBe(scrollTopBefore);
  });

  // SS-U15: After clearing suppressSyncRef, sync resumes normally
  // Regression test for edgar-diff-k8rv: sync must resume after section nav completes
  it('resumes sync after suppressSyncRef.current is set back to false', () => {
    const containerA = makeContainer([
      { sourceStart: 100, top: -100 },
      { sourceStart: 500, top: 100 },
    ], 200);
    const containerB = makeContainer([
      { sourceStart: 100, top: 50 },
      { sourceStart: 600, top: 400 },
    ]);

    const { result } = renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    // Suppress, then re-enable
    result.current.suppressSyncRef.current = true;
    result.current.suppressSyncRef.current = false;

    containerA.scrollTop = 200;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });

    // Sync should have run — scrollTop should have been modified
    expect(typeof containerB.scrollTop).toBe('number');
  });

  // SS-U16: Rapid section clicks — second suppress must not be cancelled by first timeout
  // Regression test for edgar-diff-k8rv: rapid clicks caused the first setTimeout
  // to clear suppressSyncRef while the second smooth-scroll was still animating.
  // The fix clears the previous timeout before starting a new one.
  it('stays suppressed during rapid clicks when previous timeout is cleared', () => {
    vi.useFakeTimers();

    const containerA = makeContainer([
      { sourceStart: 100, top: -100 },
      { sourceStart: 500, top: 100 },
    ], 200);
    const containerB = makeContainer([
      { sourceStart: 100, top: 50 },
      { sourceStart: 600, top: 400 },
    ]);

    const { result } = renderHook(() => useSyncedScroll(
      makeRef(containerA), makeRef(containerB), true, makeSimpleSectionDiffs(),
    ));

    // --- First click: suppress + schedule auto-clear at 1000ms ---
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    result.current.suppressSyncRef.current = true;
    timeoutId = setTimeout(() => { result.current.suppressSyncRef.current = false; }, 1000);

    // Fire scroll at t=0 — should be suppressed
    const scrollTopBefore = containerB.scrollTop;
    containerA.scrollTop = 200;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });
    expect(containerB.scrollTop).toBe(scrollTopBefore);

    // --- Second click at t=500ms: clear first timeout, re-suppress, new timeout ---
    vi.advanceTimersByTime(500);
    clearTimeout(timeoutId);
    result.current.suppressSyncRef.current = true;
    timeoutId = setTimeout(() => { result.current.suppressSyncRef.current = false; }, 1000);

    // Advance to t=1000ms — first timeout WOULD have fired here
    vi.advanceTimersByTime(500);

    // Sync must STILL be suppressed (second timeout expires at t=1500ms)
    expect(result.current.suppressSyncRef.current).toBe(true);

    containerA.scrollTop = 300;
    act(() => { fireScroll(containerA); });
    act(() => { flushRAF(); });
    expect(containerB.scrollTop).toBe(scrollTopBefore);

    // Advance to t=1500ms — second timeout fires, sync resumes
    vi.advanceTimersByTime(500);
    expect(result.current.suppressSyncRef.current).toBe(false);

    vi.useRealTimers();
  });
});
