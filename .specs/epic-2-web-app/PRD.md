---
bead-id: edgar-diff-viw
title: Diff Viewer Web Application
created: "2026-03-12"
---

# Epic 2: Diff Viewer Web Application

## Overview

A web application that lets users search for a public company, select two SEC filings, and view a side-by-side diff with section navigation and word-level change highlighting. Consumes the diff library from Epic 1 (`@edgar-diff/lib`).

## Goals

- Provide a visual side-by-side diff viewer for SEC filings
- Let users search by ticker, company name, or CIK and select filings to compare
- Navigate diffs by section with change indicators
- Highlight word-level additions and deletions inline
- Render tables with cell-level diff highlighting

## Non-Goals

- LLM-powered chat or Q&A (Epic 3)
- User accounts, authentication, or saved comparisons
- Comment/annotation persistence (the mockup shows "Add Comment" buttons — these are deferred to Epic 3 or a future epic)
- Mobile-optimized layout (desktop-first)
- Offline support or PWA features
- XBRL data rendering
- Filing search beyond the SEC submissions API (no full-text search across filings)

## Target Users

- Financial analysts comparing year-over-year 10-K changes
- Legal/compliance teams reviewing disclosure updates
- Investors scanning risk factor and MD&A changes

---

## Technology Decisions

- **Framework:** React 19 with TypeScript
- **Build tool:** Vite (via `@nx/react` plugin for Nx integration)
- **Styling:** Tailwind CSS v4 (utility-first, fast iteration)
- **Routing:** React Router (single page, minimal routes needed)
- **State management:** React context + hooks (no Redux — app state is small)
- **Package location:** `apps/web` within the existing Nx monorepo
- **Library consumption:** Direct import from `@edgar-diff/lib` (workspace dependency)

---

## UI Layout (Reference: mockup.png)

```
┌─────────────────────────────────────────────────────┐
│  [Logo] Edgar-Differ                                │
├─────────────────────────────────────────────────────┤
│  Company Search: [Enter Ticker, Name, or CIK...]    │
├────────────┬────────────────────┬───────────────────┤
│  Section   │    Filing A        │    Filing B        │
│  Nav       │  [Filing selector] │  [Filing selector] │
│            │                    │                    │
│  Item 1.   │  Section content   │  Section content   │
│  Item 1A.  │  with diff         │  with diff         │
│  (2 chg)   │  highlighting      │  highlighting      │
│  Item 7.   │  (red = removed)   │  (green = added)   │
│  Item 8.   │                    │                    │
│            │                    │                    │
└────────────┴────────────────────┴───────────────────┘
```

- **Header:** App title and branding
- **Search bar:** Full-width input for company lookup
- **Section nav (left sidebar):** Lists all filing sections with change count badges
- **Filing panels (center + right):** Side-by-side scrollable content areas with filing selectors at the top and diff-highlighted content below

---

## User Stories

Stories are ordered for incremental delivery. Each story builds on the previous and produces a working, testable increment.

### Phase 1: Foundation

#### US-2.1: React App Scaffold (Tracer Bullet)

As a developer, I want a React application scaffolded in the monorepo so that I have a working starting point for the web UI.

Acceptance criteria:
- A new app exists at `apps/web` with React, TypeScript, and Vite
- `pnpm nx run web:dev` starts a dev server and renders a page in the browser
- `pnpm nx run web:build` produces a production bundle
- `pnpm nx run web:typecheck` and `pnpm nx run web:lint` pass
- The app imports and uses a type from `@edgar-diff/lib` to prove the workspace dependency works (e.g., display the library's `FormType` union in the page)
- Tailwind CSS is configured and a utility class renders correctly
- Chrome DevTools MCP is configured and working: agent can navigate to the dev server URL, capture a screenshot, and verify the page renders (this validates the visual testing pipeline for all subsequent stories)
- Chrome is installed in the devcontainer (headless mode) and the MCP server is added to `.mcp.json`

#### US-2.2: Side-by-Side Layout Skeleton

As a user, I want to see a two-panel layout with a header and section sidebar so that I can understand the app structure before any data is loaded.

Acceptance criteria:
- The page renders a header bar with "Edgar-Differ" title
- Below the header: a search bar placeholder (non-functional input)
- Below the search bar: a three-column layout — section nav sidebar (left), Filing A panel (center), Filing B panel (right)
- Each filing panel has a "Filing A" / "Filing B" heading and placeholder for a filing selector
- The layout is responsive to viewport width (panels share available space, sidebar has fixed width)
- The content areas scroll independently
- All content is hardcoded/static — no data fetching or library calls

### Phase 2: Content Rendering

#### US-2.3: Render Original Filing HTML

As a user, I want to see the original SEC filing HTML rendered in each panel so that I can read the filing exactly as it appears on EDGAR.

Acceptance criteria:
- Given a `StructuredDocument`, render the **original HTML** (from `filing.html`) in each filing panel — not a re-rendering from the structured data
- The `StructuredDocument.sections` are used to identify section boundaries (via `SourceLocation` offsets) so content can be sliced into navigable sections
- The original formatting, tables, nested HTML tags, and styling are preserved as-is
- Each section is wrapped in a container element with an ID derived from the section's `id` field (for scroll-to-section navigation)
- Content is readable within the panel (may need basic CSS resets to constrain the filing's original styles)
- Both Filing A and Filing B panels render their respective filing HTML

#### US-2.4: Section Navigation

As a user, I want a sidebar listing all sections so that I can jump to any section quickly.

Acceptance criteria:
- The sidebar lists all sections from the diff result (union of old and new filing sections)
- Each item shows the section heading (e.g., "Item 1. Business", "Item 1A. Risk Factors")
- Clicking a section scrolls both filing panels to that section
- The currently visible section is highlighted in the sidebar
- Sections that exist only in one filing are indicated (e.g., "added" or "removed" label)

### Phase 3: Diff Visualization

#### US-2.5: Paragraph Diff Highlighting

As a user, I want to see word-level changes highlighted in the filing text so that I can quickly identify what changed between filings.

The core challenge is **injecting highlight markup into the original filing HTML** using the source map locations from `StructuredDiff`. The `ParagraphDiff.sourceMapping` provides character offsets into the original HTML, and `WordChange` entries provide character offsets within paragraph text. The implementation must splice `<ins>`/`<del>` (or `<mark>`) tags into the raw HTML at these offsets while correctly handling nested HTML tags, entities, and whitespace.

Acceptance criteria:
- Given a `StructuredDiff`, highlight changes by injecting markup into the original filing HTML at the `SourceLocation` offsets
- Added words/phrases in Filing B are highlighted green
- Removed words/phrases in Filing A are highlighted red with strikethrough
- Modified paragraphs show word-level highlights (using `WordChange` offsets mapped back to HTML source positions)
- Added paragraphs (whole paragraph new in Filing B) are highlighted with a green background
- Removed paragraphs (present only in Filing A) are highlighted with a red background
- Unchanged content renders as the unmodified original HTML
- Highlight injection handles nested HTML tags gracefully (e.g., a change spanning `<b>bold</b> text` produces valid HTML)

#### US-2.6: Table Diff Highlighting

As a user, I want to see cell-level changes in tables so that I can identify which values changed.

Same approach as paragraph diff: the `TableDiff` and `CellDiff` entries provide `SourceLocation` offsets into the original HTML. Highlight markup is injected at those positions in the original table HTML rather than re-rendering the table from structured data.

Acceptance criteria:
- Changed cells are highlighted by injecting markup into the original table HTML at `CellDiff.sourceMapping` offsets (green for new values, red for old values)
- Added/removed rows are highlighted as a block
- Cell values show old → new when modified
- Original table structure (headers, colspan, rowspan, styling) is preserved — no re-rendering from structured data

#### US-2.7: Section Change Badges

As a user, I want the section nav to show change counts so that I can prioritize which sections to review.

Acceptance criteria:
- Each section in the nav shows a badge with the number of changes (paragraph + table changes)
- Sections with no changes show no badge (or a checkmark)
- Badge color indicates severity: modified (amber), added (green), removed (red)
- The diff summary totals (added/removed/modified/unchanged) are displayed above the section list

### Phase 4: Data Loading

#### US-2.8: Company Search

As a user, I want to search for a company by ticker, name, or CIK so that I can find the company whose filings I want to compare.

Acceptance criteria:
- The search bar accepts free text input
- Queries the SEC submissions API (`data.sec.gov/submissions/`) to resolve the company
- Displays the resolved company name and CIK as confirmation
- Shows an error message if the company is not found
- Handles the SEC rate limit (10 req/s) and User-Agent requirement
- Debounces input to avoid excessive API calls

Implementation note: The SEC submissions API uses CIK as the key. Ticker → CIK resolution can use the SEC's `company_tickers.json` endpoint or a bundled mapping file. This is a design decision to make during implementation.

#### US-2.9: Filing Selectors

As a user, I want to select which two filings to compare so that I can choose the specific reports I'm interested in.

Acceptance criteria:
- After a company is selected, both Filing A and Filing B show dropdown selectors
- Each dropdown lists available filings for the company, showing: form type, filing date, and fiscal period (e.g., "10-K | 09/24/2022 (FY 2021)")
- Filings are sorted by date (most recent first)
- Only supported form types are shown (10-K, 10-Q, and their amendments)
- Selecting a filing in either dropdown triggers the diff pipeline

#### US-2.10: Live Diff Pipeline

As a user, I want to select two filings and see the diff automatically so that I don't need to manually trigger any processing.

Acceptance criteria:
- When both Filing A and Filing B are selected, the app automatically: fetches both filings → parses them → computes the diff → renders the result
- A loading indicator shows during each stage (fetching, parsing, diffing)
- Errors at any stage display a user-friendly message (e.g., "Filing not available", "Parse error")
- The pipeline uses the library's `createEdgarClient`, `parseFiling`, and `diffFilings` functions
- Results are cached in memory so re-selecting a previously viewed pair doesn't re-fetch
- The SEC rate limiter is shared across all requests

### Phase 5: Polish

#### US-2.11: Synchronized Scrolling

As a user, I want the two filing panels to scroll together so that corresponding sections stay aligned as I read.

Acceptance criteria:
- Scrolling Filing A automatically scrolls Filing B to the corresponding position, and vice versa
- Scroll sync is based on section alignment (matching sections stay vertically aligned)
- A toggle button allows the user to enable/disable sync scrolling
- When sync is disabled, panels scroll independently

### Phase 6: Visual Polish

Phases 1–5 prioritize functional correctness — getting data flowing, interactions working, and features behaving correctly with minimal default styling. Phase 6 is a dedicated visual polish pass where the UI is iterated against the mockup (`mockup.png`) to match the target look and feel.

#### US-2.12: Visual Polish to Match Mockup

As a user, I want the application to look polished and match the design mockup so that it feels professional and easy to use.

Acceptance criteria:
- Layout proportions match the mockup (sidebar width, panel balance, header height)
- Typography: heading sizes, body text, section labels match the mockup's visual hierarchy
- Color scheme: diff highlight colors (red/green), background shades, borders match the mockup
- Filing selector dropdowns match the mockup's dropdown style and content layout
- Section nav styling: checkmarks, change count badges, active state highlighting match the mockup
- Spacing and padding: consistent margins, section dividers, and whitespace match the mockup
- Validated by capturing screenshots via Chrome DevTools MCP and comparing against `mockup.png`

---

## Technical Considerations

### CORS and API Access

The SEC EDGAR API does not support CORS for browser-based requests. Options:
1. **Proxy endpoint:** A lightweight server (or serverless function) that proxies EDGAR requests — simplest approach
2. **Build-time bundling:** Pre-fetch and bundle fixture data for development/demo — useful for testing but not production
3. **Service worker:** Unlikely to help with CORS

The recommended approach is a thin proxy (e.g., an Express server or Vite dev server proxy) that forwards requests to `data.sec.gov` and `www.sec.gov` with the proper User-Agent header.

### Performance

- SEC filings can be large (1–5 MB of HTML). Parsing and diffing happen in-browser using the library.
- For very large filings, consider running parse/diff in a Web Worker to avoid blocking the UI thread.
- Virtualized rendering (e.g., `react-window`) may be needed if filings have thousands of paragraphs. Evaluate during implementation and add if scroll performance degrades.

### Testing Strategy

- **Component tests:** Vitest + React Testing Library for each UI component
- **Fixture-based integration tests:** Render components with real `StructuredDocument` and `StructuredDiff` fixtures from the library's test suite
- **Visual validation via Chrome DevTools MCP:** Each story must be validated against the running dev server using the Chrome DevTools MCP server. Agents should navigate to the app, capture screenshots, and verify rendering against expectations. Chrome runs headless in the devcontainer. This replaces manual browser inspection — the agent sees what the user would see.
- **E2E tests:** Playwright for critical user flows (search → select → view diff) — deferred to a later story if scope allows

### Accessibility

- Use `<ins>` and `<del>` elements (or `<mark>` with appropriate ARIA roles) for injected diff highlights in the original HTML
- Keyboard navigation for section sidebar
- ARIA labels on diff highlights explaining the change type
- Color is not the only indicator of change type (strikethrough for removals, underline or bold for additions)

---

## Build Order & Dependencies

```
US-2.1 (Scaffold)
  └─► US-2.2 (Layout Skeleton)
        ├─► US-2.3 (Render Content)
        │     ├─► US-2.5 (Paragraph Diff)
        │     │     └─► US-2.7 (Change Badges)
        │     └─► US-2.6 (Table Diff)
        └─► US-2.4 (Section Nav)
              └─► US-2.7 (Change Badges)

US-2.8 (Company Search) ──┐
US-2.9 (Filing Selectors) ┼─► US-2.10 (Live Pipeline)
US-2.5 (Paragraph Diff) ──┘

US-2.10 (Live Pipeline) ─► US-2.11 (Sync Scrolling)
                        ─► US-2.12 (Visual Polish)
```

Phase 1–3 can be developed and validated entirely with hardcoded fixture data — no network calls needed. Phase 4 introduces live data. Phase 5 adds UX polish. Phase 6 is a dedicated visual pass against the mockup.

**Functional-first strategy:** Phases 1–5 focus on getting features working correctly with minimal default styling. Phase 6 then iterates the visuals to match the mockup. This avoids throwaway CSS work in early stages and concentrates visual iteration where it matters — when real data is rendered and the full UI can be compared to the mockup side-by-side.

**Visual validation:** Every story is validated by running the dev server and inspecting via Chrome DevTools MCP (headless Chrome). Agents capture screenshots and verify rendering, replacing manual browser inspection.

---

## Open Questions

1. **CORS proxy:** Should the proxy be a standalone Express server in `apps/proxy`, a Vite dev-server middleware, or a serverless function? This affects deployment architecture.
2. **Ticker resolution:** Bundle a static `company_tickers.json` file or query the SEC endpoint at runtime? Bundling is faster but goes stale; runtime is always current but adds a request.
3. **Web Worker for parse/diff:** Is in-browser performance acceptable for large filings, or should we move to a Web Worker from the start? Can evaluate during US-2.10 implementation.
4. **Comment feature:** The mockup shows "Add Comment" buttons. Should this be a placeholder in the UI now (non-functional) or deferred entirely to Epic 3?
