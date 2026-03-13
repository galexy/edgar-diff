# US-2.3: Render Original Filing HTML — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify rendered filing HTML looks correct within the panel layout.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- App has been loaded with at least one `StructuredDocument` in each panel (may require test data injection or a dev-mode toggle)

---

## Test Steps

### 1. Page Load with Filing Content

**Action:** Navigate to `http://localhost:5173` (with documents loaded in both panels)

**Verify:**
- Page loads without console errors
- Both filing panels display rendered HTML content (not placeholder text)
- No raw HTML tags visible as text (content is rendered, not escaped)

<!-- Reference screenshot: screenshots/01-filing-content-loaded.png -->

---

### 2. Backward Compatibility — No Document

**Action:** Load the app with no documents provided to the panels (default state)

**Verify:**
- Both panels show "Filing content will appear here" placeholder text
- Panel headers ("Filing A", "Filing B") and disabled selectors are still visible
- Layout is unchanged from US-2.2

<!-- Reference screenshot: screenshots/02-no-document-placeholder.png -->

---

### 3. Section Container Structure

**Action:** Inspect the DOM of a filing panel with a loaded document (DevTools Elements panel)

**Verify:**
- Each section is wrapped in a container element with an `id` attribute (e.g., `section-item-1`, `section-item-1a`)
- Containers appear in document order matching the filing's section sequence
- Content between containers represents the sliced HTML at the correct boundaries

<!-- Reference screenshot: screenshots/03-section-containers-dom.png -->

---

### 4. Original HTML Formatting Preserved

**Action:** Scroll through the rendered filing content in a panel

**Verify:**
- Tables render with proper rows, columns, and alignment (not as plain text)
- Bold, italic, and underlined text formatting is visible
- Indentation and spacing from the original filing are preserved
- Styled spans and divs retain their original appearance
- Numbered lists and bullet points render correctly

<!-- Reference screenshot: screenshots/04-formatting-preserved.png -->

---

### 5. Table Rendering

**Action:** Find a section with financial tables (e.g., Item 8. Financial Statements)

**Verify:**
- Tables have visible borders or cell boundaries
- Column alignment is correct (numbers right-aligned if originally styled that way)
- Tables are readable (not squished or overflowing out of view)
- Multi-row/multi-column cells (colspan/rowspan) render correctly

<!-- Reference screenshot: screenshots/05-table-rendering.png -->

---

### 6. Both Panels with Different Content

**Action:** Load different filings in Filing A and Filing B panels

**Verify:**
- Filing A shows content from its document (e.g., Apple 10-K)
- Filing B shows content from its document (e.g., Microsoft 10-K)
- Content does not bleed between panels
- Each panel independently displays the correct filing

<!-- Reference screenshot: screenshots/06-two-different-filings.png -->

---

### 7. CSS Isolation — No Style Leakage

**Action:** Inspect the overall app layout with filing content loaded

**Verify:**
- App header ("Edgar-Differ") is unaffected by filing styles
- Search bar layout and appearance unchanged
- Section navigation sidebar appearance unchanged
- Filing styles (fonts, colors, backgrounds from the 10-K HTML) do not override the app's UI
- Panel headers and selectors remain correctly styled

<!-- Reference screenshot: screenshots/07-css-isolation.png -->

---

### 8. Scrolling Within Panels

**Action:** Load a filing with enough content to overflow the panel (any real 10-K fixture)

**Verify:**
- Filing content scrolls within the panel's content area
- Panel header (label + selector) remains pinned at the top
- Scrolling one panel does not scroll the other panel
- Scrolling does not scroll the section navigation sidebar
- No page-level scrollbar appears

<!-- Reference screenshot: screenshots/08-panel-scrolling.png -->

---

### 9. Content Overflow Handling

**Action:** Check rendering of sections with very wide content (wide tables)

**Verify:**
- Wide tables either scroll horizontally within the panel or wrap/shrink to fit
- Content does not overflow the panel boundary and overlap the other panel
- No horizontal scrollbar on the page (only within the panel if needed)

<!-- Reference screenshot: screenshots/09-overflow-handling.png -->

---

### 10. Narrow Viewport (640x800)

**Action:** Resize viewport to 640x800 with filing content loaded

**Verify:**
- Layout doesn't break
- Filing content is still visible (may be narrow but readable)
- No horizontal page overflow
- Tables may scroll horizontally within panels

<!-- Reference screenshot: screenshots/10-narrow-viewport.png -->

---

### 11. Console Errors Check

**Action:** Open DevTools Console tab and reload the page with filing content

**Verify:**
- No JavaScript errors in the console
- No React warnings about dangerouslySetInnerHTML usage
- No CSP violations or blocked resource warnings

<!-- Reference screenshot: screenshots/11-console-clean.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc:

```
.specs/us-2-3-filing-content/screenshots/
  01-filing-content-loaded.png
  02-no-document-placeholder.png
  03-section-containers-dom.png
  04-formatting-preserved.png
  05-table-rendering.png
  06-two-different-filings.png
  07-css-isolation.png
  08-panel-scrolling.png
  09-overflow-handling.png
  10-narrow-viewport.png
  11-console-clean.png
```

## Pass/Fail Criteria

- **Pass:** All 11 steps verified — filing HTML renders correctly, formatting is preserved, CSS is isolated, scrolling works, no console errors
- **Fail:** Any step shows escaped HTML, broken tables, style leakage to app chrome, scroll issues, or console errors
