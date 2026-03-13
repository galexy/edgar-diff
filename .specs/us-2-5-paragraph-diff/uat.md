# US-2.5: Paragraph Diff Highlighting — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Hardcoded diff fixture wired up in App.tsx (or live diff data if available)
- Both Filing A (old) and Filing B (new) panels visible in the side-by-side layout

## Test Steps

### 1. Page Load — No Console Errors

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Page loads without errors (no console errors related to highlights)
- Both filing panels render content
- Highlight markup is visible in at least one panel

<!-- Reference screenshot: screenshots/01-page-load-highlights.png -->

---

### 2. Word-Level Added Highlight (Filing B)

**Action:** Inspect a modified paragraph in the Filing B (new) panel that contains added words

**Verify:**
- Added words have a green background (`#dcfce7` / green-100)
- Added words have a green underline (`#16a34a` / green-600)
- The green background is clearly visible and distinct from surrounding text
- Only the changed words are highlighted — unchanged words in the same paragraph have no background

<!-- Reference screenshot: screenshots/02-word-added-highlight.png -->

---

### 3. Word-Level Removed Highlight (Filing A)

**Action:** Inspect a modified paragraph in the Filing A (old) panel that contains removed words

**Verify:**
- Removed words have a red background (`#fee2e2` / red-100)
- Removed words have a red strikethrough (`#dc2626` / red-600)
- The strikethrough line is clearly visible through the text
- Only the changed words are highlighted — unchanged words have no background

<!-- Reference screenshot: screenshots/03-word-removed-highlight.png -->

---

### 4. Whole Paragraph Added (Filing B)

**Action:** Find a paragraph in Filing B that is entirely new (not present in Filing A)

**Verify:**
- The entire paragraph has a light green background (`#f0fdf4` / green-50)
- A green left border (`#16a34a` / green-600, 3px) marks the paragraph
- No underline on the text (block-level `text-decoration: none`)
- The paragraph is clearly distinguishable from unchanged paragraphs

<!-- Reference screenshot: screenshots/04-paragraph-added.png -->

---

### 5. Whole Paragraph Removed (Filing A)

**Action:** Find a paragraph in Filing A that was removed (not present in Filing B)

**Verify:**
- The entire paragraph has a light red background (`#fef2f2` / red-50)
- A red left border (`#dc2626` / red-600, 3px) marks the paragraph
- No strikethrough on the text (block-level `text-decoration: none`)
- The paragraph is clearly distinguishable from unchanged paragraphs

<!-- Reference screenshot: screenshots/05-paragraph-removed.png -->

---

### 6. Unchanged Content

**Action:** Find paragraphs in both panels that are unchanged between filings

**Verify:**
- No background color applied
- No underline or strikethrough
- Text renders identically to the original filing HTML
- No `<ins>` or `<del>` elements visible in the DOM (inspect via DevTools)

<!-- Reference screenshot: screenshots/06-unchanged-content.png -->

---

### 7. Nested HTML Preservation

**Action:** Find a highlighted word/phrase that is inside bold, italic, or span tags in the original HTML

**Verify:**
- Original formatting (bold, italic, etc.) is preserved within the highlight
- The highlight background appears behind the formatted text
- No broken or duplicated formatting

<!-- Reference screenshot: screenshots/07-nested-html.png -->

---

### 8. Cross-Tag Highlight Rendering

**Action:** Find a highlight that spans across an HTML tag boundary (e.g., part bold, part not)

**Verify:**
- The highlight appears as a single continuous visual region (same color)
- No visual gap or discontinuity at the tag boundary
- Bold/italic formatting changes mid-highlight but the background is seamless

<!-- Reference screenshot: screenshots/08-cross-tag-highlight.png -->

---

### 9. Side-by-Side Comparison

**Action:** Compare the same section across Filing A and Filing B panels

**Verify:**
- Filing A (old) shows only red highlights (`<del>` elements) — no green
- Filing B (new) shows only green highlights (`<ins>` elements) — no red
- Unchanged content appears identical in both panels
- The highlights in A and B correspond to each other (removed text in A maps to added text in B)

<!-- Reference screenshot: screenshots/09-side-by-side.png -->

---

### 10. Multiple Sections with Highlights

**Action:** Scroll through both panels to verify highlights across multiple document sections

**Verify:**
- Highlights render correctly in different sections (not just the first)
- Section headings are not affected by highlight markup
- Scrolling within a panel does not break highlight rendering

<!-- Reference screenshot: screenshots/10-multiple-sections.png -->

---

### 11. Color Contrast (Accessibility)

**Action:** Inspect text readability on highlight backgrounds

**Verify:**
- Dark text on green-100 background (`#dcfce7`) is clearly readable
- Dark text on red-100 background (`#fee2e2`) is clearly readable
- Strikethrough text on red background is still legible (not obscured by line)
- The underline on green highlights is visible but does not interfere with readability
- Additions and removals are distinguishable by more than just color (underline vs. strikethrough)

<!-- Reference screenshot: screenshots/11-color-contrast.png -->

---

### 12. No Highlights Without Diff Data

**Action:** Temporarily remove the `sectionDiffs` prop from a FilingPanel (or view a panel with no matching sectionDiff IDs)

**Verify:**
- Filing content renders normally with no highlight markup
- No visual artifacts from the highlight CSS
- Behavior is identical to US-2.3

<!-- Reference screenshot: screenshots/12-no-diff-data.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2-5-paragraph-diff/screenshots/
  01-page-load-highlights.png
  02-word-added-highlight.png
  03-word-removed-highlight.png
  04-paragraph-added.png
  05-paragraph-removed.png
  06-unchanged-content.png
  07-nested-html.png
  08-cross-tag-highlight.png
  09-side-by-side.png
  10-multiple-sections.png
  11-color-contrast.png
  12-no-diff-data.png
```

## Pass/Fail Criteria

- **Pass:** All 12 steps verified, highlight colors match design tokens, no visual defects, no console errors, accessibility criteria met
- **Fail:** Any step shows incorrect highlight colors, broken HTML nesting, missing highlights, console errors, or illegible text on highlight backgrounds
