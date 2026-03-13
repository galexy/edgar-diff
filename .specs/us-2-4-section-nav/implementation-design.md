# US-2.4: Section Navigation — Implementation Design

## Approach

Replace the hardcoded placeholder sections in `SectionNav` with data-driven rendering from `SectionDiff[]`, add click-to-scroll behavior that synchronizes both filing panels, track the currently visible section via `IntersectionObserver`, and display added/removed labels for sections that exist in only one filing.

**Key design decisions:**

1. **App owns all coordination state** — `App.tsx` holds the `activeSectionId` state and the scroll handler. SectionNav is a pure presentational component that receives data and fires callbacks. This keeps state management centralized and avoids prop-drilling issues.

2. **Refs for programmatic scrolling** — Each `FilingPanel` exposes its scroll container via `React.forwardRef` (or a callback ref). App holds refs to both panels and calls `element.scrollIntoView()` on the target `<section id={sectionId}>` within each container when a nav item is clicked.

3. **IntersectionObserver for active section tracking** — A custom `useActiveSection` hook observes all `<section>` elements within a scroll container and reports which section is most visible. The hook runs in one panel (the "old" panel by default) to avoid conflicting signals from two observers.

4. **Flat section list (no nesting)** — `SectionDiff` has `subsectionDiffs`, but for V1 we render a flat list of top-level sections only. Subsection navigation can be added in a future story. This simplifies the UI and matches the acceptance criteria ("lists all sections from the diff result").

5. **Change type labels from SectionDiff.changeType** — Sections with `changeType === 'added'` get an "Added" badge; `'removed'` gets a "Removed" badge. All other change types (modified, unchanged, reordered, moved) render without a badge — they exist in both filings.

## Component Hierarchy

```
App
├── Header
├── SearchBar
└── <main>
    ├── SectionNav
    │     props: { sections, activeSectionId, onSectionClick }
    │     renders: <nav> with <ul> of section buttons
    │              active section gets highlight styling
    │              added/removed sections get badge labels
    │
    ├── FilingPanel (ref={oldPanelRef}, label="Filing A", ...)
    │   └── scrollable div (ref target for programmatic scroll)
    │       └── FilingContent
    │           └── <section id="item-1"> ← IntersectionObserver targets
    │           └── <section id="item-1a">
    │           └── ...
    │
    ├── Divider
    │
    └── FilingPanel (ref={newPanelRef}, label="Filing B", ...)
        └── scrollable div
            └── FilingContent
                └── <section id="item-1">
                └── ...
```

## Files to Modify

### `apps/web/src/components/SectionNav.tsx`

**Changes:** Accept props instead of using hardcoded data. Render from `SectionNavItem[]`. Add click handler, active state styling, and change-type badges.

```tsx
import type { ChangeType } from '@edgar-diff/lib';

export interface SectionNavItem {
  id: string;
  heading: string;
  changeType: ChangeType;
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick?: (sectionId: string) => void;
}

export function SectionNav({ sections, activeSectionId, onSectionClick }: SectionNavProps) {
  return (
    <nav
      className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto"
      aria-labelledby="section-nav-heading"
    >
      <div className="p-4">
        <h2
          id="section-nav-heading"
          className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3"
        >
          Sections
        </h2>
        {sections.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No sections</p>
        ) : (
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={section.id === activeSectionId ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                    section.id === activeSectionId
                      ? 'bg-blue-100 text-blue-900 font-medium'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                  onClick={() => onSectionClick?.(section.id)}
                >
                  <span className="block truncate">{section.heading}</span>
                  {section.changeType === 'added' && (
                    <span className="inline-block mt-0.5 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                      Added
                    </span>
                  )}
                  {section.changeType === 'removed' && (
                    <span className="inline-block mt-0.5 text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                      Removed
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
```

**Rationale:**
- `SectionNavItem` is derived from `SectionDiff` (just `id`, `heading`, `changeType`) — the nav doesn't need paragraph diffs or source mappings. The type is exported so tests can import it directly.
- `aria-labelledby="section-nav-heading"` links the `<nav>` landmark to its visible heading, allowing screen readers to distinguish it from other `<nav>` elements on the page.
- `aria-current="true"` on the active button provides accessibility semantics for screen readers.
- `truncate` on the heading handles long section names gracefully.
- Badge text uses capitalized form ("Added"/"Removed") for badge UI consistency. The visible text is inherently accessible to screen readers — no additional `aria-label` needed.
- Empty state ("No sections") handles the edge case of no section diffs.

### `apps/web/src/components/FilingPanel.tsx`

**Changes:** Use `React.forwardRef` to expose the scroll container `<div>` ref to the parent. This lets `App` call `scrollIntoView()` on section elements within the panel.

```tsx
import { forwardRef } from 'react';
import type { StructuredDocument, SectionDiff } from '@edgar-diff/lib';
import type { Side } from '../lib/highlight-injector';
import { FilingContent } from './FilingContent';

interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
  sectionDiffs?: SectionDiff[];
  side?: Side;
}

export const FilingPanel = forwardRef<HTMLDivElement, FilingPanelProps>(
  function FilingPanel({ label, document, sectionDiffs, side }, ref) {
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
        <div ref={ref} className="flex-1 overflow-y-auto p-4">
          {document ? (
            <FilingContent document={document} sectionDiffs={sectionDiffs} side={side} />
          ) : (
            <p className="text-sm text-gray-400 italic">
              Filing content will appear here
            </p>
          )}
        </div>
      </div>
    );
  }
);
```

**Rationale:**
- The `ref` is attached to the scrollable `<div>`, not the outer container. This is the element we need for `querySelector` + `scrollIntoView()`.
- `forwardRef` is the standard React pattern for exposing DOM refs to parent components. The existing component is a simple function, so wrapping it adds minimal complexity.
- No other changes to FilingPanel's rendering logic.

### `apps/web/src/App.tsx`

**Changes:**
- Derive `SectionNavItem[]` from `sampleDiffs` (map each `SectionDiff` to `{ id, heading, changeType }`).
- Create refs for both FilingPanel scroll containers.
- Add `handleSectionClick` that scrolls both panels to the target section and optimistically sets the active section.
- Add `useActiveSection` hook wired to the old panel's scroll container.
- Merge optimistic click state with observer-driven state for `activeSectionId`.
- Pass all props to `SectionNav`.

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';
import { useActiveSection } from './hooks/useActiveSection';
import { sampleDocument } from './fixtures/sample-filing';
import { buildSampleDiffs } from './fixtures/sample-diff';

export function App() {
  const sampleDiffs = useMemo(() => buildSampleDiffs(sampleDocument), []);

  const sections = useMemo(
    () => sampleDiffs.map((sd) => ({ id: sd.id, heading: sd.heading, changeType: sd.changeType })),
    [sampleDiffs],
  );

  const oldPanelRef = useRef<HTMLDivElement>(null);
  const newPanelRef = useRef<HTMLDivElement>(null);

  // Observer-driven active section (updates as user scrolls)
  const observedSectionId = useActiveSection(oldPanelRef);

  // Optimistic active section (set immediately on click for instant feedback)
  const [optimisticSectionId, setOptimisticSectionId] = useState<string | undefined>();

  // Observer takes precedence once it fires — it "confirms" or "corrects" the optimistic state.
  // The optimistic value provides instant visual feedback before the observer catches up.
  const activeSectionId = observedSectionId ?? optimisticSectionId;

  const handleSectionClick = useCallback((sectionId: string) => {
    // Optimistically highlight the clicked section immediately
    setOptimisticSectionId(sectionId);

    for (const ref of [oldPanelRef, newPanelRef]) {
      const container = ref.current;
      if (!container) continue;
      const target = container.querySelector(`#${CSS.escape(sectionId)}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav
          sections={sections}
          activeSectionId={activeSectionId}
          onSectionClick={handleSectionClick}
        />
        <FilingPanel
          ref={oldPanelRef}
          label="Filing A"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="old"
        />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel
          ref={newPanelRef}
          label="Filing B"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="new"
        />
      </main>
    </div>
  );
}
```

**Rationale:**
- **Optimistic active update:** The click handler sets `optimisticSectionId` immediately for instant visual feedback. The observer then "confirms" or "corrects" this once the scroll settles. `observedSectionId ?? optimisticSectionId` means the observer takes precedence once it fires — the optimistic value is only used in the gap before the first observer callback.
- `CSS.escape(sectionId)` prevents query selector injection from section IDs with special characters.
- `scrollIntoView({ behavior: 'smooth', block: 'start' })` provides smooth scroll animation and positions the section at the top of the viewport.
- `useActiveSection` is wired to `oldPanelRef` only — both panels show the same sections in the same order, so observing one is sufficient.

### `apps/web/src/hooks/useActiveSection.ts` (NEW)

Custom hook that uses `IntersectionObserver` to track which section is currently most visible in a scroll container.

```tsx
import { useEffect, useState, type RefObject } from 'react';

/**
 * Observe <section> elements within a scrollable container and return
 * the id of the section currently most visible in the viewport.
 *
 * Uses IntersectionObserver with a rootMargin that favors the top of
 * the scroll container — when multiple sections are visible, the one
 * closest to the top "wins".
 */
export function useActiveSection(
  containerRef: RefObject<HTMLDivElement | null>,
): string | undefined {
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Collect all <section> elements with an id inside the container
    const sections = container.querySelectorAll<HTMLElement>('section[id]');
    if (sections.length === 0) return;

    // Track intersection ratios for each section
    const ratioMap = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          ratioMap.set(id, entry.intersectionRatio);
        }

        // Find the section with the highest intersection ratio.
        // Tie-break: first in DOM order. Map.set() updates existing entries
        // without changing iteration order, so the for...of loop preserves
        // the original DOM order established by querySelectorAll.
        let bestId: string | undefined;
        let bestRatio = 0;
        for (const [id, ratio] of ratioMap) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }

        // When all sections have ratio 0 (e.g., user scrolled to preamble),
        // clear the active section so no nav item is highlighted.
        if (bestRatio === 0) {
          setActiveSectionId(undefined);
        } else if (bestId) {
          setActiveSectionId(bestId);
        }
      },
      {
        root: container,
        // Multiple thresholds for finer-grained ratio tracking
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, [containerRef]);

  return activeSectionId;
}
```

**Rationale:**
- `root: container` scopes observation to the scroll container, not the viewport. This is critical because the panels are scrollable divs, not the page itself.
- Multiple thresholds (`[0, 0.1, 0.25, 0.5, 0.75, 1.0]`) provide granular ratio updates so the "most visible" calculation is responsive.
- The `ratioMap` approach handles the common case where multiple sections are partially visible — the one with the largest visible area is considered active.
- When all sections have ratio 0 (user scrolled to preamble or above all sections), the hook clears `activeSectionId` to `undefined` so no nav item is highlighted.
- The hook re-runs when `containerRef` changes (stable ref, so effectively once). The observer observes the initial set of sections; if sections change dynamically (not expected in this story), a `MutationObserver` could be added later. This is a known V1 limitation — acceptable for static sample data.

## Interfaces and Types

### Props contracts

| Component | Props | Notes |
|-----------|-------|-------|
| `SectionNav` | `{ sections: SectionNavItem[], activeSectionId?: string, onSectionClick?: (id: string) => void }` | Fully controlled presentational component |
| `FilingPanel` | `{ label, document?, sectionDiffs?, side? }` + `ref: Ref<HTMLDivElement>` | `forwardRef` exposes scroll container |

### New types

```typescript
// In SectionNav.tsx (exported for use by App and tests)
export interface SectionNavItem {
  id: string;
  heading: string;
  changeType: ChangeType;  // from @edgar-diff/lib
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick?: (sectionId: string) => void;
}
```

### Key library types consumed

| Type | From | Usage |
|------|------|-------|
| `SectionDiff` | `@edgar-diff/lib` | Source of section data; mapped to `SectionNavItem` in App |
| `ChangeType` | `@edgar-diff/lib` | Used to determine added/removed badge display |

## Data Flow

```
                    ┌──────────────────────────────────┐
                    │             App.tsx               │
                    │                                  │
                    │  sampleDiffs: SectionDiff[]       │
                    │  sections: SectionNavItem[]       │
                    │  observedSectionId (from hook)    │
                    │  optimisticSectionId (from click) │
                    │  activeSectionId = observed ??    │
                    │                    optimistic     │
                    │  oldPanelRef, newPanelRef          │
                    └──────┬───────┬───────┬────────────┘
                           │       │       │
              ┌────────────┘       │       └────────────┐
              ▼                    ▼                     ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │   SectionNav    │  │  FilingPanel A   │  │  FilingPanel B   │
    │                 │  │  ref={oldPanelRef}│  │  ref={newPanelRef}│
    │  sections ──────│  │                 │  │                 │
    │  activeSectionId│  │  scrollable div  │  │  scrollable div  │
    │  onSectionClick │  │  └─ <section>s  │  │  └─ <section>s  │
    └────────┬────────┘  └────────┬────────┘  └─────────────────┘
             │                    │
             │ click              │ IntersectionObserver
             │                    │
             ▼                    ▼
    handleSectionClick()    useActiveSection(oldPanelRef)
    ├─ setOptimistic(id)       ├─ observes <section> elements
    ├─ querySelector('#id')    ├─ tracks intersection ratios
    │  in oldPanelRef          └─ returns observedSectionId
    ├─ querySelector('#id')
    │  in newPanelRef
    └─ scrollIntoView()
       on both targets
```

### Flow 1: Click to scroll
1. User clicks section in `SectionNav`
2. `onSectionClick(sectionId)` fires
3. `App.handleSectionClick` sets `optimisticSectionId` immediately — the nav item highlights instantly
4. Handler finds the `<section id={sectionId}>` element in both panel refs
5. Calls `scrollIntoView({ behavior: 'smooth' })` on both elements
6. Both panels scroll to the target section simultaneously
7. `IntersectionObserver` detects the new section and updates `observedSectionId`, which takes precedence over the optimistic value

### Flow 2: Scroll to highlight
1. User scrolls in either panel (or after click-to-scroll completes)
2. `IntersectionObserver` in `useActiveSection` fires for sections entering/leaving the viewport
3. Hook updates `activeSectionId` to the section with the highest intersection ratio
4. React re-renders `SectionNav` with the new `activeSectionId`
5. The active section button gets highlight styling (`bg-blue-100`)

### Flow 3: Added/removed sections
1. `SectionDiff.changeType` is `'added'` or `'removed'`
2. `sections` array in App includes this section with its `changeType`
3. `SectionNav` renders the appropriate badge label
4. On click, scroll behavior works the same — but for a `removed` section, the element may not exist in the "new" panel (and vice versa for `added`)
5. `querySelector` returns `null` for the missing side → `scrollIntoView()` is not called → only the panel containing the section scrolls

## Dependencies

- **No new external libraries required.** `IntersectionObserver` is a browser API available in all modern browsers.
- **Internal:** `@edgar-diff/lib` types (`SectionDiff`, `ChangeType`) — already imported in the web app.

## Edge Cases

### 1. Empty sectionDiffs array
`SectionNav` renders the "No sections" empty state message. No observer is set up. Both panels render content without section nav interaction.

### 2. Sections with subsections
`SectionDiff.subsectionDiffs` is ignored for V1. Only top-level sections appear in the nav. **Future consideration:** A collapsible tree view for subsections. This is a deliberate scope cut — the acceptance criteria say "lists all sections from the diff result" which we interpret as top-level sections for the initial implementation.

### 3. Long section headings
The `truncate` CSS class (Tailwind: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) prevents long headings from breaking the nav layout. The full heading is visible on hover via the browser's default text truncation tooltip. If needed, an explicit `title` attribute can be added.

### 4. Section exists in only one panel
When a section has `changeType === 'added'`, it exists in the new filing but not the old. `querySelector` returns `null` for the old panel, so only the new panel scrolls. Same logic (reversed) for `'removed'` sections. The nav button still works — it scrolls whichever panel(s) contain the section.

### 5. Section ID with special characters
Section IDs derived from filing content could contain dots, colons, or other characters that are invalid in CSS selectors. `CSS.escape(sectionId)` in the `querySelector` call handles this safely.

### 6. Rapid scrolling / scroll jitter
The `IntersectionObserver` fires asynchronously and batches updates. Multiple rapid scroll events won't cause excessive re-renders — React batches state updates from the observer callback. The `threshold` array provides enough granularity without being too chatty.

### 7. Observer setup timing
The `useEffect` in `useActiveSection` runs after the initial render, when section elements are in the DOM. If `FilingContent` renders asynchronously (not currently the case), the observer might find no sections. The hook handles this gracefully: `sections.length === 0` → early return, no observer created. If content loads later, the effect re-runs when `containerRef` changes.

### 8. Preamble section
The `preamble` section (content before the first heading) has `id="preamble"` in the DOM but no corresponding `SectionDiff`. It won't appear in the nav. The observer tracks it in `ratioMap`, but since the preamble may dominate the viewport when scrolled to the top, all named sections may have ratio 0. In this case, the hook sets `activeSectionId` to `undefined`, which deselects all nav items — the correct behavior since no tracked section is in view.

### 9. Panel without a document
If a `FilingPanel` has no `document` prop, it renders a placeholder message and the ref points to an empty scrollable div. `querySelector` finds no sections → `scrollIntoView()` is never called. The hook observes nothing. No errors.

## Testing Strategy

### Automated tests (`SectionNav.test.tsx`)

1. **Renders sections from props** — pass `sections` array, verify all headings appear
2. **Renders empty state** — pass `sections=[]`, verify "No sections" message
3. **Fires onSectionClick** — click a button, verify callback with correct ID
4. **Highlights active section** — pass `activeSectionId`, verify `aria-current="true"` and active CSS class
5. **Shows added badge** — section with `changeType: 'added'` shows "Added" label
6. **Shows removed badge** — section with `changeType: 'removed'` shows "Removed" label
7. **No badge for modified/unchanged** — verify no badge rendered for other change types

### Automated tests (`useActiveSection.test.ts`)

1. **Returns undefined when container is null** — no ref mounted
2. **Returns undefined when no sections exist** — empty container
3. **Integration test with mock IntersectionObserver** — verify callback updates state

### Updated tests (`FilingPanel.test.tsx`)

1. **forwardRef works** — verify ref is attached to the scroll container div
2. **Existing tests still pass** — backward compatibility

## Open Questions

1. **Subsection navigation (deferred)** — Should subsections be shown as indented children in the nav? The `subsectionDiffs` field supports nesting, but the UX for nested navigation adds complexity. **Recommendation:** Defer to a future story. Top-level sections cover the primary use case.

2. **Synced scroll vs. independent scroll** — Should scrolling in one panel also scroll the other (linked scrolling), or should only nav clicks trigger synchronized scroll? **Recommendation:** Only nav clicks trigger sync. Independent panel scrolling lets users compare different sections across filings. Linked scrolling can be added as a toggle in a future story.

3. **Which panel drives the active section?** — Currently, the old panel's IntersectionObserver drives `activeSectionId`. If the user scrolls the new panel independently, the active highlight won't update. **Recommendation:** Use the old panel for V1. If this proves confusing in UAT, we can observe both panels and use the most recently scrolled panel as the active source.

4. **Scroll offset for sticky headers** — If the panel header (with the filing label and select) is sticky, `scrollIntoView({ block: 'start' })` may position the section behind it. **Recommendation:** The header is not sticky in the current layout (it's in a separate flex child above the scroll container), so this isn't an issue. Monitor during UAT.

## Implementation Checklist

1. Create `apps/web/src/hooks/useActiveSection.ts` — IntersectionObserver hook
2. Modify `apps/web/src/components/SectionNav.tsx` — Accept props, render from data, add active styling and badges
3. Modify `apps/web/src/components/FilingPanel.tsx` — Add `forwardRef` to expose scroll container ref
4. Modify `apps/web/src/App.tsx` — Wire up sections, refs, scroll handler, and active section state
5. Update `apps/web/src/components/SectionNav.test.tsx` — Data-driven rendering, click handler, active state, badges
6. Create `apps/web/src/hooks/useActiveSection.test.ts` — Hook unit tests
7. Update `apps/web/src/components/FilingPanel.test.tsx` — Verify forwardRef behavior
8. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:typecheck`
9. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`
10. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:lint`
11. Visual verification via UAT with Chrome DevTools MCP
