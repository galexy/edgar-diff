# Edgar-Differ Web App — UAT Sanity Suite

Cumulative manual acceptance tests for the full app. Run by a tester agent via Chrome DevTools MCP as a sanity check during development or before releases.

**This file is updated by each story** — new checks are added, obsolete checks are pruned. For detailed story-specific UAT, see `.specs/<story>/uat.md`.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800

---

## 1. Page Load

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Page loads without console errors
- Full viewport height is used (no page-level scrollbar)

---

## 2. Header

**Action:** Inspect the top of the page

**Verify:**
- "Edgar-Differ" title is visible in a header bar
- Header spans full width with a bottom border

---

## 3. Search Bar

**Action:** Inspect below the header

**Verify:**
- Text input with placeholder mentioning company name, ticker, or CIK
- Input is enabled (not disabled)
- Spans full width with bottom border

---

## 4. Three-Column Layout

**Action:** Inspect the main content area

**Verify:**
- Section nav sidebar on the left (~240px fixed width)
- Filing A panel in the center
- Filing B panel on the right
- Panels share remaining space equally
- Vertical borders separate the columns

---

## 5. Section Navigation

**Action:** Inspect the left sidebar

**Verify:**
- "Sections" heading visible
- At least 6 section items listed (Item 1. Business, Item 1A. Risk Factors, etc.)
- Items appear as clickable buttons
- Diff summary bar appears between "Sections" heading and section list (role="status", aria-label="Diff summary")
- Modified sections display amber change count badges (e.g., "2 changes", "1 change")
- Badges use singular "change" for count=1, plural "changes" for count>1
- Added sections show green "Added" text badge
- Removed sections show red "Removed" text badge
- Unchanged sections show no badge
- Badges remain visible when nav is scrolled

---

## 6. Filing Panels

**Action:** Inspect both filing panels

**Verify:**
- "Filing A" and "Filing B" headings visible
- Each has a disabled "Select a filing..." dropdown
- Placeholder content text below each dropdown

---

## 7. Independent Scrolling

**Action:** If content overflows, scroll within each panel

**Verify:**
- Each panel scrolls independently (when sync scroll is disabled)
- Header and search bar stay fixed
- No page-level scrollbar

---

## 8. Sync Scroll Toggle

**Action:** Inspect the Header bar

**Verify:**
- "Sync Scroll" toggle button visible in Header (right side)
- Button shows blue/enabled styling when sync is on (default)
- Clicking toggle changes to gray/disabled styling
- Button has appropriate `aria-pressed` state

---

## 9. Synchronized Scrolling

**Action:** With two filings loaded and sync enabled, scroll Filing A

**Verify:**
- Filing B scrolls to match Filing A's section
- Scrolling Filing B also syncs Filing A (bidirectional)
- Disabling sync toggle stops panels from syncing
- Re-enabling sync toggle resumes syncing

---

## 10. Responsive — Narrow Viewport (640x800)

**Action:** Resize viewport to 640x800

**Verify:**
- Layout doesn't break
- No horizontal scrollbar
- All three columns still visible

---

## Revision History

| Story | Changes |
|-------|---------|
| US-2.2 | Initial suite: page load, header, search, 3-column layout, section nav, filing panels, scroll, responsive |
| US-2.7 | Added: diff summary bar, change count badges, badge singular/plural, badge visibility on scroll. Updated: search input is enabled (was disabled) |
| US-2.11 | Added: sync scroll toggle in header, synchronized scrolling checks. Updated: independent scrolling note (when sync disabled) |
