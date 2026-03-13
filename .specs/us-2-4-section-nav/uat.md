# US-2.4: Section Navigation — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

**Recording requirements:** Screenshots MUST be saved to `.specs/us-2-4-section-nav/screenshots/` and committed alongside the implementation. UAT results (pass/fail for each step, with a brief summary) MUST be recorded in the implementation PR body or as a PR comment, with screenshots attached/embedded so reviewers can see the visual verification without running the app.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Sample diff fixture wired up in App.tsx (sectionDiffs passed to SectionNav)
- Both Filing A (old) and Filing B (new) panels visible in the side-by-side layout

## Test Steps

### 1. Page Load — Section List Visible

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Page loads without console errors
- The left sidebar displays a "Sections" heading
- Section items are listed below the heading, one per section from the diff data
- Each item shows a section heading (e.g., "Item 1. Business", "Item 1A. Risk Factors")
- Items appear as clickable buttons with hover effect

<!-- Reference screenshot: screenshots/01-section-list-loaded.png -->

---

### 2. Section Heading Text

**Action:** Compare the sidebar section labels against the filing content sections visible in the panels

**Verify:**
- Each sidebar item's text matches a section heading in the filing content
- All sections from the diff data are represented (none missing, none duplicated)
- Sections appear in the same order as they occur in the filing

<!-- Reference screenshot: screenshots/02-section-headings-match.png -->

---

### 3. Click Section — Both Panels Scroll

**Action:** Click "Item 1A. Risk Factors" (or another section not currently in view) in the sidebar

**Verify:**
- Filing A (left panel) scrolls to the "Item 1A. Risk Factors" section
- Filing B (right panel) scrolls to the same section
- Both panels scroll simultaneously (or near-simultaneously)
- The section heading is visible near the top of both panels after scrolling

<!-- Reference screenshot: screenshots/03-click-scroll-both-panels.png -->

---

### 4. Active Section Highlighting

**Action:** After clicking "Item 1A. Risk Factors", inspect the sidebar

**Verify:**
- The "Item 1A. Risk Factors" button has a distinct highlighted style (e.g., blue/indigo background, bold text, or similar visual indicator)
- Other section buttons do NOT have the highlighted style
- The active style is clearly distinguishable from the default button style

<!-- Reference screenshot: screenshots/04-active-section-highlighted.png -->

---

### 5. Click Another Section — Highlight Moves

**Action:** Click "Item 7. MD&A" in the sidebar

**Verify:**
- Both panels scroll to the "Item 7. MD&A" section
- The highlight moves from "Item 1A. Risk Factors" to "Item 7. MD&A"
- Only one section is highlighted at a time
- The previously active section returns to its default style

<!-- Reference screenshot: screenshots/05-highlight-moves.png -->

---

### 6. Scroll-Driven Active Tracking

**Action:** Manually scroll the Filing A panel (using mouse wheel or drag) to bring "Item 8. Financial Statements" into view

**Verify:**
- As the scroll position changes, the sidebar highlight updates to track the visible section
- When "Item 8. Financial Statements" is the dominant visible section, it becomes highlighted in the sidebar
- The previous active section's highlight is removed

<!-- Reference screenshot: screenshots/06-scroll-tracking.png -->

---

### 7. Added Section Indicator

**Action:** Inspect any section in the sidebar that has `changeType: 'added'` in the diff data (may require a modified fixture with an added section)

**Verify:**
- The section button shows a visible "added" badge or label
- The badge has a green color scheme (green text or green background pill)
- The badge is positioned near the section heading text (inline or adjacent)
- The badge text is readable and does not overlap the heading

<!-- Reference screenshot: screenshots/07-added-indicator.png -->

---

### 8. Removed Section Indicator

**Action:** Inspect any section in the sidebar that has `changeType: 'removed'` in the diff data (may require a modified fixture with a removed section)

**Verify:**
- The section button shows a visible "removed" badge or label
- The badge has a red color scheme (red text or red background pill)
- The badge is positioned near the section heading text
- The badge text is readable and does not overlap the heading

<!-- Reference screenshot: screenshots/08-removed-indicator.png -->

---

### 9. Modified/Unchanged Sections — No Badge

**Action:** Inspect sections with `changeType: 'modified'` or `changeType: 'unchanged'`

**Verify:**
- No badge or label is shown for these sections
- The section buttons render with their heading text only
- They are visually identical except for active state

<!-- Reference screenshot: screenshots/09-no-badge-modified.png -->

---

### 10. Sidebar Overflow — Many Sections

**Action:** If the diff data has enough sections to overflow the sidebar, scroll within the sidebar

**Verify:**
- The sidebar scrolls independently of the filing panels
- The "Sections" heading stays visible or scrolls with the list (not fixed)
- Scrolling the sidebar does not affect the filing panels
- All sections are reachable by scrolling

<!-- Reference screenshot: screenshots/10-sidebar-overflow.png -->

---

### 11. Responsive — Narrow Viewport (900x800)

**Action:** Resize viewport to 900x800

**Verify:**
- The sidebar, Filing A, and Filing B panels are all still visible
- The sidebar does not collapse or overlap the filing panels
- Section text may truncate but remains readable
- Click-to-scroll still functions correctly

<!-- Reference screenshot: screenshots/11-narrow-viewport.png -->

---

### 12. Responsive — Very Narrow Viewport (640x800)

**Action:** Resize viewport to 640x800

**Verify:**
- Layout does not break (no horizontal page scrollbar)
- All three columns still visible (even if compressed)
- Section buttons are still clickable
- Section headings are readable (may truncate with ellipsis)

<!-- Reference screenshot: screenshots/12-very-narrow-viewport.png -->

---

### 13. No Console Errors During Interaction

**Action:** Open browser DevTools console. Click several sections, scroll panels, resize viewport.

**Verify:**
- No JavaScript errors in the console
- No React warnings (e.g., missing keys, prop type errors)
- No failed network requests

<!-- Reference screenshot: screenshots/13-no-console-errors.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2-4-section-nav/screenshots/
  01-section-list-loaded.png
  02-section-headings-match.png
  03-click-scroll-both-panels.png
  04-active-section-highlighted.png
  05-highlight-moves.png
  06-scroll-tracking.png
  07-added-indicator.png
  08-removed-indicator.png
  09-no-badge-modified.png
  10-sidebar-overflow.png
  11-narrow-viewport.png
  12-very-narrow-viewport.png
  13-no-console-errors.png
```

## Pass/Fail Criteria

- **Pass:** All 13 steps verified, section list matches diff data, click-to-scroll works in both panels, active section tracking functions via both click and scroll, change-type badges render correctly, no console errors, layout holds at narrow viewports
- **Fail:** Any step shows missing sections, broken scroll behavior, incorrect or missing active highlighting, wrong or missing change-type badges, console errors, or broken layout at tested viewports
