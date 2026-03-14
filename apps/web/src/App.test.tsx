import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './App';

// --- Mock IntersectionObserver for integration tests ---

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let mockIOCallback: IntersectionCallback;
let mockIOObserve: ReturnType<typeof vi.fn>;
let mockIODisconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockIOObserve = vi.fn();
  mockIODisconnect = vi.fn();

  class MockIntersectionObserver {
    constructor(callback: IntersectionCallback) {
      mockIOCallback = callback;
    }
    observe = mockIOObserve;
    unobserve = vi.fn();
    disconnect = mockIODisconnect;
    root = null;
    rootMargin = '';
    thresholds = [] as number[];
    takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  // Mock scrollIntoView since jsdom doesn't implement it
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the title in a header', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('Edgar-Differ')).toBeInTheDocument();
  });

  it('renders a search input', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/company name, ticker, or cik/i)).toBeInTheDocument();
  });

  it('renders section navigation sidebar', () => {
    render(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders both filing panels with correct headings', () => {
    render(<App />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });

  it('renders filing selector placeholders', () => {
    render(<App />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    selects.forEach(select => expect(select).toBeDisabled());
  });

  it('renders components in correct DOM order: header > search > main', () => {
    const { container } = render(<App />);
    const header = container.querySelector('header');
    const search = container.querySelector('[role="search"]');
    const main = container.querySelector('main');

    expect(header).not.toBeNull();
    expect(search).not.toBeNull();
    expect(main).not.toBeNull();

    if (header && search) {
      expect(
        header.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    if (search && main) {
      expect(
        search.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it('renders three columns in the content area', () => {
    render(<App />);
    const nav = screen.getByRole('navigation');
    const filingA = screen.getByText('Filing A');
    const filingB = screen.getByText('Filing B');

    expect(nav).toBeInTheDocument();
    expect(filingA).toBeInTheDocument();
    expect(filingB).toBeInTheDocument();

    if (nav && filingA) {
      expect(
        nav.compareDocumentPosition(filingA) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    if (filingA && filingB) {
      expect(
        filingA.compareDocumentPosition(filingB) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  // --- US-2.3: Integration tests ---

  it('Filing A renders filing content from fixture (not placeholder)', () => {
    const { container } = render(<App />);
    // The real AAPL 10-K fixture should produce section containers
    expect(container.querySelector('#item-1')).not.toBeNull();
    expect(container.querySelector('#item-1a')).not.toBeNull();
    expect(container.querySelector('#item-2')).not.toBeNull();
    // FilingContent root should be present (not placeholder)
    expect(container.querySelector('.filing-content-root')).not.toBeNull();
  });

  it('Filing B renders filing content from fixture (not placeholder)', () => {
    const { container } = render(<App />);
    // Both panels now render content — Filing B has the same fixture with side="new"
    const contentRoots = container.querySelectorAll('.filing-content-root');
    expect(contentRoots.length).toBe(2);
    // No placeholder text
    expect(screen.queryByText(/filing content will appear here/i)).toBeNull();
  });

  it('Filing A renders preamble content before sections', () => {
    const { container } = render(<App />);
    expect(container.querySelector('#preamble')).not.toBeNull();
    // Preamble should appear before the first section in DOM order
    const preamble = container.querySelector('#preamble');
    const firstSection = container.querySelector('#item-1');
    if (preamble && firstSection) {
      expect(
        preamble.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('section navigation sidebar is still present alongside filing panels', () => {
    render(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

describe('Accessibility', () => {
  it('uses semantic <header> for the app header', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('uses semantic <nav> for section navigation', () => {
    render(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('uses <main> for the primary content area', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('search input has accessible label or placeholder', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeInTheDocument();
    expect(
      input.getAttribute('aria-label') ?? input.closest('[role="search"]')
    ).toBeTruthy();
  });

  it('filing panels have heading hierarchy', () => {
    render(<App />);
    const headings = screen.getAllByRole('heading');
    const filingHeadings = headings.filter(
      h => h.textContent === 'Filing A' || h.textContent === 'Filing B'
    );
    expect(filingHeadings).toHaveLength(2);
  });
});

// --- US-2.4: Integration Tests ---

describe('US-2.4: Section Navigation Integration', () => {
  // APP-I1: SectionNav receives section headings derived from sampleDiffs
  it('SectionNav buttons match section headings from sampleDiffs', () => {
    const { container } = render(<App />);
    // The nav should contain buttons for each section in the diff data
    const nav = screen.getByRole('navigation');
    const buttons = nav.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);

    // Count unique section IDs (sections appear in both panels)
    const sectionElements = container.querySelectorAll('section[id]');
    const uniqueIds = new Set(
      Array.from(sectionElements).map((el) => el.id).filter((id) => id !== 'preamble'),
    );
    // The nav should have one button per unique section
    expect(buttons.length).toBe(uniqueIds.size);
  });

  // APP-I2: SectionNav is rendered inside the <main> element
  it('SectionNav is rendered inside the <main> element', () => {
    render(<App />);
    const main = screen.getByRole('main');
    const nav = screen.getByRole('navigation');
    expect(main.contains(nav)).toBe(true);
  });

  // APP-I3: Clicking a section button calls scrollIntoView on the matching section in Filing A
  it('clicking a section button calls scrollIntoView on the section in Filing A panel', () => {
    const { container } = render(<App />);
    // Get the first nav button
    const nav = screen.getByRole('navigation');
    const firstButton = nav.querySelector('button')!;
    expect(firstButton).not.toBeNull();

    fireEvent.click(firstButton);

    // scrollIntoView should have been called on section elements
    // Find all section elements with matching id across both panels
    const sectionId = container.querySelector('section[id]:not(#preamble)')?.id;
    if (sectionId) {
      const matchingSections = container.querySelectorAll(`#${CSS.escape(sectionId)}`);
      // At least one should have had scrollIntoView called
      const scrollCalls = Array.from(matchingSections).filter(
        (el) => (el.scrollIntoView as ReturnType<typeof vi.fn>).mock?.calls.length > 0,
      );
      expect(scrollCalls.length).toBeGreaterThan(0);
    }
  });

  // APP-I4: Clicking a section button calls scrollIntoView on both panels
  it('clicking a section button calls scrollIntoView on sections in both panels', () => {
    const { container } = render(<App />);
    const nav = screen.getByRole('navigation');
    const firstButton = nav.querySelector('button')!;

    fireEvent.click(firstButton);

    // The section id appears in both panels (Filing A and Filing B render same document)
    const sectionId = container.querySelector('section[id]:not(#preamble)')?.id;
    if (sectionId) {
      const matchingSections = container.querySelectorAll(`#${CSS.escape(sectionId)}`);
      // Both panels should have the section, both should have been scrolled
      expect(matchingSections.length).toBe(2);
      for (const section of matchingSections) {
        expect(section.scrollIntoView).toHaveBeenCalled();
      }
    }
  });

  // APP-I5: If target section doesn't exist in DOM, no error
  it('clicking a section does not throw if target element is missing', () => {
    render(<App />);
    const nav = screen.getByRole('navigation');
    const buttons = nav.querySelectorAll('button');
    // Click all buttons — none should throw
    expect(() => {
      for (const button of buttons) {
        fireEvent.click(button);
      }
    }).not.toThrow();
  });

  // APP-I6: scrollIntoView called with smooth scroll options
  it('scrollIntoView is called with { behavior: "smooth", block: "start" }', () => {
    const { container } = render(<App />);
    const nav = screen.getByRole('navigation');
    const firstButton = nav.querySelector('button')!;

    fireEvent.click(firstButton);

    const sectionId = container.querySelector('section[id]:not(#preamble)')?.id;
    if (sectionId) {
      const section = container.querySelector(`#${CSS.escape(sectionId)}`)!;
      expect(section.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });
    }
  });

  // APP-I7: Initial render has no active section
  it('initial render has no active section (no button with aria-current)', () => {
    render(<App />);
    const nav = screen.getByRole('navigation');
    const activeButtons = nav.querySelectorAll('[aria-current="true"]');
    expect(activeButtons.length).toBe(0);
  });

  // APP-I8: When mock IntersectionObserver fires, the corresponding nav button becomes active
  it('when observer fires with a section entry, the nav button becomes active', () => {
    const { container } = render(<App />);

    // Get the first section element in the scroll container
    const firstSection = container.querySelector('section[id]:not(#preamble)');
    expect(firstSection).not.toBeNull();

    // Simulate observer firing with this section visible
    act(() => {
      mockIOCallback([
        {
          target: firstSection!,
          intersectionRatio: 0.8,
        } as unknown as IntersectionObserverEntry,
      ]);
    });

    // The corresponding nav button should now be active
    const nav = screen.getByRole('navigation');
    const activeButtons = nav.querySelectorAll('[aria-current="true"]');
    expect(activeButtons.length).toBe(1);
  });

  // APP-I9: When observer fires with all ratios 0, no nav button is active
  it('when observer fires with all ratios 0, no nav button is active', () => {
    const { container } = render(<App />);

    const firstSection = container.querySelector('section[id]:not(#preamble)');
    expect(firstSection).not.toBeNull();

    // First make a section active
    act(() => {
      mockIOCallback([
        {
          target: firstSection!,
          intersectionRatio: 0.5,
        } as unknown as IntersectionObserverEntry,
      ]);
    });

    const nav = screen.getByRole('navigation');
    expect(nav.querySelectorAll('[aria-current="true"]').length).toBe(1);

    // Now all ratios go to 0
    act(() => {
      mockIOCallback([
        {
          target: firstSection!,
          intersectionRatio: 0,
        } as unknown as IntersectionObserverEntry,
      ]);
    });

    expect(nav.querySelectorAll('[aria-current="true"]').length).toBe(0);
  });
});
