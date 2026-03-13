# US-2.3: Render Original Filing HTML — Test Plan

## Overview

US-2.3 adds filing content rendering to `FilingPanel`. When a `StructuredDocument` is provided, the panel slices the original HTML string (`filing.html`) by `SourceLocation` offsets from `sections` and renders each section in a `<section>` element with the section's `id` field. When no document is provided, the panel retains its US-2.2 placeholder behavior.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, HTML content rendering, section containers, backward compatibility, and safety
2. **Visual validation** (Chrome DevTools MCP screenshots) — verify rendered filing content appearance, CSS isolation, scroll behavior, and real-world HTML rendering

## Component Structure (per implementation design)

| Component | File | Props | Responsibility |
|-----------|------|-------|---------------|
| `FilingPanel` | `components/FilingPanel.tsx` | `label: string, document?: StructuredDocument` | Panel with heading, filing selector, and content area. Renders `FilingContent` when `document` provided, placeholder when not. |
| `FilingContent` | `components/FilingContent.tsx` (new) | `document: StructuredDocument` | Renders original HTML sliced by section `SourceLocation` offsets. Each section wrapped in a `<section id={section.id}>` element. Strips `<style>` blocks to prevent CSS leakage. Contains `sliceSections()` pure function. |

### Internal types (in FilingContent.tsx)

```typescript
interface HtmlSection {
  id: string;    // section.id, "preamble", or "content"
  html: string;  // raw HTML slice from filing.html (with <style> blocks stripped)
}
```

### CSS files

| File | Purpose |
|------|---------|
| `components/filing-content.css` | CSS isolation: `.filing-content-root` (`contain: content`) and `.filing-section` (`all: initial`, overflow handling) |

---

## 1. BDD Acceptance Criteria

The Gherkin scenarios below define the acceptance criteria as testable behaviors. They are **not** executed by a BDD framework — they serve as the specification that drives the actual Vitest test code in Sections 2–3. Each scenario maps to one or more `it()` blocks. "Given the component is mounted" translates to `render(<FilingPanel ... />)`; "Then" assertions use Testing Library queries and jest-dom matchers.

### AC-1: Backward compatibility — no document shows placeholder

```gherkin
Scenario: FilingPanel renders placeholder when no document is provided
  Given a FilingPanel is mounted with label="Filing A" and no document prop
  When the component renders
  Then the heading "Filing A" is visible
  And the disabled filing selector is visible
  And the placeholder text "Filing content will appear here" is visible
  And no FilingContent component is rendered
```

### AC-2: Original HTML is rendered from filing.html

```gherkin
Scenario: FilingPanel renders original HTML from the filing
  Given a StructuredDocument with filing.html containing "<p>Hello World</p>"
  And sections with SourceLocation offsets that cover the HTML
  When a FilingPanel is mounted with that document
  Then the rendered content contains "Hello World" as rendered HTML (not escaped text)
  And no raw HTML tags are visible as text in the output
  And the placeholder text is not visible
```

### AC-3: Sections are sliced by SourceLocation offsets

```gherkin
Scenario: HTML is sliced into sections using SourceLocation start/end
  Given a StructuredDocument with 3 sections having distinct SourceLocation ranges
  And filing.html contains "<h2>Section A</h2><p>Content A</p><h2>Section B</h2><p>Content B</p><h2>Section C</h2><p>Content C</p>"
  When a FilingPanel is mounted with that document
  Then 3 <section> elements are rendered (plus optional preamble)
  And the first section contains "Section A" and "Content A"
  And the second section contains "Section B" and "Content B"
  And the third section contains "Section C" and "Content C"
```

### AC-4: Section containers have IDs derived from section.id

```gherkin
Scenario: Each section container has an ID for scroll-to-section navigation
  Given a StructuredDocument with sections having ids "item-1", "item-1a", "item-2"
  When a FilingPanel is mounted with that document
  Then a <section id="item-1"> element exists
  And a <section id="item-1a"> element exists
  And a <section id="item-2"> element exists
```

### AC-5: Original formatting is preserved

```gherkin
Scenario: Tables, nested tags, and styling from original HTML are preserved
  Given a StructuredDocument with filing.html containing a <table> with rows and cells
  And the HTML contains <b>, <i>, <span style="..."> formatting
  When a FilingPanel is mounted with that document
  Then the table renders with rows and cells (not stripped to plain text)
  And bold, italic, and styled spans are present in the DOM
```

### AC-6: Both panels render different documents

```gherkin
Scenario: Filing A and Filing B render their respective documents
  Given two different StructuredDocuments (docA with "Apple" content, docB with "Microsoft" content)
  When Filing A panel is mounted with docA and Filing B with docB
  Then Filing A panel contains "Apple" content
  And Filing B panel contains "Microsoft" content
  And the contents do not bleed between panels
```

### AC-7: Content is readable within panel boundaries

```gherkin
Scenario: Filing content does not overflow panel boundaries
  Given a StructuredDocument with very wide table content
  When a FilingPanel is mounted with that document
  Then the content area has overflow handling (scroll or hidden)
  And no content bleeds outside the panel boundary
```

### AC-8: Preamble content (before first section) is rendered

```gherkin
Scenario: Content before the first section is rendered as preamble
  Given a StructuredDocument with filing.html that has content before the first section's start offset
  When a FilingPanel is mounted with that document
  Then the preamble content is rendered in a <section id="preamble"> element
  And it appears before the first section container in DOM order
```

### AC-9: Style blocks are stripped to prevent CSS leakage

```gherkin
Scenario: <style> blocks in filing HTML are stripped before rendering
  Given a StructuredDocument with filing.html containing <style> blocks with global CSS rules
  And the HTML also contains elements with inline style attributes
  When a FilingPanel is mounted with that document
  Then no <style> elements exist in the rendered DOM
  And inline style attributes on elements are preserved
  And the filing content is still readable
```

---

## 2. Unit Tests

### `FilingPanel.test.tsx` — Extended

The existing 3 tests from US-2.2 are preserved. New tests are added for document rendering.

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection, RawFiling } from '@edgar-diff/lib';
import { FilingPanel } from './FilingPanel';

// --- Test Fixture Helpers ---

function makeRawFiling(html: string): RawFiling {
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K' as const,
    filingDate: Temporal.PlainDate.from('2024-01-15'),
    primaryDocumentFilename: 'test-filing.htm',
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

function makeSection(
  id: string,
  heading: string,
  start: number,
  end: number,
  level = 1,
): FilingSection {
  return {
    id,
    heading,
    level,
    blocks: [],
    subsections: [],
    source: { start, end },
  };
}

function makeDocument(
  html: string,
  sections: FilingSection[] = [],
): StructuredDocument {
  return {
    filing: makeRawFiling(html),
    sections,
    parseWarnings: [],
  };
}

// --- Existing US-2.2 tests (preserved) ---

describe('FilingPanel', () => {
  it('renders the provided heading', () => {
    render(<FilingPanel label="Filing A" />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
  });

  it('renders a disabled filing selector', () => {
    render(<FilingPanel label="Filing A" />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent(/select a filing/i);
  });

  it('renders Filing B with correct heading', () => {
    render(<FilingPanel label="Filing B" />);
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });

  // --- US-2.3: Backward compatibility ---

  it('shows placeholder text when no document is provided', () => {
    render(<FilingPanel label="Filing A" />);
    expect(
      screen.getByText(/filing content will appear here/i)
    ).toBeInTheDocument();
  });

  it('does not render FilingContent when no document is provided', () => {
    const { container } = render(<FilingPanel label="Filing A" />);
    expect(container.querySelector('.filing-content-root')).toBeNull();
  });

  // --- US-2.3: HTML content rendering ---

  it('renders HTML content from the document (not escaped)', () => {
    const html = '<p>Hello <b>World</b></p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);

    // The text should be rendered as HTML, not as escaped text
    expect(screen.getByText('World')).toBeInTheDocument();
    expect(screen.queryByText('<p>')).not.toBeInTheDocument();
    expect(screen.queryByText('&lt;p&gt;')).not.toBeInTheDocument();
  });

  it('hides placeholder text when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    expect(
      screen.queryByText(/filing content will appear here/i)
    ).not.toBeInTheDocument();
  });

  // --- US-2.3: Section containers ---

  it('renders section containers with IDs derived from section.id', () => {
    const html = '<h2>Risk Factors</h2><p>Details</p>';
    const doc = makeDocument(html, [
      makeSection('item-1a', 'Item 1A. Risk Factors', 0, html.length),
    ]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />
    );

    expect(container.querySelector('#item-1a')).not.toBeNull();
  });

  it('renders multiple section containers in order', () => {
    const html =
      '<h2>Business</h2><p>A</p><h2>Risk</h2><p>B</p><h2>Props</h2><p>C</p>';
    const item1aStart = html.indexOf('<h2>Risk');
    const item2Start = html.indexOf('<h2>Props');
    const sections = [
      makeSection('item-1', 'Item 1. Business', 0, item1aStart),
      makeSection('item-1a', 'Item 1A. Risk Factors', item1aStart, item2Start),
      makeSection('item-2', 'Item 2. Properties', item2Start, html.length),
    ];
    const doc = makeDocument(html, sections);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />
    );

    expect(container.querySelector('#item-1')).not.toBeNull();
    expect(container.querySelector('#item-1a')).not.toBeNull();
    expect(container.querySelector('#item-2')).not.toBeNull();

    // Verify DOM order
    const item1 = container.querySelector('#item-1')!;
    const item1a = container.querySelector('#item-1a')!;
    const item2 = container.querySelector('#item-2')!;
    expect(
      item1.compareDocumentPosition(item1a) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      item1a.compareDocumentPosition(item2) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('slices HTML content by SourceLocation offsets', () => {
    const html = 'AAAA<p>First</p>BBBB<p>Second</p>';
    const firstStart = html.indexOf('<p>First');
    const firstEnd = html.indexOf('BBBB');
    const secondStart = html.indexOf('<p>Second');
    const sections = [
      makeSection('s1', 'First', firstStart, firstEnd),
      makeSection('s2', 'Second', secondStart, html.length),
    ];
    const doc = makeDocument(html, sections);
    render(<FilingPanel label="Filing A" document={doc} />);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  // --- US-2.3: Formatting preservation ---

  it('preserves table structure in rendered HTML', () => {
    const html =
      '<table><tr><th>Header</th></tr><tr><td>Cell 1</td></tr></table>';
    const doc = makeDocument(html, [
      makeSection('item-8', 'Item 8. Financial Statements', 0, html.length),
    ]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('th')).not.toBeNull();
    expect(container.querySelector('td')).not.toBeNull();
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Cell 1')).toBeInTheDocument();
  });

  it('preserves inline formatting tags', () => {
    const html = '<p><b>Bold</b> and <i>italic</i> and <u>underline</u></p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />
    );

    expect(container.querySelector('b')).not.toBeNull();
    expect(container.querySelector('i')).not.toBeNull();
    expect(container.querySelector('u')).not.toBeNull();
  });

  // --- US-2.3: Filing selector still works ---

  it('still renders the disabled filing selector when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });

  // --- US-2.3: Panel header still shows label ---

  it('still renders the panel heading when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
  });
});
```

### `FilingContent.test.tsx` — New

`FilingContent` is extracted as a dedicated component with `sliceSections()` pure function. Tests cover both the rendering and the slicing logic.

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection, RawFiling } from '@edgar-diff/lib';
import { FilingContent } from './FilingContent';

// --- Test Fixture Helpers (shared with FilingPanel.test.tsx) ---

function makeRawFiling(html: string): RawFiling {
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K' as const,
    filingDate: Temporal.PlainDate.from('2024-01-15'),
    primaryDocumentFilename: 'test.htm',
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

function makeSection(
  id: string,
  heading: string,
  start: number,
  end: number,
): FilingSection {
  return { id, heading, level: 1, blocks: [], subsections: [], source: { start, end } };
}

function makeDoc(
  html: string,
  sections: FilingSection[] = [],
): StructuredDocument {
  return {
    filing: makeRawFiling(html),
    sections,
    parseWarnings: [],
  };
}

describe('FilingContent', () => {
  // --- Preamble rendering ---

  it('renders preamble content before the first section', () => {
    const html = '<p>Preamble</p><h2>Item 1</h2><p>Content</p>';
    const item1Start = html.indexOf('<h2>');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', item1Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(screen.getByText('Preamble')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();

    // Preamble gets id="section-preamble"
    const preamble = container.querySelector('#preamble');
    expect(preamble).not.toBeNull();
  });

  it('does not render preamble when first section starts at offset 0', () => {
    const html = '<h2>Item 1</h2><p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('#preamble')).toBeNull();
  });

  // --- Section ID assignment ---

  it('wraps each section in a <section> element with the section id', () => {
    const html = '<h2>Item 1</h2><p>A</p><h2>Item 2</h2><p>B</p>';
    const item2Start = html.indexOf('<h2>Item 2');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, item2Start),
      makeSection('item-2', 'Item 2', item2Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    const s1 = container.querySelector('#item-1');
    const s2 = container.querySelector('#item-2');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1?.tagName.toLowerCase()).toBe('section');
    expect(s2?.tagName.toLowerCase()).toBe('section');
  });

  // --- No sections fallback ---

  it('renders entire HTML as id="content" when there are no sections', () => {
    const html = '<p>No sections here</p>';
    const doc = makeDoc(html, []);
    const { container } = render(<FilingContent document={doc} />);

    expect(screen.getByText('No sections here')).toBeInTheDocument();
    expect(container.querySelector('#content')).not.toBeNull();
  });

  it('renders empty container when HTML is empty and no sections', () => {
    const { container } = render(<FilingContent document={makeDoc('', [])} />);
    const root = container.querySelector('.filing-content-root');
    expect(root).not.toBeNull();
    expect(root?.children).toHaveLength(0);
  });

  // --- Single section ---

  it('handles a single section covering the full document', () => {
    const html = '<h2>Only Section</h2><p>All the content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('#item-1')).not.toBeNull();
    expect(screen.getByText('All the content')).toBeInTheDocument();
  });

  // --- Formatting preservation ---

  it('preserves table markup from original HTML', () => {
    const html = '<h2>Item 1</h2><table><tr><td>Cell</td></tr></table>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('preserves list markup from original HTML', () => {
    const html = '<ul><li>First</li><li>Second</li></ul>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  // --- Style block stripping ---

  it('strips <style> blocks from rendered HTML', () => {
    const html = '<style>body { font-family: Comic Sans; }</style><p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('strips multiple <style> blocks', () => {
    const html = '<style>.a { color: red; }</style><p>Text</p><style>.b { color: blue; }</style>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Text')).toBeInTheDocument();
  });

  it('preserves inline styles while stripping <style> blocks', () => {
    const html = '<style>p { margin: 0; }</style><p style="color: red;">Styled text</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    // <style> block is gone
    expect(container.querySelectorAll('style')).toHaveLength(0);
    // Inline style attribute is preserved
    const p = container.querySelector('p[style]');
    expect(p).not.toBeNull();
    expect(p?.getAttribute('style')).toContain('color');
    expect(screen.getByText('Styled text')).toBeInTheDocument();
  });

  it('strips <style> blocks from preamble content too', () => {
    const html = '<style>body { margin: 0; }</style><p>Preamble</p><h2>Item 1</h2><p>Section</p>';
    const item1Start = html.indexOf('<h2>');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', item1Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Preamble')).toBeInTheDocument();
  });

  // --- CSS isolation structure ---

  it('wraps content in a .filing-content-root container', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('.filing-content-root')).not.toBeNull();
  });

  it('applies .filing-section class to each section element', () => {
    const html = '<h2>A</h2><p>1</p><h2>B</h2><p>2</p>';
    const bStart = html.indexOf('<h2>B');
    const doc = makeDoc(html, [
      makeSection('item-1', 'A', 0, bStart),
      makeSection('item-2', 'B', bStart, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    const sections = container.querySelectorAll('.filing-section');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
```

---

## 3. Integration Tests (App Composition)

### `App.test.tsx` — Extended

Per the implementation design, `App.tsx` imports a fixture `sampleDocument` and passes it to Filing A. Filing B stays without a document.

```typescript
describe('App — US-2.3 additions', () => {
  it('renders both filing panels (structure preserved from US-2.2)', () => {
    render(<App />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });

  it('Filing A renders filing content from fixture (not placeholder)', () => {
    render(<App />);
    // Filing A should show content from the sample fixture, not the placeholder
    // The fixture contains "SAMPLE CORP" or similar identifiable text
    expect(screen.queryByText('Filing A')).toBeInTheDocument();
    // At least one section container should exist under Filing A
    const { container } = render(<App />);
    expect(container.querySelector('#item-1')).not.toBeNull();
  });

  it('Filing B shows placeholder text (no document provided)', () => {
    render(<App />);
    // Filing B should still show the placeholder
    // Note: need to scope this check to the Filing B panel area
    const placeholders = screen.getAllByText(/filing content will appear here/i);
    expect(placeholders).toHaveLength(1); // Only Filing B has placeholder
  });

  it('section navigation sidebar is still present alongside filing panels', () => {
    render(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
```

---

## 4. Boundary Conditions

These test cases should be added to `FilingContent.test.tsx`.

```typescript
describe('Boundary conditions', () => {
  it('handles 0 sections with non-empty HTML (renders as id="section-content")', () => {
    const html = '<p>No sections here</p>';
    const doc = makeDoc(html, []);
    const { container } = render(<FilingContent document={doc} />);
    expect(screen.getByText('No sections here')).toBeInTheDocument();
    expect(container.querySelector('#content')).not.toBeNull();
  });

  it('handles 1 section', () => {
    const html = '<p>Only section</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);
    expect(container.querySelector('#item-1')).not.toBeNull();
  });

  it('handles many sections (20+)', () => {
    let html = '';
    const sections: FilingSection[] = [];
    for (let i = 0; i < 20; i++) {
      const start = html.length;
      html += `<h2>Section ${i}</h2><p>Content ${i}</p>`;
      sections.push(makeSection(`sec-${i}`, `Section ${i}`, start, html.length));
    }
    const doc = makeDoc(html, sections);
    const { container } = render(<FilingContent document={doc} />);

    // All 20 sections rendered
    for (let i = 0; i < 20; i++) {
      expect(container.querySelector(`#sec-${i}`)).not.toBeNull();
    }
  });

  it('handles empty HTML string with empty sections', () => {
    const { container } = render(<FilingContent document={makeDoc('', [])} />);
    const root = container.querySelector('.filing-content-root');
    expect(root).not.toBeNull();
    expect(root?.children).toHaveLength(0);
  });

  it('handles section with start === end (zero-length range)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('empty', 'Empty Section', 5, 5),
    ]);
    const { container } = render(<FilingContent document={doc} />);
    // Section container exists but has empty innerHTML
    const section = container.querySelector('#empty');
    expect(section).not.toBeNull();
    expect(section?.innerHTML).toBe('');
  });

  it('handles preamble-only document (sections start after all content)', () => {
    const html = '<p>All preamble</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', html.length, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);
    expect(container.querySelector('#preamble')).not.toBeNull();
    expect(screen.getByText('All preamble')).toBeInTheDocument();
  });
});
```

---

## 5. Error Conditions

```typescript
describe('Error conditions', () => {
  it('handles document with undefined filing.html gracefully', () => {
    // Defensive: type system should prevent this, but rendering should not crash
    const doc: StructuredDocument = {
      filing: {
        ...makeRawFiling(''),
        html: undefined as unknown as string,
      },
      sections: [],
      parseWarnings: [],
    };
    expect(() =>
      render(<FilingPanel label="Filing A" document={doc} />)
    ).not.toThrow();
  });

  it('handles source location beyond HTML string length', () => {
    const html = '<p>Short</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, 9999),
    ]);
    // String.prototype.slice handles out-of-bounds gracefully
    expect(() =>
      render(<FilingContent document={doc} />)
    ).not.toThrow();
    expect(screen.getByText('Short')).toBeInTheDocument();
  });

  it('handles source location with start > end (inverted range)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 10, 5),
    ]);
    // String.prototype.slice returns '' for inverted ranges — should not crash
    expect(() =>
      render(<FilingContent document={doc} />)
    ).not.toThrow();
  });

  it('does not execute <script> tags in filing HTML', () => {
    const html = '<p>Safe</p><script>alert("xss")</script><p>Also safe</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    // dangerouslySetInnerHTML inserts script tags into the DOM but browsers
    // do not execute scripts added via innerHTML. This is safe.
    // The "Safe" and "Also safe" text should render normally.
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('Also safe')).toBeInTheDocument();
  });
});
```

> **XSS Note:** The implementation uses `dangerouslySetInnerHTML` without a sanitizer. This is acceptable because: (1) filing HTML comes from SEC EDGAR, a trusted government source, (2) browsers do not execute `<script>` tags inserted via `innerHTML`, (3) adding a sanitizer (DOMPurify) would risk stripping legitimate filing formatting. If the trust model changes (e.g., user-uploaded HTML), a sanitizer should be added.

---

## 6. CSS Isolation Tests

CSS isolation is primarily a **visual validation** concern (jsdom has no CSS engine), but we can verify the structural prerequisites that enable isolation:

```typescript
describe('CSS isolation structure', () => {
  it('wraps filing content in a .filing-content-root container', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('item-1', 'Item 1', 0, html.length)]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('.filing-content-root')).not.toBeNull();
  });

  it('each section has .filing-section class', () => {
    const html = '<p>A</p><p>B</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'A', 0, 8),
      makeSection('item-2', 'B', 8, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    const sections = container.querySelectorAll('.filing-section');
    expect(sections.length).toBe(2);
  });

  it('FilingPanel content area still has overflow-y-auto (from US-2.2)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('item-1', 'Item 1', 0, html.length)]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />
    );

    expect(container.querySelector('.overflow-y-auto')).not.toBeNull();
  });
});
```

> **Visual CSS isolation checks** (filing `<style>` blocks don't leak to app chrome, content stays within panel bounds, `contain: content` works, `all: initial` resets Tailwind preflight) are covered in the UAT doc.

---

## 7. Test Data / Fixtures

### Test file helpers

Both `FilingPanel.test.tsx` and `FilingContent.test.tsx` use the same helper functions. Consider extracting to a shared `test-utils.ts` if duplication becomes a maintenance burden, but inline is fine for now.

```typescript
// Shared pattern for all test files
function makeRawFiling(html: string): RawFiling { /* ... */ }
function makeSection(id, heading, start, end): FilingSection { /* ... */ }
function makeDoc(html, sections): StructuredDocument { /* ... */ }
```

### App fixture file

The implementation creates `apps/web/src/fixtures/sample-filing.ts` with a synthetic `StructuredDocument`. This is used by `App.tsx` for development and by `App.test.tsx` for integration tests. It computes section offsets dynamically from the HTML string (no brittle hardcoded numbers).

### Named fixtures for test plan reference

#### Minimal fixture (2 sections)

```typescript
const MINIMAL_HTML = '<h2>Business</h2><p>We do things.</p><h2>Risk Factors</h2><p>Bad stuff could happen.</p>';
const rfStart = MINIMAL_HTML.indexOf('<h2>Risk');
const MINIMAL_DOC = makeDoc(MINIMAL_HTML, [
  makeSection('item-1', 'Item 1. Business', 0, rfStart),
  makeSection('item-1a', 'Item 1A. Risk Factors', rfStart, MINIMAL_HTML.length),
]);
```

#### Table fixture

```typescript
const TABLE_HTML =
  '<h2>Financial Statements</h2>\n<table><tr><th>Year</th><th>Revenue</th></tr><tr><td>2023</td><td>$394.3B</td></tr></table>';
const TABLE_DOC = makeDoc(TABLE_HTML, [
  makeSection('item-8', 'Item 8. Financial Statements', 0, TABLE_HTML.length),
]);
```

#### No sections fixture

```typescript
const NO_SECTIONS_DOC = makeDoc(
  '<p>Raw filing content with no recognized sections</p>',
  [],
);
// Renders as <section id="content"> with the full HTML
```

#### Preamble fixture

```typescript
const PREAMBLE_HTML = '<div>Cover page stuff</div><h2>Item 1</h2><p>Business</p>';
const item1Start = PREAMBLE_HTML.indexOf('<h2>');
const PREAMBLE_DOC = makeDoc(PREAMBLE_HTML, [
  makeSection('item-1', 'Item 1. Business', item1Start, PREAMBLE_HTML.length),
]);
// Renders preamble <section id="preamble"> + <section id="item-1">
```

### Creating mock `RawFiling` objects

`RawFiling` requires `Temporal.PlainDate` and `Temporal.Instant` fields. Use the `@js-temporal/polyfill` package (already a project dependency for `edgar-diff-lib`; confirm it's in `apps/web/package.json` or accessible via workspace):

```typescript
import { Temporal } from '@js-temporal/polyfill';

const filing: RawFiling = {
  accessionNumber: '0000320193-24-000123',
  cik: '0000320193',
  formType: '10-K',
  filingDate: Temporal.PlainDate.from('2024-01-15'),
  primaryDocumentFilename: 'aapl-20240101.htm',
  html: '<p>Filing content here</p>',
  fetchedAt: Temporal.Now.instant(),
};
```

### Real fixture files

Real 10-K HTML files are available at `libs/edgar-diff-lib/tests/integration/fixtures/` (e.g., `10k-aapl-2023.html`). These are too large for unit tests but can be used for visual validation during UAT.

---

## 8. UAT Document

See `.specs/us-2-3-filing-content/uat.md` (separate file).

---

## 9. Testing Limitations (jsdom)

### What jsdom CANNOT do

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS engine | Cannot verify `contain: content` or `all: initial` actually isolate styles | Verify visually via MCP screenshots |
| No `innerHTML` visual rendering | jsdom parses HTML into DOM but doesn't render it | Verify DOM structure only; visual check via MCP |
| No scroll behavior | Cannot test scroll-to-section or independent scroll | Test ID presence; verify scroll visually |
| No computed styles | Cannot verify `overflow-x: auto` actually clips wide tables | Verify class presence only; visual check via MCP |
| No layout | Cannot verify filing content stays within panel bounds | Verify visually via MCP |

### What jsdom CAN do (and we test thoroughly)

- DOM structure: `<section>` elements exist with correct IDs
- HTML content insertion: rendered HTML contains expected text, tags are not escaped
- Class presence: `.filing-content-root`, `.filing-section` classes exist
- Tag preservation: `<table>`, `<b>`, `<i>`, `<ul>/<li>` are present in the DOM
- Backward compatibility: no document → placeholder shown, no `FilingContent` rendered
- Error handling: malformed inputs don't crash
- Component composition: label, selector, and content all render together

### Strategy summary

**Programmatic tests** verify that `sliceSections()` correctly partitions HTML, `FilingContent` creates `<section>` elements with proper IDs and CSS classes, formatting tags are preserved, edge cases are handled gracefully, and `FilingPanel` maintains backward compatibility. **MCP screenshots** verify the visual result: CSS isolation works, filing content renders correctly, panels scroll independently, and real-world 10-K HTML doesn't break the layout.

---

## 10. Test File Organization

```
apps/web/src/
  components/
    FilingPanel.test.tsx     # Unit: extended with US-2.3 tests
    FilingContent.test.tsx   # Unit: new — section slicing, preamble, IDs, CSS classes
  App.test.tsx               # Integration: fixture rendering, Filing A vs Filing B
  fixtures/
    sample-filing.ts         # Synthetic StructuredDocument for dev + integration tests

.specs/us-2-3-filing-content/
  test-plan.md               # This document
  uat.md                     # Story-level UAT
  screenshots/               # Reference screenshots (captured during implementation)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 11. Migrating from US-2.2 Tests

The existing `FilingPanel.test.tsx` has 3 tests — **all are preserved**. US-2.3 tests are **additive**:

- `renders the provided heading` — **keep** (also verified with document present)
- `renders a disabled filing selector` — **keep** (also verified with document present)
- `renders Filing B with correct heading` — **keep**

The existing `App.test.tsx` tests are also preserved. The integration test for placeholder count changes from 2 to 1 (since Filing A now gets a fixture document).

No existing tests need to be removed. One assertion may need updating: if previous App tests expect both panels to show placeholder text, update to expect only Filing B's placeholder.
