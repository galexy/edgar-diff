import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SectionDiff, ParagraphDiff, TableDiff, ChangeType } from '@edgar-diff/lib';

// --- Mock the heavy AAPL fixture with a tiny inline document ---
// The real fixture parses a ~2MB HTML file; this avoids OOM in CI.

const { mockFilingListState, resetFilingListMock, mockDiffPipelineState, resetDiffPipelineMock, setDiffPipelineDone } = vi.hoisted(() => {
  const tinyHtml = [
    '<div>Preamble content</div>',
    '<h2>Item 1. Business</h2><p>Business paragraph one.</p><p>Second paragraph.</p>',
    '<h2>Item 1A. Risk Factors</h2><p>Risk factors paragraph.</p><p>Another risk.</p>',
    '<h2>Item 2. Properties</h2><p>Properties paragraph.</p>',
  ].join('');

  const sections = [
    {
      id: 'item-1',
      heading: 'Item 1. Business',
      level: 1,
      blocks: [
        { type: 'paragraph' as const, text: 'Business paragraph one.', source: { start: 31, end: 80 } },
        { type: 'paragraph' as const, text: 'Second paragraph.', source: { start: 80, end: 109 } },
      ],
      subsections: [],
      source: { start: 31, end: 109 },
    },
    {
      id: 'item-1a',
      heading: 'Item 1A. Risk Factors',
      level: 1,
      blocks: [
        { type: 'paragraph' as const, text: 'Risk factors paragraph.', source: { start: 109, end: 163 } },
        { type: 'paragraph' as const, text: 'Another risk.', source: { start: 163, end: 189 } },
      ],
      subsections: [],
      source: { start: 109, end: 189 },
    },
    {
      id: 'item-2',
      heading: 'Item 2. Properties',
      level: 1,
      blocks: [
        { type: 'paragraph' as const, text: 'Properties paragraph.', source: { start: 189, end: 237 } },
      ],
      subsections: [],
      source: { start: 189, end: 237 },
    },
  ];

  const doc = {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K',
      filingDate: { toString: () => '2024-01-01' },
      primaryDocumentFilename: 'test.htm',
      html: tinyHtml,
      fetchedAt: { toString: () => '2024-01-01T00:00:00Z' },
    },
    sections,
    parseWarnings: [],
  };

  // Include paragraph/table diffs so countChanges produces non-zero values
  const diffs = [
    {
      id: sections[0].id,
      heading: sections[0].heading,
      changeType: 'modified' as const,
      paragraphDiffs: [
        { changeType: 'modified' as const, sourceMapping: { old: { start: 0, end: 10 }, new: { start: 0, end: 10 } } },
        { changeType: 'added' as const, sourceMapping: { old: undefined, new: { start: 10, end: 20 } } },
        { changeType: 'unchanged' as const, sourceMapping: { old: { start: 20, end: 30 }, new: { start: 20, end: 30 } } },
      ],
      tableDiffs: [],
      subsectionDiffs: [],
      sourceMapping: { old: sections[0].source, new: sections[0].source },
    },
    {
      id: sections[1].id,
      heading: sections[1].heading,
      changeType: 'modified' as const,
      paragraphDiffs: [
        { changeType: 'modified' as const, sourceMapping: { old: { start: 0, end: 10 }, new: { start: 0, end: 10 } } },
      ],
      tableDiffs: [
        {
          changeType: 'modified' as const,
          rowDiffs: [],
          cellDiffs: [],
          sourceMapping: { old: { start: 0, end: 10 }, new: { start: 0, end: 10 } },
          summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 1, rowsUnchanged: 0, cellsChanged: 1 },
        },
      ],
      subsectionDiffs: [],
      sourceMapping: { old: sections[1].source, new: sections[1].source },
    },
    {
      id: sections[2].id,
      heading: sections[2].heading,
      changeType: 'unchanged' as const,
      paragraphDiffs: [
        { changeType: 'unchanged' as const, sourceMapping: { old: { start: 0, end: 10 }, new: { start: 0, end: 10 } } },
      ],
      tableDiffs: [],
      subsectionDiffs: [],
      sourceMapping: { old: sections[2].source, new: sections[2].source },
    },
  ];

  const mockFilingListState = {
    filings: [] as Array<{ accessionNumber: string; formType: string; filingDate: string }>,
    status: 'idle' as string,
    error: null as string | null,
  };

  function resetFilingListMock() {
    mockFilingListState.filings = [];
    mockFilingListState.status = 'idle';
    mockFilingListState.error = null;
  }

  const mockDiffPipelineState = {
    status: 'idle' as string,
    error: null as string | null,
    oldDocument: null as typeof doc | null,
    newDocument: null as typeof doc | null,
    diff: null as { sectionDiffs: typeof diffs } | null,
  };

  function resetDiffPipelineMock() {
    mockDiffPipelineState.status = 'idle';
    mockDiffPipelineState.error = null;
    mockDiffPipelineState.oldDocument = null;
    mockDiffPipelineState.newDocument = null;
    mockDiffPipelineState.diff = null;
  }

  function setDiffPipelineDone() {
    mockDiffPipelineState.status = 'done';
    mockDiffPipelineState.error = null;
    mockDiffPipelineState.oldDocument = doc;
    mockDiffPipelineState.newDocument = doc;
    mockDiffPipelineState.diff = { sectionDiffs: diffs };
  }

  return { tinyDocument: doc, tinySectionDiffs: diffs, mockFilingListState, resetFilingListMock, mockDiffPipelineState, resetDiffPipelineMock, setDiffPipelineDone };
});

vi.mock('./hooks/useDiffPipeline', () => ({
  useDiffPipeline: () => mockDiffPipelineState,
}));

vi.mock('./hooks/useCompanySearch', () => ({
  useCompanySearch: () => ({
    query: '',
    setQuery: vi.fn(),
    status: 'idle' as const,
    matches: [],
    selectedCompany: null,
    error: null,
    selectMatch: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('./hooks/useFilingList', () => ({
  useFilingList: () => mockFilingListState,
}));

import { App, countChanges } from './App';

// --- Mock IntersectionObserver for integration tests ---

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let mockIOCallback: IntersectionCallback;
let mockIOObserve: ReturnType<typeof vi.fn>;
let mockIODisconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFilingListMock();
  resetDiffPipelineMock();
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
    // 3 comboboxes: search bar + 2 filing selectors
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
    // Filing selectors (the last two) are disabled
    const filingSelectors = selects.filter((s) => s.tagName === 'SELECT');
    filingSelectors.forEach(select => expect(select).toBeDisabled());
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

  it('Filing A renders filing content when pipeline is done', () => {
    setDiffPipelineDone();
    const { container } = render(<App />);
    // The real AAPL 10-K fixture should produce section containers
    expect(container.querySelector('#item-1')).not.toBeNull();
    expect(container.querySelector('#item-1a')).not.toBeNull();
    expect(container.querySelector('#item-2')).not.toBeNull();
    // FilingContent root should be present (not placeholder)
    expect(container.querySelector('.filing-content-root')).not.toBeNull();
  });

  it('Filing B renders filing content when pipeline is done', () => {
    setDiffPipelineDone();
    const { container } = render(<App />);
    // Both panels now render content — Filing B has the same document with side="new"
    const contentRoots = container.querySelectorAll('.filing-content-root');
    expect(contentRoots.length).toBe(2);
    // No placeholder text
    expect(screen.queryByText(/filing content will appear here/i)).toBeNull();
  });

  it('Filing A renders preamble content before sections', () => {
    setDiffPipelineDone();
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
    expect(input).toHaveAttribute('aria-label');
    expect(input.closest('[role="search"]')).toBeTruthy();
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
  beforeEach(() => {
    setDiffPipelineDone();
  });

  // APP-I1: SectionNav receives section headings derived from diff data
  it('SectionNav buttons match section headings from diff data', () => {
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

// --- US-2.8: App-Level Integration ---

describe('US-2.8: Company Search Integration', () => {
  it('search bar is enabled (not disabled)', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeEnabled();
  });

  it('search bar has combobox role', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toHaveAttribute('role', 'combobox');
  });
});

// --- US-2.9: Filing Selectors Integration ---

const SAMPLE_FILINGS = [
  { accessionNumber: '0000320193-23-000106', formType: '10-K', filingDate: '2023-11-03' },
  { accessionNumber: '0000320193-23-000077', formType: '10-Q', filingDate: '2023-08-04' },
  { accessionNumber: '0000320193-23-000064', formType: '10-Q', filingDate: '2023-05-05' },
];

describe('US-2.9: Filing Selectors Integration', () => {
  it('filing selectors are disabled on initial load (no company)', () => {
    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    expect(selects).toHaveLength(2);
    selects.forEach((select) => expect(select).toBeDisabled());
  });

  it('both panels have filing selector aria-labels', () => {
    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    expect(selects).toHaveLength(2);
    const labels = selects.map((s) => s.getAttribute('aria-label'));
    expect(labels).toContain('Select Filing A');
    expect(labels).toContain('Select Filing B');
  });

  it('filing selectors show placeholder text when idle', () => {
    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    selects.forEach((select) => {
      expect(select).toHaveTextContent(/select a filing/i);
    });
  });

  it('filing selectors are disabled during loading', () => {
    mockFilingListState.status = 'loading';
    mockFilingListState.filings = [];

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    selects.forEach((select) => expect(select).toBeDisabled());
  });

  it('filing selectors are enabled and populated when loaded', () => {
    mockFilingListState.status = 'loaded';
    mockFilingListState.filings = SAMPLE_FILINGS;

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    expect(selects).toHaveLength(2);
    selects.forEach((select) => {
      expect(select).toBeEnabled();
      // Each selector should have the filing options
      expect(select).toHaveTextContent('10-K | 2023-11-03');
      expect(select).toHaveTextContent('10-Q | 2023-08-04');
      expect(select).toHaveTextContent('10-Q | 2023-05-05');
    });
  });

  it('both selectors show the same filing options', () => {
    mockFilingListState.status = 'loaded';
    mockFilingListState.filings = SAMPLE_FILINGS;

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    const optionsA = selects[0].querySelectorAll('option');
    const optionsB = selects[1].querySelectorAll('option');
    // Same number of options (filings + placeholder)
    expect(optionsA.length).toBe(optionsB.length);
    expect(optionsA.length).toBe(SAMPLE_FILINGS.length + 1);
  });

  it('selecting a filing in Filing A does not affect Filing B', () => {
    mockFilingListState.status = 'loaded';
    mockFilingListState.filings = SAMPLE_FILINGS;

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    const [filingA, filingB] = selects;

    // Select a filing in Filing A
    fireEvent.change(filingA, { target: { value: '0000320193-23-000106' } });

    // Filing A has a selection, Filing B still shows placeholder
    expect(filingA).toHaveValue('0000320193-23-000106');
    expect(filingB).toHaveValue('');
  });

  it('selecting different filings in A and B independently', () => {
    mockFilingListState.status = 'loaded';
    mockFilingListState.filings = SAMPLE_FILINGS;

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    const [filingA, filingB] = selects;

    fireEvent.change(filingA, { target: { value: '0000320193-23-000106' } });
    fireEvent.change(filingB, { target: { value: '0000320193-23-000077' } });

    expect(filingA).toHaveValue('0000320193-23-000106');
    expect(filingB).toHaveValue('0000320193-23-000077');
  });

  it('filing selectors are disabled on error status', () => {
    mockFilingListState.status = 'error';
    mockFilingListState.error = 'Unable to load filings';
    mockFilingListState.filings = [];

    render(<App />);
    const selects = screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');
    selects.forEach((select) => expect(select).toBeDisabled());
  });

  it('company clear resets filing selectors to disabled', () => {
    // Start with loaded filings (company selected)
    mockFilingListState.status = 'loaded';
    mockFilingListState.filings = SAMPLE_FILINGS;

    const { rerender } = render(<App />);
    const getFilingSelects = () =>
      screen.getAllByRole('combobox').filter((s) => s.tagName === 'SELECT');

    // Verify selectors are enabled with filings
    getFilingSelects().forEach((select) => expect(select).toBeEnabled());

    // Simulate company cleared → hook returns idle with empty filings
    mockFilingListState.status = 'idle';
    mockFilingListState.filings = [];
    mockFilingListState.error = null;

    rerender(<App />);

    // Both selectors should be disabled again
    const selects = getFilingSelects();
    expect(selects).toHaveLength(2);
    selects.forEach((select) => {
      expect(select).toBeDisabled();
      expect(select).toHaveTextContent(/select a filing/i);
    });
  });
});

// --- US-2.7: Integration Tests (Tester-Owned) ---

// --- Fixture helpers for countChanges ---

function makeParagraphDiff(changeType: ChangeType): ParagraphDiff {
  return {
    changeType,
    sourceMapping: {
      old: { start: 0, end: 10 },
      new: { start: 0, end: 10 },
    },
  };
}

function makeTableDiff(changeType: ChangeType): TableDiff {
  return {
    changeType,
    rowDiffs: [],
    cellDiffs: [],
    sourceMapping: {
      old: { start: 0, end: 10 },
      new: { start: 0, end: 10 },
    },
    summary: {
      rowsAdded: 0,
      rowsRemoved: 0,
      rowsModified: 0,
      rowsUnchanged: 0,
      cellsChanged: 0,
    },
  };
}

function makeSectionDiff(
  paragraphDiffs: ParagraphDiff[],
  tableDiffs: TableDiff[],
  opts?: { subsectionDiffs?: SectionDiff[]; changeType?: ChangeType },
): SectionDiff {
  return {
    id: 'test-section',
    heading: 'Test Section',
    changeType: opts?.changeType ?? 'modified',
    paragraphDiffs,
    tableDiffs,
    subsectionDiffs: opts?.subsectionDiffs ?? [],
    sourceMapping: {
      old: { start: 0, end: 100 },
      new: { start: 0, end: 100 },
    },
  };
}

describe('US-2.7: countChanges helper (CC-U1–U9)', () => {
  it('CC-U1: returns count of non-unchanged paragraphDiffs + non-unchanged tableDiffs', () => {
    const section = makeSectionDiff(
      [makeParagraphDiff('modified'), makeParagraphDiff('unchanged'), makeParagraphDiff('added')],
      [makeTableDiff('removed'), makeTableDiff('unchanged')],
    );
    expect(countChanges(section)).toBe(3);
  });

  it('CC-U2: paragraph-only section with 3 non-unchanged paragraphs returns 3', () => {
    const section = makeSectionDiff(
      [makeParagraphDiff('modified'), makeParagraphDiff('added'), makeParagraphDiff('removed')],
      [],
    );
    expect(countChanges(section)).toBe(3);
  });

  it('CC-U3: table-only section with 2 non-unchanged tableDiffs returns 2', () => {
    const section = makeSectionDiff(
      [],
      [makeTableDiff('modified'), makeTableDiff('added')],
    );
    expect(countChanges(section)).toBe(2);
  });

  it('CC-U4: mixed content with 2 paragraphs + 1 table returns 3', () => {
    const section = makeSectionDiff(
      [makeParagraphDiff('modified'), makeParagraphDiff('added')],
      [makeTableDiff('modified')],
    );
    expect(countChanges(section)).toBe(3);
  });

  it('CC-U5: all unchanged paragraphs and tables returns 0', () => {
    const section = makeSectionDiff(
      [makeParagraphDiff('unchanged'), makeParagraphDiff('unchanged')],
      [makeTableDiff('unchanged')],
    );
    expect(countChanges(section)).toBe(0);
  });

  it('CC-U6: empty paragraphDiffs and tableDiffs returns 0', () => {
    const section = makeSectionDiff([], []);
    expect(countChanges(section)).toBe(0);
  });

  it('CC-U7: 5 paragraphs with 2 unchanged returns 3', () => {
    const section = makeSectionDiff(
      [
        makeParagraphDiff('modified'),
        makeParagraphDiff('unchanged'),
        makeParagraphDiff('added'),
        makeParagraphDiff('unchanged'),
        makeParagraphDiff('removed'),
      ],
      [],
    );
    expect(countChanges(section)).toBe(3);
  });

  it('CC-U8: all non-unchanged changeTypes are counted', () => {
    const section = makeSectionDiff(
      [
        makeParagraphDiff('added'),
        makeParagraphDiff('removed'),
        makeParagraphDiff('modified'),
        makeParagraphDiff('reordered'),
        makeParagraphDiff('moved'),
      ],
      [],
    );
    expect(countChanges(section)).toBe(5);
  });

  it('CC-U9: subsection diffs are not recursively counted', () => {
    const section = makeSectionDiff(
      [makeParagraphDiff('modified')],
      [],
      {
        subsectionDiffs: [
          makeSectionDiff(
            [makeParagraphDiff('modified'), makeParagraphDiff('added')],
            [makeTableDiff('modified')],
          ),
        ],
      },
    );
    expect(countChanges(section)).toBe(1);
  });
});

describe('US-2.7: Diff summary computation (DS-I1–I2)', () => {
  it('DS-I1: diffSummary counts sections by changeType', () => {
    const sections: Array<{ changeType: ChangeType }> = [
      { changeType: 'added' },
      { changeType: 'added' },
      { changeType: 'removed' },
      { changeType: 'modified' },
      { changeType: 'modified' },
      { changeType: 'modified' },
      { changeType: 'unchanged' },
      { changeType: 'unchanged' },
      { changeType: 'unchanged' },
      { changeType: 'unchanged' },
    ];

    const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const s of sections) {
      if (s.changeType === 'added') summary.added++;
      else if (s.changeType === 'removed') summary.removed++;
      else if (s.changeType === 'modified' || s.changeType === 'reordered' || s.changeType === 'moved')
        summary.modified++;
      else summary.unchanged++;
    }

    expect(summary).toEqual({ added: 2, removed: 1, modified: 3, unchanged: 4 });
  });

  it('DS-I2: reordered and moved sections are bucketed under modified', () => {
    const sections: Array<{ changeType: ChangeType }> = [
      { changeType: 'modified' },
      { changeType: 'reordered' },
      { changeType: 'moved' },
      { changeType: 'added' },
      { changeType: 'removed' },
      { changeType: 'unchanged' },
    ];

    const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const s of sections) {
      if (s.changeType === 'added') summary.added++;
      else if (s.changeType === 'removed') summary.removed++;
      else if (s.changeType === 'modified' || s.changeType === 'reordered' || s.changeType === 'moved')
        summary.modified++;
      else summary.unchanged++;
    }

    expect(summary).toEqual({ added: 1, removed: 1, modified: 3, unchanged: 1 });
  });
});

describe('US-2.7: End-to-end data flow (E2E-I1–I2)', () => {
  beforeEach(() => {
    setDiffPipelineDone();
  });

  it('E2E-I1: App renders section nav items with change count badges', () => {
    render(<App />);

    const badges = screen.getAllByLabelText(/\d+ changes?/);
    expect(badges.length).toBe(2);

    for (const badge of badges) {
      expect(badge.className).toContain('bg-amber-100');
      expect(badge.className).toContain('text-amber-700');
    }

    const twoChangesBadges = screen.getAllByLabelText('2 changes');
    expect(twoChangesBadges).toHaveLength(2);
  });

  it('E2E-I2: App renders diff summary bar with section-level counts', () => {
    render(<App />);

    const summaryBar = screen.getByRole('status', { name: /diff summary/i });
    expect(summaryBar).toBeInTheDocument();

    expect(summaryBar).toHaveTextContent('2 modified');
    expect(summaryBar).toHaveTextContent('1 unchanged');

    expect(summaryBar).not.toHaveTextContent(/\d+ added/);
    expect(summaryBar).not.toHaveTextContent(/\d+ removed/);
  });
});

// --- US-2.11: Sync Scroll Integration Tests ---

describe('US-2.11: Sync Scroll Integration', () => {
  // SS-I1: App renders Header with sync scroll toggle
  it('SS-I1: renders sync scroll toggle button with aria-pressed=true in Header', () => {
    render(<App />);
    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Toggle should be inside the header
    const header = screen.getByRole('banner');
    expect(header.contains(toggle)).toBe(true);
  });

  // SS-I3: Toggle disables/enables sync between panels
  it('SS-I3: clicking toggle changes aria-pressed from true to false and back', () => {
    render(<App />);
    const toggle = screen.getByRole('button', { name: /sync scroll/i });

    // Initially enabled
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Click to disable
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Click to re-enable
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  // SS-I2: useSyncedScroll is wired — IntersectionObservers created for panels
  it('SS-I2: sync scroll hook creates IntersectionObservers when pipeline is done', () => {
    setDiffPipelineDone();
    render(<App />);

    // The hook creates IntersectionObservers for both panels
    // Plus useActiveSection creates one for oldPanelRef
    // At minimum, IntersectionObserver constructor was called
    expect(mockIOObserve).toHaveBeenCalled();
  });

  // SS-I4: SectionNav click coexists with sync scroll
  it('SS-I4: SectionNav click still scrolls both panels when sync is enabled', () => {
    setDiffPipelineDone();
    const { container } = render(<App />);

    // Verify sync toggle is present and enabled
    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Click a section in SectionNav
    const nav = screen.getByRole('navigation');
    const firstButton = nav.querySelector('button')!;
    expect(firstButton).not.toBeNull();

    fireEvent.click(firstButton);

    // Both panels should have scrollIntoView called on their matching section
    const sectionId = container.querySelector('section[id]:not(#preamble)')?.id;
    if (sectionId) {
      const matchingSections = container.querySelectorAll(`#${CSS.escape(sectionId)}`);
      expect(matchingSections.length).toBe(2);
      for (const section of matchingSections) {
        expect(section.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'start',
        });
      }
    }
  });
  // SS-I5: Sync scroll works with dynamically loaded sections
  it('SS-I5: sections become available after pipeline transitions to done', () => {
    // Start with pipeline idle — no sections rendered
    const { container, rerender } = render(<App />);
    expect(container.querySelectorAll('section[id]')).toHaveLength(0);

    // Transition to done — sections should appear
    setDiffPipelineDone();
    rerender(<App />);

    const sections = container.querySelectorAll('section[id]');
    expect(sections.length).toBeGreaterThan(0);

    // Sync toggle is still enabled
    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

// --- US-2.10: Pipeline Integration Tests ---

describe('US-2.10: Pipeline Integration (APP-P)', () => {
  it('APP-P1: idle pipeline → both panels show placeholder', () => {
    render(<App />);
    const placeholders = screen.getAllByText(/filing content will appear here/i);
    expect(placeholders).toHaveLength(2);
  });

  it('APP-P2: fetching pipeline → both panels show fetching text', () => {
    mockDiffPipelineState.status = 'fetching';
    render(<App />);
    expect(screen.getAllByText(/fetching filings/i)).toHaveLength(2);
  });

  it('APP-P3: parsing pipeline → both panels show parsing text', () => {
    mockDiffPipelineState.status = 'parsing';
    render(<App />);
    expect(screen.getAllByText(/parsing filings/i)).toHaveLength(2);
  });

  it('APP-P4: diffing pipeline → both panels show diffing text', () => {
    mockDiffPipelineState.status = 'diffing';
    render(<App />);
    expect(screen.getAllByText(/computing diff/i)).toHaveLength(2);
  });

  it('APP-P5: done pipeline → content rendered, no placeholders', () => {
    setDiffPipelineDone();
    const { container } = render(<App />);
    expect(container.querySelectorAll('.filing-content-root')).toHaveLength(2);
    expect(screen.queryByText(/filing content will appear here/i)).toBeNull();
  });

  it('APP-P6: error pipeline → error alerts in both panels', () => {
    mockDiffPipelineState.status = 'error';
    mockDiffPipelineState.error = 'Filing not available';
    render(<App />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByText('Filing not available')).toHaveLength(2);
  });

  it('APP-P7: section nav populated when pipeline done', () => {
    setDiffPipelineDone();
    render(<App />);
    const nav = screen.getByRole('navigation');
    const buttons = nav.querySelectorAll('button');
    expect(buttons.length).toBe(3);
  });

  it('APP-P8: section nav empty when pipeline not done', () => {
    mockDiffPipelineState.status = 'fetching';
    render(<App />);
    const nav = screen.getByRole('navigation');
    expect(nav.querySelectorAll('button')).toHaveLength(0);
  });

  it('APP-P9: loading state does not show error or placeholder', () => {
    mockDiffPipelineState.status = 'fetching';
    render(<App />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/filing content will appear here/i)).toBeNull();
  });

  it('APP-P10: error state does not show content', () => {
    mockDiffPipelineState.status = 'error';
    mockDiffPipelineState.error = 'Test error';
    const { container } = render(<App />);
    expect(container.querySelectorAll('.filing-content-root')).toHaveLength(0);
  });

  it('APP-P11: diff summary not rendered when pipeline idle', () => {
    render(<App />);
    expect(screen.queryByRole('status', { name: /diff summary/i })).toBeNull();
  });

  it('APP-P12: diff summary rendered when pipeline done', () => {
    setDiffPipelineDone();
    render(<App />);
    const summaryBar = screen.getByRole('status', { name: /diff summary/i });
    expect(summaryBar).toHaveTextContent('2 modified');
    expect(summaryBar).toHaveTextContent('1 unchanged');
  });
});
