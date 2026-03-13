# US-2.3: Render Original Filing HTML — Implementation Design

## Approach

Enhance `FilingPanel` to accept an optional `StructuredDocument` prop and render the **original HTML** from `filing.html`, sliced into navigable sections using `SourceLocation` offsets. A new `FilingContent` sub-component encapsulates the section-slicing logic and HTML rendering. CSS isolation prevents SEC filing styles from leaking into the app shell.

**Key design decisions:**

1. **New `FilingContent` sub-component** — Separates HTML rendering/slicing concerns from the panel chrome (header, selector). `FilingPanel` stays focused on layout; `FilingContent` owns the rendering logic. This keeps `FilingPanel` clean for future stories (US-2.4 scroll-to-section, US-2.9 filing selector).

2. **`dangerouslySetInnerHTML` with CSS isolation** — SEC filings contain complex HTML (nested tables, inline styles, `<style>` blocks). Re-parsing or sanitizing would lose formatting. Instead, render the original HTML slices directly and use CSS `all: initial` + `contain: content` on the container to prevent style leakage.

3. **Preamble rendering** — The parser skips content before the first Item heading (SEC headers, form type, company name, table of contents). This preamble is valuable context, so we render `html.slice(0, sections[0].source.start)` as a "preamble" section before the first Item section.

4. **Flat section list (no subsection nesting)** — The parser currently produces `level: 1` sections with empty `subsections: []`. The rendering logic iterates `sections` flat. If subsections are added later, the component can recurse without structural changes.

5. **Hardcoded fixture data** — For this story, `App.tsx` imports a pre-built `StructuredDocument` fixture. No live fetching. This validates the rendering pipeline in isolation.

6. **Backward-compatible props** — `document` prop is optional. When absent, `FilingPanel` renders the existing placeholder text from US-2.2.

## Component Hierarchy

```
App
├── Header
├── SearchBar
└── <main>
    ├── SectionNav
    ├── FilingPanel (label="Filing A", document={fixtureDoc})
    │   ├── Panel header (label + disabled selector)
    │   └── FilingContent (document={fixtureDoc})
    │       ├── <section id="section-preamble">   ← html before first Item
    │       ├── <section id="section-item-1">     ← html.slice(start, end)
    │       ├── <section id="section-item-1a">    ← html.slice(start, end)
    │       └── ...
    ├── Divider
    └── FilingPanel (label="Filing B")    ← no document, shows placeholder
```

## Files to Create

### `apps/web/src/components/FilingContent.tsx`

Renders sliced HTML sections from a `StructuredDocument`.

```tsx
import type { StructuredDocument, FilingSection } from '@edgar-diff/lib';

interface FilingContentProps {
  document: StructuredDocument;
}

interface HtmlSection {
  id: string;
  html: string;
}

/** Strip <style> blocks to prevent global CSS leakage from filing HTML. */
function stripStyleBlocks(html: string): string {
  return html.replace(/<style[\s>][\s\S]*?<\/style>/gi, '');
}

function sliceSections(document: StructuredDocument): HtmlSection[] {
  const { filing, sections } = document;
  const html = filing.html;
  const result: HtmlSection[] = [];

  // Preamble: content before the first section
  if (sections.length > 0 && sections[0].source.start > 0) {
    result.push({
      id: 'section-preamble',
      html: stripStyleBlocks(html.slice(0, sections[0].source.start)),
    });
  }

  // Each section: slice using source offsets, strip <style> blocks
  for (const section of sections) {
    result.push({
      id: `section-${section.id}`,
      html: stripStyleBlocks(html.slice(section.source.start, section.source.end)),
    });
  }

  // If no sections, render entire HTML as a single block
  if (sections.length === 0 && html.length > 0) {
    result.push({ id: 'section-content', html: stripStyleBlocks(html) });
  }

  return result;
}

export function FilingContent({ document }: FilingContentProps) {
  const sections = sliceSections(document);

  return (
    <div className="filing-content-root">
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="filing-section"
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      ))}
    </div>
  );
}
```

**Rationale:**
- `sliceSections` is a pure function — easy to unit test independently.
- Each `<section>` gets a `section-` prefixed `id` (e.g., `id="section-item-1a"`), enabling scroll-to-section in US-2.4 via `document.getElementById()` and easy querying via `[id^="section-"]`.
- The prefix avoids ID collisions between filing section IDs and other DOM elements in the app.
- When there are no sections but HTML exists, we render the whole HTML as a single block to avoid a blank panel.

### `apps/web/src/components/filing-content.css`

CSS isolation for filing HTML. Imported by `FilingContent.tsx`.

```css
.filing-content-root {
  /* Contain layout and paint to prevent filing content from affecting app */
  contain: content;
}

.filing-section {
  /* Reset inherited styles so filing HTML starts from browser defaults */
  all: initial;
  display: block;
  font-family: inherit;

  /* Constrain filing content within panel */
  max-width: 100%;
  overflow-x: auto;
  overflow-wrap: break-word;
}

/* Ensure tables in filings don't overflow the panel */
.filing-section table {
  max-width: 100%;
  table-layout: auto;
}

/* Constrain images */
.filing-section img {
  max-width: 100%;
  height: auto;
}
```

**Rationale:**
- `contain: content` on the root prevents filing layout from affecting the app shell.
- `all: initial` on each section resets inherited app styles (Tailwind's preflight resets) so the filing HTML renders with browser defaults — preserving the original SEC filing appearance.
- `overflow-x: auto` on sections allows horizontal scrolling for wide tables rather than breaking the panel layout.
- No Shadow DOM: adds complexity (event bubbling, styling APIs) without proportional benefit. CSS containment is simpler and sufficient.

### `apps/web/src/fixtures/sample-filing.ts`

Hardcoded `StructuredDocument` for development/testing. Contains a small synthetic filing with 2-3 sections of realistic HTML.

```tsx
import type { StructuredDocument } from '@edgar-diff/lib';
import { Temporal } from '@js-temporal/polyfill';

// A minimal synthetic filing for US-2.3 development.
// NOT a real SEC filing — just enough HTML to validate rendering.

const SAMPLE_HTML = [
  '<html><body>',
  '<h1>SAMPLE CORP</h1><p>Annual Report (Form 10-K)</p>',
  '<h2>Item 1. Business</h2>',
  '<p>Sample Corp is a technology company.</p>',
  '<table><tr><th>Year</th><th>Revenue</th></tr>',
  '<tr><td>2024</td><td>$1,000,000</td></tr></table>',
  '<h2>Item 1A. Risk Factors</h2>',
  '<p>The company faces various risks including:</p>',
  '<ul><li>Market risk</li><li>Operational risk</li></ul>',
  '<h2>Item 2. Properties</h2>',
  '<p>The company leases office space in San Francisco.</p>',
  '</body></html>',
].join('\n');

const item1Start = SAMPLE_HTML.indexOf('<h2>Item 1. Business</h2>');
const item1aStart = SAMPLE_HTML.indexOf('<h2>Item 1A. Risk Factors</h2>');
const item2Start = SAMPLE_HTML.indexOf('<h2>Item 2. Properties</h2>');

export const sampleDocument: StructuredDocument = {
  filing: {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-15'),
    primaryDocumentFilename: 'sample-10k.htm',
    html: SAMPLE_HTML,
    fetchedAt: Temporal.Now.instant(),
  },
  sections: [
    {
      id: 'item-1',
      heading: 'Item 1. Business',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item1Start, end: item1aStart },
    },
    {
      id: 'item-1a',
      heading: 'Item 1A. Risk Factors',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item1aStart, end: item2Start },
    },
    {
      id: 'item-2',
      heading: 'Item 2. Properties',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item2Start, end: SAMPLE_HTML.length },
    },
  ],
  parseWarnings: [],
};
```

**Rationale:**
- Offsets are computed at module level from the HTML constant — no mutation, no order dependency.
- `blocks: []` is acceptable — we render from raw HTML slices, not from parsed blocks.
- Small enough to be readable, complex enough to validate tables, lists, and multiple sections.
- Includes preamble content (everything before Item 1) to test preamble rendering.

## Files to Modify

### `apps/web/src/components/FilingPanel.tsx`

Add optional `document` prop. Conditionally render `FilingContent` or placeholder.

```tsx
import type { StructuredDocument } from '@edgar-diff/lib';
import { FilingContent } from './FilingContent';

interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
}

export function FilingPanel({ label, document }: FilingPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{label}</h2>
        <select
          disabled
          className="w-full px-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
        >
          <option>Select a filing...</option>
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {document ? (
          <FilingContent document={document} />
        ) : (
          <p className="text-sm text-gray-400 italic">
            Filing content will appear here
          </p>
        )}
      </div>
    </div>
  );
}
```

**Rationale:**
- Backward compatible: without `document`, renders the US-2.2 placeholder.
- `FilingContent` is rendered inside the existing scrollable content area (`flex-1 overflow-y-auto`), so independent panel scrolling is preserved.

### `apps/web/src/App.tsx`

Import fixture data and pass to Filing A panel. Filing B remains without a document to demonstrate both states.

```tsx
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';
import { sampleDocument } from './fixtures/sample-filing';

export function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav />
        <FilingPanel label="Filing A" document={sampleDocument} />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel label="Filing B" />
      </main>
    </div>
  );
}
```

### `apps/web/src/components/FilingPanel.test.tsx`

Add tests for the new `document` prop behavior.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FilingPanel } from './FilingPanel';
import type { StructuredDocument } from '@edgar-diff/lib';
import { Temporal } from '@js-temporal/polyfill';

// Minimal fixture for tests
function makeDocument(html: string, sections: StructuredDocument['sections'] = []): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K' as const,
      filingDate: Temporal.PlainDate.from('2024-01-15'),
      primaryDocumentFilename: 'test.htm',
      html,
      fetchedAt: Temporal.Now.instant(),
    },
    sections,
    parseWarnings: [],
  };
}

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
  });

  it('renders placeholder when no document is provided', () => {
    render(<FilingPanel label="Filing A" />);
    expect(screen.getByText(/filing content will appear here/i)).toBeInTheDocument();
  });

  it('renders filing HTML when document is provided', () => {
    const doc = makeDocument(
      '<p>Hello SEC</p>',
      [],
    );
    render(<FilingPanel label="Filing A" document={doc} />);
    expect(screen.getByText('Hello SEC')).toBeInTheDocument();
    expect(screen.queryByText(/filing content will appear here/i)).not.toBeInTheDocument();
  });
});
```

### `apps/web/src/components/FilingContent.test.tsx` (new)

Dedicated tests for the section-slicing and rendering logic.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FilingContent } from './FilingContent';
import type { StructuredDocument, FilingSection } from '@edgar-diff/lib';
import { Temporal } from '@js-temporal/polyfill';

function makeDoc(html: string, sections: FilingSection[]): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K' as const,
      filingDate: Temporal.PlainDate.from('2024-01-15'),
      primaryDocumentFilename: 'test.htm',
      html,
      fetchedAt: Temporal.Now.instant(),
    },
    sections,
    parseWarnings: [],
  };
}

function makeSection(id: string, heading: string, start: number, end: number): FilingSection {
  return { id, heading, level: 1, blocks: [], subsections: [], source: { start, end } };
}

describe('FilingContent', () => {
  it('renders preamble content before first section', () => {
    const html = '<p>Preamble</p><h2>Item 1</h2><p>Content</p>';
    const sections = [makeSection('item-1', 'Item 1', html.indexOf('<h2>'), html.length)];
    render(<FilingContent document={makeDoc(html, sections)} />);

    expect(screen.getByText('Preamble')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('wraps each section in an element with a prefixed section id', () => {
    const html = '<h2>Item 1</h2><p>A</p><h2>Item 2</h2><p>B</p>';
    const item2Start = html.indexOf('<h2>Item 2');
    const sections = [
      makeSection('item-1', 'Item 1', 0, item2Start),
      makeSection('item-2', 'Item 2', item2Start, html.length),
    ];
    const { container } = render(<FilingContent document={makeDoc(html, sections)} />);

    expect(container.querySelector('#section-item-1')).toBeInTheDocument();
    expect(container.querySelector('#section-item-2')).toBeInTheDocument();
  });

  it('renders entire HTML when there are no sections', () => {
    const html = '<p>No sections here</p>';
    render(<FilingContent document={makeDoc(html, [])} />);
    expect(screen.getByText('No sections here')).toBeInTheDocument();
  });

  it('renders nothing for empty HTML with no sections', () => {
    const { container } = render(<FilingContent document={makeDoc('', [])} />);
    const root = container.querySelector('.filing-content-root');
    expect(root).toBeInTheDocument();
    expect(root?.children).toHaveLength(0);
  });

  it('preserves table markup from original HTML', () => {
    const html = '<h2>Item 1</h2><table><tr><td>Cell</td></tr></table>';
    const sections = [makeSection('item-1', 'Item 1', 0, html.length)];
    const { container } = render(<FilingContent document={makeDoc(html, sections)} />);

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('strips <style> blocks from rendered HTML', () => {
    const html = '<style>body { font-family: Comic Sans; }</style><p>Content</p>';
    const sections = [makeSection('item-1', 'Item 1', 0, html.length)];
    const { container } = render(<FilingContent document={makeDoc(html, sections)} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('preserves inline styles while stripping style blocks', () => {
    const html = '<style>.x { color: red; }</style><p style="color: blue">Styled</p>';
    const sections = [makeSection('item-1', 'Item 1', 0, html.length)];
    const { container } = render(<FilingContent document={makeDoc(html, sections)} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    const p = container.querySelector('p');
    expect(p?.getAttribute('style')).toBe('color: blue');
  });
});
```

## Interfaces and Types

### Props contracts

| Component | Props | Notes |
|-----------|-------|-------|
| `FilingPanel` | `{ label: string; document?: StructuredDocument }` | `document` optional for backward compat |
| `FilingContent` | `{ document: StructuredDocument }` | Always receives a document |

### Internal types (in FilingContent.tsx)

```typescript
interface HtmlSection {
  id: string;    // "section-{section.id}" (e.g., "section-item-1a") or "section-preamble" or "section-content"
  html: string;  // raw HTML slice
}
```

### Key library types used

| Type | From | Usage |
|------|------|-------|
| `StructuredDocument` | `@edgar-diff/lib` | Top-level document with filing + sections |
| `FilingSection` | `@edgar-diff/lib` | Section with `id`, `heading`, `source: SourceLocation` |
| `SourceLocation` | `@edgar-diff/lib` | `{ start: number; end: number }` — UTF-16 offsets |
| `RawFiling` | `@edgar-diff/lib` | Contains `html: string` field |

## Data Flow

```
App.tsx
├── imports sampleDocument from fixtures/sample-filing.ts
├── passes document={sampleDocument} to FilingPanel A
└── passes no document to FilingPanel B

FilingPanel({ label, document })
├── Renders panel header (label + disabled selector) — unchanged
└── Content area:
    ├── If document → <FilingContent document={document} />
    └── If no document → placeholder text

FilingContent({ document })
├── sliceSections(document) → HtmlSection[]
│   ├── Preamble: html.slice(0, sections[0].source.start)
│   ├── Section 1: html.slice(sections[0].source.start, sections[0].source.end)
│   ├── Section 2: html.slice(sections[1].source.start, sections[1].source.end)
│   └── ...
└── Renders each HtmlSection as <section id="section-{id}" dangerouslySetInnerHTML />
```

## CSS Isolation Strategy

### Problem

SEC filing HTML may contain:
- `<style>` blocks with global selectors (e.g., `body { font-family: ... }`, `p { margin: ... }`)
- Inline styles on elements
- CSS classes that could collide with Tailwind classes
- Wide tables that exceed panel width

### Chosen approach: CSS Containment + Reset

```
┌── .filing-content-root ──────────────────────────┐
│  contain: content                                 │
│  ┌── .filing-section ──────────────────────────┐  │
│  │  all: initial; display: block;              │  │
│  │  (filing HTML rendered here)                │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

1. **Strip `<style>` blocks** in `sliceSections()` — CSS containment does NOT scope `<style>` elements; they create global stylesheets regardless of where they appear in the DOM. A filing with `<style>body { font-family: Comic Sans }</style>` would leak into the app. We strip all `<style>` blocks via regex before rendering. Inline styles (which carry the meaningful per-element formatting) are preserved.

2. **`contain: content`** on `.filing-content-root` — Creates a new containing block. Prevents filing layout/paint from affecting siblings or ancestors.

3. **`all: initial`** on `.filing-section` — Resets all inherited CSS properties to their initial values (not browser defaults — `font-size` becomes `medium` ≈16px, `color` becomes `canvastext`). This prevents Tailwind's preflight resets from affecting the filing HTML. Sections with inline styles (most real filings) will override these initials. Sections without inline styles render at browser-default-like values, which is acceptable. Verified during UAT.

4. **`overflow-x: auto`** on `.filing-section` — Wide tables get horizontal scrolling within the section rather than blowing out the panel width.

### Why not Shadow DOM?

Shadow DOM provides stronger style isolation but adds complexity:
- Event bubbling requires manual handling for scroll-to-section (US-2.4)
- `innerHTML` in shadow roots requires imperative DOM manipulation
- Testing with `@testing-library/react` doesn't pierce shadow boundaries easily
- CSS containment is sufficient for our use case — filing `<style>` blocks are already scoped to descendants

### Why not iframe?

- Cross-origin restrictions complicate communication
- Scroll synchronization (US-2.5) would require `postMessage`
- Massive overhead for what CSS containment handles

## Section Slicing Logic

### Algorithm

```
Input: document.filing.html (string), document.sections (FilingSection[])

1. If sections is non-empty AND sections[0].source.start > 0:
   → Emit preamble: { id: "section-preamble", html: stripStyleBlocks(html.slice(0, sections[0].start)) }

2. For each section in sections:
   → Emit: { id: "section-" + section.id, html: stripStyleBlocks(html.slice(section.source.start, section.source.end)) }

3. If sections is empty AND html is non-empty:
   → Emit: { id: "section-content", html: stripStyleBlocks(html) }
```

### Key properties (validated by parser tests)

- **No overlaps:** `sections[i+1].source.start >= sections[i].source.end` — guaranteed by parser
- **No gaps between sections:** Each section's `end` equals the next section's `start` — guaranteed by `buildSectionBoundaries` in the parser
- **Monotonic ordering:** Sections are sorted by `source.start` — guaranteed by parser
- **Valid offsets:** All offsets are within `[0, html.length]` — guaranteed by parser

### Preamble content

Real SEC filings have significant content before Item 1:
- SEC header boilerplate
- Company name and form type
- Table of contents

The parser intentionally skips this (emits a `parseWarning`). We render it as a `"preamble"` section so users see the complete filing.

### Subsections

Currently all sections have `subsections: []` and `level: 1`. The slicing logic ignores subsections — it only iterates the top-level `sections` array. If the parser adds subsection support later:
- Option A: Flatten subsections into the top-level list (simple)
- Option B: Nest `<section>` elements (richer DOM structure for US-2.4 nav)
- Decision deferred to when subsections are implemented

### Gap handling

The parser guarantees no gaps between consecutive sections (each section's end = next section's start). If a gap were to occur (defensive), the gap content would simply not be rendered — acceptable since it would be non-section content.

## Edge Cases

1. **No document prop** — `FilingPanel` renders the US-2.2 placeholder. No `FilingContent` rendered.

2. **Document with empty HTML** — `sliceSections` returns `[]` (the `html.length > 0` guard). `FilingContent` renders an empty `.filing-content-root` div.

3. **Document with HTML but no sections** — Entire HTML rendered as a single `<section id="section-content">`. This handles filings the parser can't section (non-10-K forms, unusual formatting).

4. **Very large HTML (1-5MB)** — `dangerouslySetInnerHTML` can handle large strings; the browser parses and renders incrementally. The `overflow-y-auto` on the parent panel provides scrolling. No virtualization needed for US-2.3 — if performance is an issue with 10MB+ filings, we can add lazy section rendering in a future story.

5. **Filing HTML with `<style>` blocks** — Stripped by `stripStyleBlocks()` in `sliceSections()` before rendering. Inline styles are preserved. This prevents global CSS leakage while retaining per-element formatting.

6. **Filing HTML with `<script>` tags** — Browsers do not execute scripts inserted via `innerHTML` (which `dangerouslySetInnerHTML` uses). Script tags will be present in the DOM but inert. No DOMPurify sanitizer is needed for US-2.3 since we use hardcoded fixture data. When live EDGAR data is introduced (US-2.9+), we should re-evaluate and consider adding DOMPurify as defense-in-depth — though EDGAR is a trusted source and event handler attributes (e.g., `onerror`) in real SEC filings are extremely unlikely.

7. **Broken/malformed HTML** — The browser's HTML parser is forgiving. `dangerouslySetInnerHTML` passes the string to the browser, which auto-corrects unclosed tags. The filing will render as well as it can.

8. **Multiple panels with different documents** — Each `FilingContent` receives its own `StructuredDocument` and slices independently. No shared state.

## Open Questions

1. **Fixture vs. real parsed data** — The fixture file uses a synthetic filing. Should we also include a small real SEC filing fixture (e.g., a few KB from a real 10-K) for more realistic visual testing? **Recommendation:** Start with synthetic for unit tests; add a small real fixture for UAT if needed.

2. **`<style>` block stripping impact** — We strip `<style>` blocks to prevent global CSS leakage. Most real SEC filings rely heavily on inline styles for formatting, so stripping `<style>` blocks should have minimal visual impact. However, some filings may use `<style>` blocks for table formatting or layout that isn't duplicated in inline styles. **Recommendation:** Verify during UAT with real filing HTML. If significant formatting is lost, consider a more targeted approach (e.g., rewriting selectors to be container-scoped).

3. **Temporal polyfill in fixture** — The `RawFiling` type uses `Temporal.PlainDate` and `Temporal.Instant`. The app already imports `@js-temporal/polyfill`. Confirm this is available in the web app's dependencies. **Recommendation:** Check `apps/web/package.json`; add if missing.

4. **Section ID uniqueness** — All DOM IDs use the `section-` prefix (e.g., `section-item-1a`, `section-preamble`). The parser normalizes section IDs to `item-*` format, so no collision with `section-preamble` or `section-content` is possible. The prefix also avoids collisions with other DOM elements.

## Implementation Checklist

1. Create `apps/web/src/fixtures/sample-filing.ts` — synthetic StructuredDocument fixture
2. Create `apps/web/src/components/filing-content.css` — CSS isolation styles
3. Create `apps/web/src/components/FilingContent.tsx` — section slicing + rendering
4. Create `apps/web/src/components/FilingContent.test.tsx` — unit tests for slicing/rendering
5. Modify `apps/web/src/components/FilingPanel.tsx` — add optional `document` prop
6. Update `apps/web/src/components/FilingPanel.test.tsx` — tests for document/placeholder states
7. Modify `apps/web/src/App.tsx` — import fixture, pass to Filing A panel
8. Update `apps/web/src/App.test.tsx` — verify fixture rendering in integration
9. Verify: `pnpm nx run web:typecheck`
10. Verify: `pnpm nx run web:lint`
11. Verify: `pnpm nx run web:test`
12. Verify: `pnpm nx run web:build`
13. Visual verification: `pnpm nx run web:dev` + Chrome DevTools MCP screenshot
