import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncedScroll, SCROLL_SETTLE_MS } from './useSyncedScroll';
import type { RefObject } from 'react';

// --- Mock IntersectionObserver ---

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let mockCallbacks: IntersectionCallback[];
let mockObservedElements: Element[];
let mockDisconnect: ReturnType<typeof vi.fn>;
let mockObserve: ReturnType<typeof vi.fn>;

function makeEntry(
  target: Element,
  intersectionRatio: number,
): Partial<IntersectionObserverEntry> {
  return { target, intersectionRatio };
}

// --- rAF helpers ---
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 0;

function flushRAF(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(performance.now());
  }
}

// --- Mock MutationObserver ---
let mockMutationDisconnect: ReturnType<typeof vi.fn>;
let mockMutationObserve: ReturnType<typeof vi.fn>;
let mockMutationCallbacks: MutationCallback[];

class MockMutationObserver {
  callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
    mockMutationCallbacks.push(callback);
  }
  observe = (mockMutationObserve = vi.fn());
  disconnect = (mockMutationDisconnect = vi.fn());
  takeRecords = vi.fn(() => [] as MutationRecord[]);
}

beforeEach(() => {
  mockCallbacks = [];
  mockObservedElements = [];
  mockDisconnect = vi.fn();
  mockObserve = vi.fn((el: Element) => mockObservedElements.push(el));
  mockMutationCallbacks = [];

  class MockIntersectionObserver {
    constructor(callback: IntersectionCallback, _options?: IntersectionObserverInit) {
      mockCallbacks.push(callback);
    }
    observe = mockObserve;
    unobserve = vi.fn();
    disconnect = mockDisconnect;
    root = null;
    rootMargin = '';
    thresholds = [] as number[];
    takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  // Mock scrollIntoView — assign per-element in makeContainer instead of prototype

  // Mock requestAnimationFrame / cancelAnimationFrame
  rafCallback = null;
  rafIdCounter = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      rafCallback = cb;
      return ++rafIdCounter;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  // Mock MutationObserver
  vi.stubGlobal('MutationObserver', MockMutationObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- Container helpers ---

function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    section.scrollIntoView = vi.fn();
    container.appendChild(section);
  }
  return container;
}

function makeRef(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

function fireScroll(container: HTMLDivElement): void {
  container.dispatchEvent(new Event('scroll'));
}

// --- Tests ---

describe('useSyncedScroll', () => {
  // SS-U8: Handles null/empty refs
  it('does not throw when both refs are null (early return)', () => {
    expect(() => {
      renderHook(() => useSyncedScroll(makeRef(null), makeRef(null), true));
    }).not.toThrow();
    expect(mockCallbacks).toHaveLength(0);
  });

  it('does not throw when one ref is null (early return)', () => {
    const container = makeContainer('s1');
    expect(() => {
      renderHook(() => useSyncedScroll(makeRef(container), makeRef(null), true));
    }).not.toThrow();
    expect(mockCallbacks).toHaveLength(0);
  });

  // SS-U1: Attaches scroll listeners when enabled
  it('attaches scroll event listeners to both panels when enabled', () => {
    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');
    const spyA = vi.spyOn(containerA, 'addEventListener');
    const spyB = vi.spyOn(containerB, 'addEventListener');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  // SS-U2: Does NOT attach listeners when enabled=false
  it('does not attach scroll event listeners when enabled=false', () => {
    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');
    const spyA = vi.spyOn(containerA, 'addEventListener');
    const spyB = vi.spyOn(containerB, 'addEventListener');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), false));

    expect(spyA).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
    expect(spyB).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  });

  // SS-U3: Removes listeners on unmount
  it('removes scroll event listeners on unmount', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');
    const spyA = vi.spyOn(containerA, 'removeEventListener');
    const spyB = vi.spyOn(containerB, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useSyncedScroll(makeRef(containerA), makeRef(containerB), true),
    );
    unmount();

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(spyB).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  // SS-U4: On scroll, finds most-visible section and calls scrollIntoView on other panel
  it('calls scrollIntoView on matching section in other panel on scroll', () => {
    const containerA = makeContainer('s1', 's2', 's3');
    const containerB = makeContainer('s1', 's2', 's3');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    expect(mockCallbacks).toHaveLength(2);

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([
        makeEntry(sectionsA[0], 0.1) as IntersectionObserverEntry,
        makeEntry(sectionsA[1], 0.8) as IntersectionObserverEntry,
        makeEntry(sectionsA[2], 0.1) as IntersectionObserverEntry,
      ]);
    });

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });

    const targetSection = containerB.querySelector('#s2');
    expect(targetSection?.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'instant', block: 'start' }),
    );
  });

  // SS-U5: Prevents scroll loop via scrollSourceRef 3-state guard
  it('does not trigger reciprocal scroll when syncing (prevents infinite loop)', () => {
    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
    });

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });

    const targetB = containerB.querySelector('#s2');
    expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1);

    const sectionsB = containerB.querySelectorAll('section');
    act(() => {
      mockCallbacks[1]([makeEntry(sectionsB[0], 0.9) as IntersectionObserverEntry]);
    });

    act(() => {
      fireScroll(containerB);
    });
    act(() => {
      flushRAF();
    });

    const targetA = containerA.querySelector('#s1');
    expect(targetA?.scrollIntoView).not.toHaveBeenCalled();
  });

  // SS-U6: Debounces with requestAnimationFrame
  it('uses requestAnimationFrame for debouncing scroll handlers', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');
    const rafSpy = vi.fn((_cb: FrameRequestCallback) => 1);
    vi.stubGlobal('requestAnimationFrame', rafSpy);

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    act(() => {
      fireScroll(containerA);
    });

    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  // SS-U7: Gracefully handles section not found in other panel
  it('does not throw when active section has no match in other panel', () => {
    const containerA = makeContainer('s1', 's2', 's3');
    const containerB = makeContainer('s1', 's3');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
    });

    expect(() => {
      act(() => {
        fireScroll(containerA);
      });
      act(() => {
        flushRAF();
      });
    }).not.toThrow();

    const sectionsB = containerB.querySelectorAll('section');
    for (const section of sectionsB) {
      expect(section.scrollIntoView).not.toHaveBeenCalled();
    }
  });

  // SS-U9: Toggling enabled removes/adds listeners dynamically
  it('removes listeners and observers when toggled from enabled to disabled', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');
    const spyA = vi.spyOn(containerA, 'removeEventListener');

    const { rerender } = renderHook(
      ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('re-attaches listeners when toggled from disabled to enabled', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');
    const spyA = vi.spyOn(containerA, 'addEventListener');

    const { rerender } = renderHook(
      ({ enabled }) => useSyncedScroll(makeRef(containerA), makeRef(containerB), enabled),
      { initialProps: { enabled: false } },
    );

    rerender({ enabled: true });

    expect(spyA).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  // SS-U10: Handles rapid successive scroll events (coalesces via rAF)
  it('coalesces rapid scroll events via cancelAnimationFrame + requestAnimationFrame', () => {
    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');
    const cancelSpy = vi.fn();
    let localRafCount = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => ++localRafCount),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    act(() => {
      for (let i = 0; i < 5; i++) fireScroll(containerA);
    });

    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  // SS-U11: Does not sync when active section hasn't changed (lastSyncedSectionRef)
  it('does not call scrollIntoView when the active section is unchanged', () => {
    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([makeEntry(sectionsA[0], 0.9) as IntersectionObserverEntry]);
    });

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });
    const targetB = containerB.querySelector('#s1');
    expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });
    expect(targetB?.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // SS-U12: Full cleanup on unmount
  it('disconnects IntersectionObservers, MutationObserver, and clears timeout on unmount', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');

    const { unmount } = renderHook(() =>
      useSyncedScroll(makeRef(containerA), makeRef(containerB), true),
    );
    unmount();

    expect(mockDisconnect).toHaveBeenCalledTimes(2);
    expect(mockMutationDisconnect).toHaveBeenCalled();
  });

  // SS-U13: Settling timeout resets scrollSourceRef after SCROLL_SETTLE_MS
  it('resets scroll source flag after SCROLL_SETTLE_MS settling timeout', () => {
    vi.useFakeTimers();
    // Re-stub rAF after fake timers (fake timers override it)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return ++rafIdCounter;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const containerA = makeContainer('s1', 's2');
    const containerB = makeContainer('s1', 's2');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
    });

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });

    // Before timeout: panel B scroll should be suppressed
    const sectionsB = containerB.querySelectorAll('section');
    act(() => {
      mockCallbacks[1]([makeEntry(sectionsB[0], 0.9) as IntersectionObserverEntry]);
    });
    act(() => {
      fireScroll(containerB);
    });
    act(() => {
      flushRAF();
    });
    expect(containerA.querySelector('#s1')?.scrollIntoView).not.toHaveBeenCalled();

    // After SCROLL_SETTLE_MS: scrollSourceRef resets to 'none'
    act(() => {
      vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    });
    act(() => {
      fireScroll(containerB);
    });
    act(() => {
      flushRAF();
    });
    expect(containerA.querySelector('#s1')?.scrollIntoView).toHaveBeenCalled();
  });

  // SS-U14: MutationObserver re-registers sections when DOM changes
  it('MutationObserver observes both panels with correct options', () => {
    const containerA = makeContainer('s1');
    const containerB = makeContainer('s1');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    expect(mockMutationObserve).toHaveBeenCalledWith(
      containerA,
      expect.objectContaining({ childList: true, subtree: true }),
    );
    expect(mockMutationObserve).toHaveBeenCalledWith(
      containerB,
      expect.objectContaining({ childList: true, subtree: true }),
    );
  });

  // SS-U15: Uses CSS.escape for section ID lookup
  it('uses CSS.escape when looking up sections in the target panel', () => {
    const containerA = makeContainer('item-1a', 'item.2');
    const containerB = makeContainer('item-1a', 'item.2');
    const cssEscapeSpy = vi.spyOn(CSS, 'escape');

    renderHook(() => useSyncedScroll(makeRef(containerA), makeRef(containerB), true));

    const sectionsA = containerA.querySelectorAll('section');
    act(() => {
      mockCallbacks[0]([makeEntry(sectionsA[1], 0.9) as IntersectionObserverEntry]);
    });

    act(() => {
      fireScroll(containerA);
    });
    act(() => {
      flushRAF();
    });

    expect(cssEscapeSpy).toHaveBeenCalledWith('item.2');
  });
});
