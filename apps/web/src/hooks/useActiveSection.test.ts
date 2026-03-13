import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useActiveSection } from './useActiveSection';
import type { RefObject } from 'react';

// --- Mock IntersectionObserver ---

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let mockCallback: IntersectionCallback;
let mockObservedElements: Element[];
let mockDisconnect: ReturnType<typeof vi.fn>;
let mockObserve: ReturnType<typeof vi.fn>;
let mockConstructorArgs: { callback: IntersectionCallback; options?: IntersectionObserverInit }[];

function makeEntry(
  target: Element,
  intersectionRatio: number,
): Partial<IntersectionObserverEntry> {
  return { target, intersectionRatio };
}

beforeEach(() => {
  mockObservedElements = [];
  mockDisconnect = vi.fn();
  mockObserve = vi.fn((el: Element) => mockObservedElements.push(el));
  mockConstructorArgs = [];

  class MockIntersectionObserver {
    constructor(callback: IntersectionCallback, options?: IntersectionObserverInit) {
      mockCallback = callback;
      mockConstructorArgs.push({ callback, options });
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helper: create a container with <section> elements ---

function makeContainer(...sectionIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  for (const id of sectionIds) {
    const section = document.createElement('section');
    section.id = id;
    container.appendChild(section);
  }
  return container;
}

function makeRef(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

// --- Tests ---

describe('useActiveSection', () => {
  // UAS-U1: Returns undefined when container ref is null
  it('returns undefined when container ref is null (not mounted)', () => {
    const ref = makeRef(null);
    const { result } = renderHook(() => useActiveSection(ref));
    expect(result.current).toBeUndefined();
  });

  // UAS-U2: Returns undefined when container has no <section> elements
  it('returns undefined when container has no <section> elements', () => {
    const container = document.createElement('div');
    const ref = makeRef(container);
    const { result } = renderHook(() => useActiveSection(ref));
    expect(result.current).toBeUndefined();
  });

  // UAS-U3: Calls IntersectionObserver with correct root and thresholds
  it('calls IntersectionObserver constructor with root: container and correct thresholds', () => {
    const container = makeContainer('s1', 's2');
    const ref = makeRef(container);
    renderHook(() => useActiveSection(ref));

    expect(mockConstructorArgs).toHaveLength(1);
    expect(mockConstructorArgs[0].options).toEqual(
      expect.objectContaining({
        root: container,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      }),
    );
  });

  // UAS-U4: Observes all <section id> elements in the container
  it('observes all <section id> elements in the container', () => {
    const container = makeContainer('s1', 's2', 's3');
    const ref = makeRef(container);
    renderHook(() => useActiveSection(ref));

    expect(mockObserve).toHaveBeenCalledTimes(3);
    const observedIds = mockObservedElements.map((el) => el.id);
    expect(observedIds).toEqual(['s1', 's2', 's3']);
  });

  // UAS-U5: Returns the id of the section with the highest intersectionRatio
  it('returns the id of the section with the highest intersectionRatio', () => {
    const container = makeContainer('s1', 's2', 's3');
    const ref = makeRef(container);
    const { result } = renderHook(() => useActiveSection(ref));

    const sections = container.querySelectorAll('section');
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0.1) as IntersectionObserverEntry,
        makeEntry(sections[1], 0.75) as IntersectionObserverEntry,
        makeEntry(sections[2], 0.3) as IntersectionObserverEntry,
      ]);
    });

    expect(result.current).toBe('s2');
  });

  // UAS-U6: When multiple sections have equal ratios, returns first in DOM order
  it('when multiple sections have equal ratios, returns the first in DOM order', () => {
    const container = makeContainer('s1', 's2', 's3');
    const ref = makeRef(container);
    const { result } = renderHook(() => useActiveSection(ref));

    const sections = container.querySelectorAll('section');
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0.5) as IntersectionObserverEntry,
        makeEntry(sections[1], 0.5) as IntersectionObserverEntry,
        makeEntry(sections[2], 0.5) as IntersectionObserverEntry,
      ]);
    });

    expect(result.current).toBe('s1');
  });

  // UAS-U7: When a new entry has higher ratio than current active, active updates
  it('updates active when a new entry has a higher ratio', () => {
    const container = makeContainer('s1', 's2');
    const ref = makeRef(container);
    const { result } = renderHook(() => useActiveSection(ref));

    const sections = container.querySelectorAll('section');

    // First: s1 is most visible
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0.8) as IntersectionObserverEntry,
        makeEntry(sections[1], 0.2) as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBe('s1');

    // Then: s2 becomes most visible
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0.1) as IntersectionObserverEntry,
        makeEntry(sections[1], 0.9) as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBe('s2');
  });

  // UAS-U8: When all sections have ratio 0, returns undefined
  it('returns undefined when all sections have ratio 0 (deselects all)', () => {
    const container = makeContainer('s1', 's2');
    const ref = makeRef(container);
    const { result } = renderHook(() => useActiveSection(ref));

    const sections = container.querySelectorAll('section');

    // First set an active section
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0.5) as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBe('s1');

    // Then all ratios go to 0
    act(() => {
      mockCallback([
        makeEntry(sections[0], 0) as IntersectionObserverEntry,
        makeEntry(sections[1], 0) as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBeUndefined();
  });

  // UAS-U9: Calls observer.disconnect() on cleanup (unmount)
  it('calls observer.disconnect() on cleanup', () => {
    const container = makeContainer('s1');
    const ref = makeRef(container);
    const { unmount } = renderHook(() => useActiveSection(ref));

    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  // UAS-U10: Does not create observer when container has no sections
  it('does not create observer when container has no sections', () => {
    const container = document.createElement('div');
    container.appendChild(document.createElement('p')); // non-section content
    const ref = makeRef(container);
    renderHook(() => useActiveSection(ref));

    expect(mockConstructorArgs).toHaveLength(0);
  });
});
