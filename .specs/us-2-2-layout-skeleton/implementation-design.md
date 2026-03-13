# US-2.2: Side-by-Side Layout Skeleton — Implementation Design

## Approach

Replace the current `App.tsx` (which renders a flat list of `FormType` values) with a full-viewport, three-column layout comprising a header, search bar, and content area with section nav sidebar and two filing panels.

**Key design decisions:**

1. **Decompose into separate component files** — Five components, each in its own file under `apps/web/src/components/`. Future stories (US-2.3 through US-2.9) each target a specific region of the layout (section nav, filing panels, search bar), so isolating them now avoids churning `App.tsx` on every subsequent story.

2. **Flexbox over CSS Grid** — The layout is a simple column stack (header → search → content row). The content row is three columns: fixed-width sidebar, two equal-width panels. Flexbox handles this naturally with `flex-1` for equal distribution and explicit widths for the sidebar. Grid would add complexity without benefit.

3. **Remove `@edgar-diff/lib` import** — US-2.2 is static-only. The `FormType` import was a US-2.1 tracer-bullet artifact. Remove it to keep the component clean. The dependency stays in `package.json` for US-2.3+.

4. **No additional CSS beyond Tailwind utilities** — All layout and styling achievable with Tailwind v4 utility classes. No custom CSS needed in `index.css`.

5. **Full viewport height with independent panel scrolling** — `h-screen` on the root, `flex-col` to stack header/search/content, `overflow-hidden` on the content row with `overflow-y-auto` on each scrollable region.

## Component Hierarchy

```
App
├── Header          (<header> — banner landmark)
├── SearchBar       (<div role="search"> — search landmark)
└── <main>          (main landmark, flex row)
    ├── SectionNav  (<nav> — navigation landmark)
    ├── FilingPanel (label="Filing A")
    └── FilingPanel (label="Filing B")
```

`App.tsx` remains the layout orchestrator. It composes the components but contains no business logic.

## Files to Create

### `apps/web/src/components/Header.tsx`

Static header bar with app title.

```tsx
export function Header() {
  return (
    <header className="flex items-center h-14 px-6 bg-white border-b border-gray-200 shrink-0">
      <h1 className="text-xl font-bold text-gray-900">Edgar-Differ</h1>
    </header>
  );
}
```

**Rationale:** Fixed 56px height (`h-14`), `shrink-0` prevents flex compression. White background with bottom border separates it from content. US-2.12 (visual polish) will adjust sizing/colors later.

### `apps/web/src/components/SearchBar.tsx`

Non-functional search input placeholder.

```tsx
export function SearchBar() {
  return (
    <div role="search" className="px-6 py-3 bg-white border-b border-gray-200 shrink-0">
      <input
        type="text"
        placeholder="Search by company name, ticker, or CIK..."
        aria-label="Search by company name, ticker, or CIK"
        disabled
        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
      />
    </div>
  );
}
```

**Rationale:** `disabled` + `cursor-not-allowed` makes it clear the input is non-functional. `role="search"` on the wrapper and `aria-label` on the input provide accessible landmarks for screen readers. US-2.8 will replace this with a live search component. The `shrink-0` prevents flex compression.

### `apps/web/src/components/SectionNav.tsx`

Left sidebar with hardcoded section list.

```tsx
interface SectionNavItem {
  id: string;
  label: string;
}

const placeholderSections: SectionNavItem[] = [
  { id: 'item-1', label: 'Item 1. Business' },
  { id: 'item-1a', label: 'Item 1A. Risk Factors' },
  { id: 'item-2', label: 'Item 2. Properties' },
  { id: 'item-7', label: 'Item 7. MD&A' },
  { id: 'item-7a', label: 'Item 7A. Quant. Disclosures' },
  { id: 'item-8', label: 'Item 8. Financial Statements' },
];

export function SectionNav() {
  return (
    <nav className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Sections
        </h2>
        <ul className="space-y-1">
          {placeholderSections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
              >
                {section.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
```

**Rationale:**
- Fixed width `w-60` (240px) — narrow enough to leave filing panels ample space, wide enough for section names. `shrink-0` prevents flex compression.
- `overflow-y-auto` for independent scroll when there are many sections.
- `<button>` elements (not `<a>`) because US-2.4 will attach click-to-scroll handlers. Using buttons from the start avoids an element swap later and is semantically correct for in-page actions.
- The `SectionNavItem` interface is intentionally simple. US-2.4 will add an `active` state and US-2.7 will add `changeCount` / `changeType` for badges.

### `apps/web/src/components/FilingPanel.tsx`

Filing panel used for both Filing A and Filing B.

```tsx
interface FilingPanelProps {
  label: string;
}

export function FilingPanel({ label }: FilingPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Panel header with filing selector placeholder */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{label}</h2>
        <select
          disabled
          className="w-full px-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
        >
          <option>Select a filing...</option>
        </select>
      </div>
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-gray-400 italic">
          Filing content will appear here
        </p>
      </div>
    </div>
  );
}
```

**Rationale:**
- `flex-1` makes both panels share available width equally.
- `min-w-0` prevents flex items from refusing to shrink below their content's intrinsic width (a common flexbox gotcha with text content).
- Panel header is `shrink-0` (fixed), content area is `flex-1 overflow-y-auto` (scrollable).
- `<select disabled>` placeholder for the filing selector — US-2.9 will replace with a functional dropdown.
- The `label` prop distinguishes "Filing A" from "Filing B". US-2.3 will add a `content` prop (or children) for rendered filing HTML.

## Files to Modify

### `apps/web/src/App.tsx`

Complete rewrite. Replaces the current FormType listing with the layout shell.

```tsx
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';

export function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav />
        <FilingPanel label="Filing A" />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel label="Filing B" />
      </main>
    </div>
  );
}
```

**Rationale:**
- `h-screen flex flex-col` establishes the full-viewport column layout.
- `<main>` wraps the content area, providing the `role="main"` landmark for accessibility (header is `<header>`, sidebar is `<nav>`, content is `<main>`).
- Header and SearchBar are `shrink-0` (defined in their own classes), so the content row gets all remaining space via `flex-1`.
- `overflow-hidden` on the content row prevents the entire page from scrolling — each panel scrolls independently.
- A 1px vertical divider (`w-px bg-gray-200`, `aria-hidden="true"`) separates the two filing panels visually.

### `apps/web/src/App.test.tsx`

Update tests to verify the new layout renders correctly. Uses `toBeInTheDocument()` from jest-dom (already configured via `test-setup.ts`) and semantic landmark queries.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the header with app title', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('Edgar-Differ')).toBeInTheDocument();
  });

  it('renders the search bar placeholder', () => {
    render(<App />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by company/i)).toBeInTheDocument();
  });

  it('renders section navigation', () => {
    render(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Item 1. Business')).toBeInTheDocument();
  });

  it('renders both filing panels', () => {
    render(<App />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });

  it('renders filing selector placeholders', () => {
    render(<App />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
  });

  it('wraps content area in a main landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
```

**Note:** The test plan (separate document) contains additional unit tests per component and more detailed layout/accessibility assertions. The tests shown here are the integration-level smoke tests in `App.test.tsx`.

## Component Interfaces

All interfaces are intentionally minimal for US-2.2. Notes on planned evolution:

| Component | Current Props | Future Evolution |
|-----------|--------------|------------------|
| `Header` | (none) | Could add navigation or user info in future epics |
| `SearchBar` | (none) | US-2.8: `onSearch(query: string)`, `results`, `isLoading` |
| `SectionNav` | (none) | US-2.4: `sections: Section[]`, `activeId: string`, `onSelect(id: string)` |
| `FilingPanel` | `label: string` | US-2.3: `content: string` (HTML), US-2.9: `filings: Filing[]`, `onSelect(filing: Filing)` |

The static hardcoded data lives inside each component for now. When data becomes dynamic, the data moves to `App.tsx` (or a context provider) and flows down via props.

## Layout Strategy

### Full Viewport Layout

```
┌─────────────────────────────────────── h-screen ──┐
│ <header>  Header              shrink-0, h-14      │
│ <search>  SearchBar           shrink-0             │
│ ┌──────────────────── <main> flex-1 ──────────────┐│
│ │ <nav>      │ FilingPanel A │ │ FilingPanel B    ││
│ │ SectionNav │ flex-1        │ │ flex-1           ││
│ │ w-60       │ overflow-     │ │ overflow-        ││
│ │ overflow-  │ y-auto        │ │ y-auto           ││
│ │ y-auto     │               │ │                  ││
│ └────────────┴───────────────┴─┴──────────────────┘│
└────────────────────────────────────────────────────┘
```

### Key CSS Patterns

1. **No page scroll:** `h-screen` + `flex flex-col` + `overflow-hidden` on content row
2. **Fixed sidebar:** `w-60 shrink-0` — 240px, won't compress
3. **Equal panels:** Both `flex-1` — share remaining width 50/50
4. **Independent scroll:** Each `overflow-y-auto` region scrolls on its own
5. **Panel header pinned:** Within each `FilingPanel`, the selector is `shrink-0` and content is `flex-1 overflow-y-auto`

### Responsive Behavior

The layout is **desktop-first** (per PRD non-goals: "Mobile-optimized layout — desktop-first"). At narrow viewports:
- The sidebar stays at 240px; panels compress equally
- Below ~768px the panels become very narrow — acceptable for this story since the PRD explicitly excludes mobile optimization
- Future US-2.12 (visual polish) may add a breakpoint to stack or collapse the sidebar

No `@media` queries needed for US-2.2.

## Data Flow

```
App.tsx (layout orchestrator)
├── Header          ← no props, static
├── SearchBar       ← no props, static
├── SectionNav      ← no props, internal hardcoded data
├── FilingPanel     ← label="Filing A"
└── FilingPanel     ← label="Filing B"
```

**Current:** All data is hardcoded inside each component. No state, no context, no effects.

**Future progression:**
1. **US-2.3–2.4:** `App.tsx` receives structured document data and passes it down as props. Likely introduces `useState` for selected section.
2. **US-2.8–2.9:** `App.tsx` introduces state for company, filing selections, and diff results. May introduce a context provider if prop drilling gets deep.
3. **US-2.10:** State management for the diff pipeline (loading states, error handling, caching).

The component boundaries chosen here align with these data flow needs — each component will receive its data through a single, focused prop interface.

## Edge Cases

1. **Very narrow viewport (<600px):** Panels will be squeezed but remain functional. No special handling — desktop-first design.
2. **Very tall viewport:** Content area grows; panels have more scroll space. No issue.
3. **Empty states:** Already handled — each panel shows "Filing content will appear here" placeholder text. The section nav shows a static list.
4. **No JavaScript:** The layout is purely React — no SSR or progressive enhancement. Acceptable for a developer tool.
5. **Content overflow in panel header:** Long filing selector text is constrained by `w-full` and truncated by the select element's native behavior.

## Open Questions

1. **Panel divider interaction:** Should the divider between Filing A and Filing B be resizable (drag to adjust panel widths)? The PRD doesn't mention this. **Recommendation:** Not for US-2.2. A static divider is simpler and matches the AC. Can be added in US-2.12 if desired.

2. **Sidebar collapse:** Should there be a toggle to hide/show the section nav sidebar? **Recommendation:** Defer to US-2.12 (visual polish). Not in the AC for US-2.2.

## Implementation Checklist

1. Create `apps/web/src/components/Header.tsx`
2. Create `apps/web/src/components/SearchBar.tsx`
3. Create `apps/web/src/components/SectionNav.tsx`
4. Create `apps/web/src/components/FilingPanel.tsx`
5. Rewrite `apps/web/src/App.tsx` (layout shell)
6. Update `apps/web/src/App.test.tsx` (new layout tests)
7. Verify: `pnpm nx run web:typecheck`
8. Verify: `pnpm nx run web:lint`
9. Verify: `pnpm nx run web:test`
10. Verify: `pnpm nx run web:build`
11. Visual verification: `pnpm nx run web:dev` → Chrome DevTools MCP screenshot
