# US-2.2: Side-by-Side Layout Skeleton — Test Plan

## Overview

US-2.2 replaces the current scaffold UI with a full layout skeleton: header, search bar, and a three-column content area (section nav sidebar + two filing panels). All content is static/hardcoded — no data fetching or library integration beyond what US-2.1 already wired up.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, component composition, semantic HTML, and CSS class assertions
2. **Visual validation** (Chrome DevTools MCP screenshots) — verify actual rendered layout, spacing, scroll behavior, and responsive sizing

## Component Structure (per implementation design)

| Component | File | Props | Responsibility |
|-----------|------|-------|---------------|
| `Header` | `components/Header.tsx` | (none) | `<header>` bar with "Edgar-Differ" `<h1>` title |
| `SearchBar` | `components/SearchBar.tsx` | (none) | `<search>` wrapper with disabled text input, `aria-label` |
| `SectionNav` | `components/SectionNav.tsx` | (none) | `<nav>` sidebar with 6 hardcoded 10-K section items |
| `FilingPanel` | `components/FilingPanel.tsx` | `label: string` | Panel with `<h2>` heading, disabled `<select>`, scrollable content area |
| `App` | `App.tsx` | (none) | Layout orchestrator: `h-screen flex flex-col`, composes all components in `<main>` content row |

---

## 1. BDD Acceptance Criteria

### AC-1: Header bar with title

```gherkin
Scenario: Header renders application title
  Given the app is mounted
  When the page renders
  Then a header element is visible containing the text "Edgar-Differ"
```

### AC-2: Search bar placeholder

```gherkin
Scenario: Search bar renders with placeholder
  Given the app is mounted
  When the page renders
  Then an input element is visible with placeholder text matching "ticker", "name", or "CIK"
  And the input is non-functional (no onChange handler wired to state)
```

### AC-3: Three-column layout

```gherkin
Scenario: Three-column layout below search bar
  Given the app is mounted
  When the page renders
  Then a section navigation sidebar is present on the left
  And a "Filing A" panel is present in the center
  And a "Filing B" panel is present on the right
  And the three columns appear in that DOM order
```

### AC-4: Filing panel headings and selector placeholders

```gherkin
Scenario: Filing panels have headings and selector placeholders
  Given the app is mounted
  When the page renders
  Then the center panel contains a heading "Filing A"
  And the center panel contains a placeholder for a filing selector
  And the right panel contains a heading "Filing B"
  And the right panel contains a placeholder for a filing selector
```

### AC-5: Responsive layout — panels share available space

```gherkin
Scenario: Sidebar has fixed width, panels share remaining space
  Given the app is mounted
  When the viewport is at default width
  Then the sidebar has a fixed width (w-60, 240px)
  And the filing panels each have flex-1 or equivalent to share remaining space

Scenario: Layout degrades gracefully at narrow viewport
  Given the app is mounted
  When the viewport is very narrow (< 640px)
  Then the layout does not overflow or produce horizontal scrollbars
  (Note: specific responsive breakpoint behavior is a visual validation item)
```

### AC-6: Independent scrolling

```gherkin
Scenario: Content areas scroll independently
  Given the app is mounted
  When the page renders
  Then each filing panel has overflow-auto or overflow-y-auto CSS
  And the section nav sidebar has overflow-auto or overflow-y-auto CSS
  And the outer page does not scroll (layout fills viewport height)
```

### AC-7: Static content only

```gherkin
Scenario: No data fetching occurs
  Given the app is mounted
  When the page renders
  Then no fetch/XHR calls are made
  And all displayed content is hardcoded
```

---

## 2. Unit Tests

### `Header.test.tsx`

```typescript
describe('Header', () => {
  it('renders within a <header> semantic element', () => {
    render(<Header />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('displays "Edgar-Differ" as the title', () => {
    render(<Header />);
    expect(screen.getByText('Edgar-Differ')).toBeInTheDocument();
  });
});
```

### `SearchBar.test.tsx`

```typescript
describe('SearchBar', () => {
  it('renders a text input with search placeholder', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('input is disabled (non-functional placeholder)', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeDisabled();
  });

  it('wraps input in a search landmark', () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('input has aria-label for accessibility', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toHaveAttribute('aria-label');
  });
});
```

### `SectionNav.test.tsx`

```typescript
describe('SectionNav', () => {
  it('renders within a <nav> semantic element', () => {
    render(<SectionNav />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('displays placeholder section items', () => {
    render(<SectionNav />);
    // 6 hardcoded 10-K section items per implementation design
    expect(screen.getByText('Item 1. Business')).toBeInTheDocument();
    expect(screen.getByText('Item 1A. Risk Factors')).toBeInTheDocument();
  });

  it('renders section items as buttons in a list', () => {
    render(<SectionNav />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    // Items are in <ul>/<li> for list semantics
    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
  });

  it('has overflow styling for independent scroll', () => {
    const { container } = render(<SectionNav />);
    const nav = container.querySelector('nav');
    expect(nav?.className).toMatch(/overflow/);
  });
});
```

### `FilingPanel.test.tsx`

```typescript
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

  it('has overflow styling for independent scroll', () => {
    const { container } = render(<FilingPanel label="Filing A" />);
    // The scrollable content area should have overflow-auto
    const scrollable = container.querySelector('[class*="overflow"]');
    expect(scrollable).not.toBeNull();
  });

  it('renders Filing B with correct heading', () => {
    render(<FilingPanel label="Filing B" />);
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });
});
```

---

## 3. Integration Tests (App Composition)

### `App.test.tsx`

These tests replace the existing US-2.1 smoke tests. The title test is preserved; the FormType test is removed since the form-type badge list is no longer part of the UI.

```typescript
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
    const search = container.querySelector('search, [role="search"]');
    const main = container.querySelector('main');

    expect(header).not.toBeNull();
    expect(search).not.toBeNull();
    expect(main).not.toBeNull();

    // Verify DOM order using compareDocumentPosition
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
    // Should have: nav (sidebar) + 2 filing panels
    const nav = screen.getByRole('navigation');
    const filingA = screen.getByText('Filing A');
    const filingB = screen.getByText('Filing B');

    expect(nav).toBeInTheDocument();
    expect(filingA).toBeInTheDocument();
    expect(filingB).toBeInTheDocument();

    // Verify DOM order: nav before Filing A before Filing B
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
});
```

---

## 4. Layout & Scroll Tests (CSS Class Assertions)

jsdom does not compute CSS layout. These tests assert that the correct CSS classes are applied — actual rendering is validated visually.

### Layout structure assertions (in `App.test.tsx`)

```typescript
describe('App layout classes', () => {
  it('sidebar has fixed-width class', () => {
    const { container } = render(<App />);
    const nav = container.querySelector('nav');
    // Expect a Tailwind fixed-width class like w-48, w-56, w-64, etc.
    expect(nav?.className).toMatch(/w-\d+|w-\[/);
  });

  it('content row uses flex layout within <main>', () => {
    const { container } = render(<App />);
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main?.className).toMatch(/flex/);
  });

  it('layout fills viewport height', () => {
    const { container } = render(<App />);
    const root = container.firstElementChild;
    // Should have h-screen or min-h-screen
    expect(root?.className).toMatch(/h-screen|min-h-screen/);
  });

  it('content areas have overflow classes for independent scroll', () => {
    const { container } = render(<App />);
    const nav = container.querySelector('nav');
    // Nav and panel content areas should have overflow-auto or overflow-y-auto
    expect(nav?.className).toMatch(/overflow/);

    // Filing panels — find the scrollable containers
    const scrollables = container.querySelectorAll('[class*="overflow-auto"], [class*="overflow-y-auto"]');
    // At minimum: sidebar + 2 filing panels = 3 scrollable areas
    expect(scrollables.length).toBeGreaterThanOrEqual(3);
  });
});
```

### What jsdom CANNOT test (see Section 8)

- Actual scroll position or scroll events
- Computed CSS widths (fixed sidebar vs flex panels)
- Visual layout (columns side by side vs stacked)
- Responsive breakpoints

---

## 5. Accessibility Considerations

### Tests to write

```typescript
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
    // Prefer aria-label or associated <label> for screen readers
    expect(
      input.getAttribute('aria-label') ?? input.closest('[role="search"]')
    ).toBeTruthy();
  });

  it('filing panels have heading hierarchy', () => {
    render(<App />);
    // Filing A and Filing B should be headings (h2 or h3)
    const headings = screen.getAllByRole('heading');
    const filingHeadings = headings.filter(
      h => h.textContent === 'Filing A' || h.textContent === 'Filing B'
    );
    expect(filingHeadings).toHaveLength(2);
  });
});
```

### Accessibility guidance for implementation
- `<header>` wraps the title bar (landmark: banner)
- `<nav>` wraps the section navigation sidebar (landmark: navigation)
- `<main>` wraps the three-column content area (landmark: main)
- Search input should have `role="search"` on its container or `aria-label`
- Filing panel headings should use `<h2>` (since the app title is `<h1>`)
- Nav items should use `<ul>/<li>` for list semantics

---

## 6. Visual Validation Strategy (Chrome DevTools MCP)

These are **manual agent steps** during implementation, not automated tests.

### Screenshots to take

| Checkpoint | What to verify |
|-----------|---------------|
| Default viewport (1280x800) | Three columns visible; sidebar on left, two equal filing panels |
| Header + search bar | Title "Edgar-Differ" visible, search input spans full width |
| Filing panels | "Filing A" and "Filing B" headings visible with selector placeholders |
| Section nav | Sidebar with placeholder items (Item 1., Item 1A., etc.) |
| Narrow viewport (640x800) | Layout doesn't break; no horizontal overflow |
| Very narrow viewport (375x800) | Mobile-like width; verify graceful degradation |
| Tall content scroll | Add enough placeholder content to trigger scroll; verify panels scroll independently |

### Process

1. Start dev server: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
2. Navigate MCP browser to `http://localhost:5173`
3. Take screenshots at each checkpoint above
4. Verify visual appearance matches the PRD wireframe
5. Resize viewport and re-screenshot for responsive checks

---

## 7. Test Data / Fixtures

This is a static layout story — **no fixtures needed**.

All content is hardcoded in the components:
- Title: `"Edgar-Differ"`
- Search placeholder: `"Search by company name, ticker, or CIK..."`
- Section nav heading: `"Sections"`
- Section nav items (6 total): `"Item 1. Business"`, `"Item 1A. Risk Factors"`, `"Item 2. Properties"`, `"Item 7. MD&A"`, `"Item 7A. Quant. Disclosures"`, `"Item 8. Financial Statements"`
- Filing panel headings: `"Filing A"`, `"Filing B"`
- Filing selector: disabled `<select>` with option `"Select a filing..."`
- Content placeholder: `"Filing content will appear here"`

No mock data, API mocks, or test utilities beyond `@testing-library/react` are required.

---

## 8. Testing Limitations (jsdom)

### What jsdom CANNOT do

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS layout engine | Cannot verify columns are side-by-side | Assert flex/grid classes; verify visually via MCP |
| No computed styles | Cannot check actual sidebar width in px | Assert Tailwind width class (`w-60`) |
| No scroll rendering | Cannot test independent scroll behavior | Assert `overflow-auto` classes; verify scroll visually via MCP |
| No responsive breakpoints | Cannot test layout at different viewports | Assert responsive utility classes; test breakpoints via MCP resize |
| No visual regression | Cannot compare pixel output | Use MCP screenshots as informal visual checkpoints |

### What jsdom CAN do (and we test thoroughly)

- DOM structure and element existence
- Text content and ARIA attributes
- CSS class presence (Tailwind utility classes)
- DOM ordering (via `compareDocumentPosition`)
- Semantic HTML landmarks (`role` queries)
- Component composition (App renders all sub-components)

### Strategy summary

**Programmatic tests** cover structure, semantics, and class-based layout intent. **MCP screenshots** cover actual visual appearance. Together they provide high confidence that the layout is correct without needing a browser-based test runner like Playwright (which would be overkill for a static layout skeleton).

---

## 9. Test File Organization

```
apps/web/src/
  components/
    Header.test.tsx          # Unit: Header component
    SearchBar.test.tsx       # Unit: SearchBar component
    SectionNav.test.tsx      # Unit: SectionNav component
    FilingPanel.test.tsx     # Unit: FilingPanel component
  App.test.tsx               # Integration: composition, layout, a11y
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 10. Migrating from US-2.1 Tests

The existing `App.test.tsx` has two tests:
1. `renders the title` — **keep and enhance** (add `getByRole('banner')` assertion)
2. `renders FormType values from the library` — **remove** (the form-type badge list is replaced by the new layout; the `@edgar-diff/lib` integration is still validated by the build/typecheck, not by UI rendering)

This is a clean replacement, not an additive change.
