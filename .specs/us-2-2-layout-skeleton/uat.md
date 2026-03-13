# US-2.2: Side-by-Side Layout Skeleton — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800

## Test Steps

### 1. Page Load

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Page loads without errors (no console errors)
- Full viewport is used (no page-level scrollbar)
- Background is light gray (`bg-gray-50`)

<!-- Reference screenshot: screenshots/01-page-load.png -->

---

### 2. Header Bar

**Action:** Inspect the top of the page

**Verify:**
- White header bar spans full width at the top
- "Edgar-Differ" title is visible in bold text
- Header has a bottom border separating it from content below
- Header height is compact (not oversized)

<!-- Reference screenshot: screenshots/02-header.png -->

---

### 3. Search Bar

**Action:** Inspect the area below the header

**Verify:**
- A text input is visible below the header
- Input shows placeholder text mentioning company name, ticker, or CIK
- Input appears disabled/grayed out (non-functional)
- Input spans the full width of the page
- Search bar has a bottom border separating it from the content area

<!-- Reference screenshot: screenshots/03-search-bar.png -->

---

### 4. Three-Column Layout

**Action:** Inspect the main content area below the search bar

**Verify:**
- Three distinct columns are visible side by side
- Left column: section navigation sidebar (narrower, fixed width ~240px)
- Center column: Filing A panel
- Right column: Filing B panel
- Filing panels share the remaining space equally
- A vertical border separates the sidebar from the panels
- A vertical divider separates Filing A from Filing B

<!-- Reference screenshot: screenshots/04-three-columns.png -->

---

### 5. Section Navigation Sidebar

**Action:** Inspect the left sidebar

**Verify:**
- "Sections" heading is visible at the top
- At least 6 section items are listed (Item 1. Business, Item 1A. Risk Factors, etc.)
- Items appear as clickable buttons with hover effect
- Items are in a vertical list
- Sidebar has a light background distinguishing it from the panels

<!-- Reference screenshot: screenshots/05-section-nav.png -->

---

### 6. Filing Panels

**Action:** Inspect both filing panels

**Verify:**
- Center panel has "Filing A" heading
- Right panel has "Filing B" heading
- Each panel has a disabled dropdown showing "Select a filing..."
- Below the dropdown, placeholder text ("Filing content will appear here") is visible
- Panel headers are pinned at the top of each panel

<!-- Reference screenshot: screenshots/06-filing-panels.png -->

---

### 7. Independent Scrolling

**Action:** If content overflows, scroll within each panel independently

**Verify:**
- The sidebar scrolls independently (if content overflows)
- Filing A panel scrolls independently
- Filing B panel scrolls independently
- Scrolling one panel does NOT scroll the others
- The header and search bar remain fixed at the top (do not scroll away)
- No page-level scrollbar appears

> **Note:** With the current placeholder content, panels may not have enough content to trigger scrolling. To verify, temporarily add long placeholder text to a panel during development. This step becomes critical in US-2.3+ when real filing content is rendered.

<!-- Reference screenshot: screenshots/07-scroll-behavior.png -->

---

### 8. Narrow Viewport (640x800)

**Action:** Resize viewport to 640x800

**Verify:**
- Layout does not break
- No horizontal scrollbar appears
- All three columns are still visible (panels will be narrow but present)
- Text may truncate but nothing overlaps or overflows

<!-- Reference screenshot: screenshots/08-narrow-viewport.png -->

---

### 9. Very Narrow Viewport (375x800)

**Action:** Resize viewport to 375x800 (mobile-like)

**Verify:**
- Page does not crash or produce layout errors
- Content is squeezed but the layout structure holds
- No horizontal overflow

> **Note:** This is a desktop-first app — mobile optimization is explicitly out of scope. This check just ensures no catastrophic breakage.

<!-- Reference screenshot: screenshots/09-very-narrow.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2-2-layout-skeleton/screenshots/
  01-page-load.png
  02-header.png
  03-search-bar.png
  04-three-columns.png
  05-section-nav.png
  06-filing-panels.png
  07-scroll-behavior.png
  08-narrow-viewport.png
  09-very-narrow.png
```

## Pass/Fail Criteria

- **Pass:** All 9 steps verified, no visual defects, layout matches the PRD wireframe
- **Fail:** Any step shows incorrect layout, missing content, console errors, or broken overflow
