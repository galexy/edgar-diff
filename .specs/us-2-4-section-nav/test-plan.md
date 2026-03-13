# US-2.4: Section Navigation — Test Plan

## Overview

US-2.4 evolves the placeholder `SectionNav` sidebar into a data-driven component wired to `SectionDiff[]`. Clicking a section scrolls both filing panels to the corresponding `<section id>` element. The sidebar highlights the currently visible section (tracked via `IntersectionObserver`) and labels sections that exist only in one filing.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, prop-driven rendering, click callbacks, ARIA attributes, change-type indicators, and IntersectionObserver hook behavior
2. **Visual validation** (Chrome DevTools MCP) — verify scroll behavior, active-section highlighting appearance, layout, and responsive behavior (see `uat.md`)

### Architecture (aligned with implementation design)

The implementation evolves these components:

- **`SectionNav`** — Pure presentational component. Accepts `sections: SectionNavItem[]` (required), `activeSectionId?: string`, and `onSectionClick?: (id: string) => void`. Each `SectionNavItem` is `{ id, heading, changeType }` — a projection of `SectionDiff` with only nav-relevant fields. Renders `<nav aria-labelledby>` with `<ul>` of `<button>` items. The "Sections" heading has an `id` attribute and the `<nav>` uses `aria-labelledby` to reference it. Active section gets `aria-current="true"` and `bg-blue-100` styling. Added/removed sections get colored badge labels. Empty sections array renders a "No sections" message.
- **`useActiveSection` hook** (NEW: `apps/web/src/hooks/useActiveSection.ts`) — Custom hook using `IntersectionObserver` scoped to a scroll container (`root: container`). Observes all `<section id>` elements, tracks `intersectionRatio` in a `ratioMap`, and returns the id of the most-visible section. Multiple thresholds (`[0, 0.1, 0.25, 0.5, 0.75, 1.0]`) provide granular updates. Only one panel is observed (old panel) to avoid conflicting signals.
- **`App`** — Manages `activeSectionId` state via `useActiveSection(oldPanelRef)`. The observer is the **single source of truth** for active section — no optimistic update on click. Maps `SectionDiff[]` to `SectionNavItem[]`. Holds `useRef` for both panel scroll containers. `handleSectionClick` uses `CSS.escape(sectionId)` + `querySelector` + `scrollIntoView({ behavior: 'smooth', block: 'start' })` on both panels. The observer detects the new visible section after scroll and updates `activeSectionId`.
- **`FilingPanel`** — Wrapped with `React.forwardRef` to expose the scrollable `<div>` ref. The ref targets the inner scrollable div (not the outer container).
- **`FilingContent`** — No changes; already renders `<section id={section.id}>`.

---

## 1. BDD Acceptance Criteria

### AC-1: Section listing from diff data

```gherkin
Scenario: Sidebar lists all sections from the diff result
  Given the App has sectionDiffs with sections "Item 1. Business", "Item 1A. Risk Factors", "Item 7. MD&A"
  When the page renders
  Then the SectionNav sidebar displays 3 section items
  And the items match the headings from sectionDiffs
```

### AC-2: Section heading display

```gherkin
Scenario: Each section item shows the section heading text
  Given sections contain an item with heading "Item 1A. Risk Factors"
  When the SectionNav renders
  Then a button labeled "Item 1A. Risk Factors" is visible in the sidebar
```

### AC-3: Click-to-scroll both panels

```gherkin
Scenario: Clicking a section scrolls both filing panels to that section
  Given both filing panels are rendered with content containing section id "item-1a"
  When the user clicks "Item 1A. Risk Factors" in the sidebar
  Then both the Filing A and Filing B panels scroll to the element with id "item-1a"

Scenario: Clicking an added section scrolls only the panel containing it
  Given a section with changeType "added" exists only in the new filing panel
  When the user clicks that section in the sidebar
  Then the new filing panel scrolls to that section
  And the old filing panel does not scroll (no matching element)
```

### AC-4: Active section highlighting

```gherkin
Scenario: The currently visible section is highlighted in the sidebar
  Given the user has scrolled to "Item 7. MD&A" in the filing panels
  When the IntersectionObserver reports "Item 7" as most visible
  Then the "Item 7. MD&A" button in the sidebar has aria-current="true" and bg-blue-100
  And no other section button has the active style
```

### AC-5: Added/removed section indicators

```gherkin
Scenario: A section that exists only in the new filing shows an "Added" indicator
  Given sections contain an item with changeType "added"
  When the SectionNav renders
  Then that section's button includes a visible "Added" badge with green styling

Scenario: A section that exists only in the old filing shows a "Removed" indicator
  Given sections contain an item with changeType "removed"
  When the SectionNav renders
  Then that section's button includes a visible "Removed" badge with red styling
```

---

## 2. Unit Tests — `SectionNav`

File: `apps/web/src/components/SectionNav.test.tsx` (replaces existing placeholder tests)

### 2.1 Rendering from props

| ID | Test | Rationale |
|----|------|-----------|
| SN-U1 | Renders a `<nav>` element with `aria-labelledby` referencing the "Sections" heading | Semantic navigation landmark with label (AC-1) |
| SN-U2 | Renders one button per entry in `sections` prop | Data-driven rendering (AC-1) |
| SN-U3 | Each button's text content matches the section's `heading` | Heading display (AC-2) |
| SN-U4 | Renders sections in the same order as the `sections` array | Order preservation |
| SN-U5 | Empty `sections` array renders "No sections" message (no buttons) | Empty state boundary |

### 2.2 Click behavior

| ID | Test | Rationale |
|----|------|-----------|
| SN-U6 | Clicking a section button calls `onSectionClick` with the section's `id` | Click callback (AC-3) |
| SN-U7 | Clicking different sections calls `onSectionClick` with the correct respective `id` | Multiple click targets |
| SN-U8 | If `onSectionClick` is not provided, clicking does not throw | Optional callback safety |

### 2.3 Active section highlighting

| ID | Test | Rationale |
|----|------|-----------|
| SN-U9 | When `activeSectionId` matches a section, that button has `aria-current="true"` | Accessible active state (AC-4) |
| SN-U10 | When `activeSectionId` matches a section, that button has `bg-blue-100` CSS class | Visual active state (AC-4) |
| SN-U11 | Non-active section buttons do NOT have `aria-current="true"` | Only one active at a time |
| SN-U12 | When `activeSectionId` is `undefined`, no button has `aria-current` | No active section initially |
| SN-U13 | When `activeSectionId` changes (re-render with new prop), the previously active button loses its active style | Dynamic updates |

### 2.4 Change-type indicators

| ID | Test | Rationale |
|----|------|-----------|
| SN-U14 | Section with `changeType: 'added'` renders "Added" badge text | Added indicator (AC-5) |
| SN-U15 | Section with `changeType: 'removed'` renders "Removed" badge text | Removed indicator (AC-5) |
| SN-U16 | Section with `changeType: 'modified'` does NOT render a badge | Modified is not flagged |
| SN-U17 | Section with `changeType: 'unchanged'` does NOT render a badge | Unchanged is not flagged |
| SN-U18 | Added badge has green styling class (e.g., `text-green-700`, `bg-green-100`) | Visual differentiation |
| SN-U19 | Removed badge has red styling class (e.g., `text-red-700`, `bg-red-100`) | Visual differentiation |

### 2.5 Accessibility

| ID | Test | Rationale |
|----|------|-----------|
| SN-U20 | The `<nav>` has `aria-labelledby` pointing to the "Sections" heading's `id` | Accessible labeled landmark |
| SN-U21 | Section buttons have `type="button"` | Prevent form submission |
| SN-U22 | "Sections" heading is rendered as a `<h2>` with an `id` attribute | Heading hierarchy + labelledby target |
| SN-U23 | Long section headings are wrapped in a `truncate` class element | Overflow handling (design specifies `truncate`) |

---

## 3. Unit Tests — `useActiveSection` Hook

File: `apps/web/src/hooks/useActiveSection.test.ts` (NEW)

### 3.1 Basic behavior

| ID | Test | Rationale |
|----|------|-----------|
| UAS-U1 | Returns `undefined` when container ref is `null` (not mounted) | Null ref safety |
| UAS-U2 | Returns `undefined` when container has no `<section>` elements | Empty container |
| UAS-U3 | Calls `IntersectionObserver` constructor with `root: container` and correct thresholds | Observer configured correctly |
| UAS-U4 | Observes all `<section id>` elements in the container | All sections tracked |

### 3.2 Active section detection

| ID | Test | Rationale |
|----|------|-----------|
| UAS-U5 | Returns the id of the section with the highest `intersectionRatio` | Core "most visible" logic |
| UAS-U6 | When multiple sections have equal ratios, returns the first in DOM order | Tie-breaking behavior |
| UAS-U7 | When a new entry has higher ratio than current active, active updates | Dynamic updates on scroll |
| UAS-U8 | When all sections have ratio 0, returns `undefined` (deselects all) | All-zero deselection (preamble visible) |

### 3.3 Lifecycle

| ID | Test | Rationale |
|----|------|-----------|
| UAS-U9 | Calls `observer.disconnect()` on cleanup (unmount) | No memory leaks |
| UAS-U10 | Does not create observer when container has no sections | Early return optimization |

---

## 4. Unit Tests — `FilingPanel` (forwardRef)

File: `apps/web/src/components/FilingPanel.test.tsx` (extends existing)

| ID | Test | Rationale |
|----|------|-----------|
| FP-U1 | Ref is attached to the scrollable `<div>` (inner div with `overflow-y-auto`) | Correct ref target for scroll operations |
| FP-U2 | Existing tests still pass (backward compatibility) | No regression from forwardRef change |

---

## 5. Integration Tests — Cross-Component Behavior

File: `apps/web/src/App.test.tsx` (extends existing test file)

### 5.1 Wiring: App passes data to SectionNav

| ID | Test | Rationale |
|----|------|-----------|
| APP-I1 | SectionNav receives section headings derived from `sampleDiffs` (verify buttons match `sampleDiffs[*].heading`) | Data flow: App → SectionNav (AC-1) |
| APP-I2 | SectionNav is rendered inside the `<main>` element | Layout composition |

### 5.2 Click-to-scroll integration

| ID | Test | Rationale |
|----|------|-----------|
| APP-I3 | Clicking a section button calls `scrollIntoView` on the `<section>` element with the matching id in Filing A panel | Scroll wiring (AC-3) |
| APP-I4 | Clicking a section button calls `scrollIntoView` on the `<section>` element with the matching id in Filing B panel | Both panels scroll (AC-3) |
| APP-I5 | If the target `<section>` element does not exist in the DOM, no error is thrown | Missing section resilience |
| APP-I6 | `scrollIntoView` called with `{ behavior: 'smooth', block: 'start' }` options | Smooth scroll per design |

### 5.3 Active section state

| ID | Test | Rationale |
|----|------|-----------|
| APP-I7 | Initial render has no active section (no button with `aria-current`) | Clean initial state |
| APP-I8 | When mock IntersectionObserver fires with a section entry, the corresponding nav button becomes active | Observer → active state wiring |
| APP-I9 | When observer fires with `bestRatio === 0` (e.g., preamble visible), no nav button is active | All-zero deselection (BC-14) |

> **Note:** Testing IntersectionObserver-based scroll tracking in jsdom is limited — `intersectionRatio` is always 0 from real scroll. Tests mock the observer and manually trigger intersection entries. True scroll-position tracking is validated in UAT (Tier 2).
>
> **Active state is observer-only:** The click handler does NOT set `activeSectionId` directly. The observer is the single source of truth — it detects the new visible section after `scrollIntoView` completes and updates state. If UAT reveals perceptible lag, an optimistic click update can be added in a follow-up.

---

## 6. End-to-End Scenarios

These are user-journey descriptions for UAT execution, not automated tests.

### E2E-1: Section navigation full flow

1. User opens the app at `http://localhost:5173`
2. The sidebar lists all sections from the diff data
3. User clicks "Item 1A. Risk Factors"
4. Both Filing A and Filing B panels scroll to the Item 1A section
5. The "Item 1A. Risk Factors" button in the sidebar becomes highlighted
6. User clicks "Item 7. MD&A"
7. Both panels scroll to the Item 7 section
8. The highlight moves from "Item 1A" to "Item 7"

### E2E-2: Scroll-driven highlighting

1. User opens the app
2. User manually scrolls the Filing A panel to "Item 8. Financial Statements"
3. The sidebar highlights "Item 8. Financial Statements" as the user scrolls
4. Previous section highlight is removed

### E2E-3: Added/removed section indicators

1. User opens the app with diff data containing added and/or removed sections
2. Sections that are only in the new filing display an "Added" badge
3. Sections that are only in the old filing display a "Removed" badge
4. Modified/unchanged sections have no badge

---

## 7. Boundary Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| BC-1 | 0 sections (empty `sections[]`) | SectionNav renders `<nav>` with "No sections" message, no buttons |
| BC-2 | 1 section | Single button rendered, clickable, can become active |
| BC-3 | 20+ sections | All sections rendered; sidebar scrolls independently if overflow |
| BC-4 | Very long section heading (100+ characters) | Heading truncates via `truncate` CSS class, does not break layout |
| BC-5 | Section heading with special characters (`&`, `<`, quotes) | Characters displayed correctly (React JSX escapes automatically) |
| BC-6 | Section ID with special characters (dots, colons) | `CSS.escape()` in `handleSectionClick` handles safely |
| BC-7 | Sections with subsectionDiffs (nested) | Only top-level sections shown in nav (subsections not rendered) |
| BC-8 | All sections have changeType 'unchanged' | No badges rendered; all buttons are plain |
| BC-9 | All sections have changeType 'added' | All buttons show "Added" badge |
| BC-10 | All sections have changeType 'removed' | All buttons show "Removed" badge |
| BC-11 | Mixed changeTypes (added, removed, modified, unchanged) | Correct badge per section |
| BC-12 | `activeSectionId` does not match any section in `sections` | No button has active state; no error |
| BC-13 | Rapid successive clicks on different sections | Last `scrollIntoView` call wins; React batches state updates |
| BC-14 | Preamble section (id="preamble") visible during scroll | Observer detects all tracked sections at ratio 0; hook sets `activeSectionId` to `undefined`; all nav items deselect |
| BC-15 | Panel without a document (FilingPanel shows placeholder) | Ref points to empty scrollable div; querySelector finds nothing; no errors |

---

## 8. Error Conditions

| ID | Condition | Expected Behavior |
|----|-----------|-------------------|
| EC-1 | `onSectionClick` called with id whose `<section>` element doesn't exist in DOM | `querySelector` returns null; `scrollIntoView()` not called; no error |
| EC-2 | FilingPanel scroll container ref is null (panel not mounted) | `ref.current` is null; `handleSectionClick` skips via `if (!container) continue` |
| EC-3 | `sections` prop is empty array `[]` | Renders "No sections" message (same as BC-1; `sections` is required, App always passes `[]` when no data) |
| EC-4 | `SectionNavItem` has empty string `id` | Button renders; click callback receives empty string; CSS.escape handles it |
| EC-5 | `SectionNavItem` has empty string `heading` | Button renders (empty text); no crash |
| EC-6 | `IntersectionObserver` not available | Hook should not crash (defensive check or let it fail gracefully in test env) |
| EC-7 | Observer fires with entry for a section not in `sections` prop | `activeSectionId` set to unknown id; no nav button highlighted — acceptable |

---

## 9. Test Data Strategy

### Fixture helpers needed

| Helper | Purpose |
|--------|---------|
| `makeSectionNavItem(id, heading, changeType?)` | Creates a `SectionNavItem` with defaults. `changeType` defaults to `'modified'` |
| `makeSectionNavItems(count)` | Creates an array of `count` items with sequential ids (`section-1`, `section-2`, ...) and headings (`Item 1. Section 1`, ...) |
| `mockIntersectionObserver()` | Sets up a mock `IntersectionObserver` that captures `observe`/`disconnect` calls and exposes a `trigger(entries)` function |
| `mockScrollIntoView()` | Adds a mock `scrollIntoView` to `HTMLElement.prototype` for asserting scroll calls |

### Sample SectionNavItem fixtures

| Name | Content | Use Case |
|------|---------|----------|
| `standardSections` | 6 items matching the current placeholder headings, all `changeType: 'modified'` | Default happy path |
| `mixedChangeTypes` | 4 items: 1 added, 1 removed, 1 modified, 1 unchanged | Change-type indicator tests |
| `singleSection` | 1 item | Minimal rendering |
| `emptySections` | `[]` | Empty state |
| `manySections` | 20 items | Overflow/scroll testing |
| `longHeadings` | 3 items with 100+ character headings | Truncation behavior |
| `specialCharHeadings` | Items with `&`, `<`, `"` in headings | Display correctness |

---

## 10. Test File Organization

```
apps/web/src/
  hooks/
    useActiveSection.ts           # NEW: IntersectionObserver hook
    useActiveSection.test.ts      # NEW: Hook unit tests (UAS-U*)
  components/
    SectionNav.tsx                # Evolved: accepts sections, activeSectionId, onSectionClick
    SectionNav.test.tsx           # Unit tests (SN-U*) — replaces placeholder tests
    FilingPanel.tsx               # Extended: forwardRef for scroll container
    FilingPanel.test.tsx          # Existing tests + ref forwarding test (FP-U*)
  App.tsx                         # Extended: state management, scroll wiring, useActiveSection
  App.test.tsx                    # Integration tests (APP-I*)

.specs/us-2-4-section-nav/
  test-plan.md                    # This file
  uat.md                          # Visual validation scenarios
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 11. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No `scrollIntoView` implementation | Cannot verify actual scroll position | Mock `scrollIntoView` and assert it was called with correct element and options |
| `IntersectionObserver` does not fire from scroll | Cannot test scroll-driven active section tracking | Mock observer; manually trigger intersection entries; UAT for real scroll |
| No CSS computed styles | Cannot verify active button's visual appearance | Assert CSS class presence (`bg-blue-100`); UAT for visual check |
| No layout/overflow | Cannot verify sidebar scrolls with many sections | UAT viewport testing |
| No `getBoundingClientRect` accuracy | Cannot compute visible section from geometry | Rely on IntersectionObserver mock |

### What jsdom CAN verify (and we test thoroughly)

- SectionNav renders correct number of buttons from `sections` prop
- Button text matches `heading` field
- `onSectionClick` fires with correct `id`
- `aria-current` applied to active section only
- `bg-blue-100` class applied to active button, not others
- `aria-labelledby` on `<nav>` references "Sections" heading `id`
- Change-type badge text ("Added" / "Removed") and CSS classes
- Empty state renders "No sections" message
- Graceful handling of empty props
- `scrollIntoView` called on correct DOM element with correct options (via mock)
- IntersectionObserver created with correct `root` and `threshold` (via mock)
- Observer callbacks update `activeSectionId` correctly (via mock trigger)
- Observer sets `activeSectionId` to `undefined` when all ratios are 0 (preamble deselection)
- Observer `disconnect()` called on cleanup
