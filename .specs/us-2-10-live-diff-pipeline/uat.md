# US-2.10: Live Diff Pipeline — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

**Recording requirements:** Screenshots MUST be saved to `.specs/us-2-10-live-diff-pipeline/screenshots/` and committed alongside the implementation. UAT results (pass/fail for each step, with a brief summary) MUST be recorded in the implementation PR body or as a PR comment, with screenshots attached/embedded so reviewers can see the visual verification without running the app.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Worker endpoint available (local Wrangler or proxied) with valid `SEC_USER_AGENT`
- A company with multiple filings available (e.g., search "AAPL" — Apple has many 10-K and 10-Q filings)

## Test Steps

### UAT-1. Loading Indicator — Fetching Stage

**Action:** Search for "AAPL", select Apple Inc., wait for filings to load. Select a 10-K in Filing A and a different 10-Q in Filing B.

**Verify:**
- A spinner/loading indicator appears in both filing panels immediately after both filings are selected
- Loading text says "Fetching filings from SEC..." (or similar stage-specific text)
- The spinner is visually centered in the panel content area
- Filing selectors remain visible and interactive above the loading area
- Section nav does not show stale data from a previous diff (empty or placeholder state)

<!-- Reference screenshot: screenshots/01-loading-fetching.png -->

---

### UAT-2. Loading Indicator — Parsing Stage

**Action:** Observe the loading indicator as the pipeline transitions from fetching to parsing.

**Verify:**
- Loading text updates to "Parsing filing content..." (or similar)
- Spinner continues animating (no flash or disappear/reappear)
- Transition between stages is smooth (no layout shift)

<!-- Reference screenshot: screenshots/02-loading-parsing.png -->

**Note:** This transition may be very fast for small filings. For large filings (10-K), it should be observable. If too fast to capture, verify via automated tests (DP-U4).

---

### UAT-3. Loading Indicator — Diffing Stage

**Action:** Observe the loading indicator as the pipeline transitions from parsing to diffing.

**Verify:**
- Loading text updates to "Computing differences..." (or similar)
- Spinner continues animating
- No layout shift between stages

<!-- Reference screenshot: screenshots/03-loading-diffing.png -->

**Note:** Same timing caveat as UAT-2.

---

### UAT-4. Diff Renders — Both Panels Show Content

**Action:** Wait for the pipeline to complete (loading indicator disappears).

**Verify:**
- Filing A panel shows the parsed content of the older filing (sections with headings, paragraphs, tables)
- Filing B panel shows the parsed content of the newer filing
- Both panels have independent scroll — scrolling one panel does not scroll the other
- Diff highlights are visible (added/removed/modified paragraphs and table cells have colored backgrounds)
- Section headings (Item 1, Item 1A, etc.) are present in both panels
- No loading indicator or placeholder text remains
- No "Filing content will appear here" placeholder visible

<!-- Reference screenshot: screenshots/04-diff-rendered.png -->

---

### UAT-5. Diff Renders — Panels Show Correct Sides

**Action:** Inspect the diff highlights in both panels.

**Verify:**
- Filing A (left/old panel) shows removal highlights (red background on removed content)
- Filing B (right/new panel) shows addition highlights (green background on added content)
- Modified content shows old→new annotations in both panels
- The filing metadata (form type, date) in each panel matches the selected filing
- Highlights are consistent with the section nav change count badges

<!-- Reference screenshot: screenshots/05-diff-sides-correct.png -->

---

### UAT-6. Error Display — Fetch Error (404)

**Action:** Select a filing with an invalid or removed accession number (if possible, manually edit the select value via DevTools to an invalid accession like "0000000000-00-000000"). Alternatively, disconnect the network after selecting a company and filings.

**Verify:**
- An error message appears in the panel content area
- Error message is user-friendly (e.g., "Filing not available" or "Unable to fetch filing"), not a raw exception
- Error text is styled distinctly (red text or red-accented container)
- Error has `role="alert"` in the DOM (inspect via DevTools Elements panel)
- Both panels show the error (unified pipeline status)
- Section nav does not show stale diff data
- Filing selectors remain interactive — user can change selection to recover

<!-- Reference screenshot: screenshots/06-error-fetch.png -->

---

### UAT-7. Error Display — Parse Error

**Action:** If feasible, trigger a parse error (this may require a specially crafted filing or mock). Otherwise, verify via automated tests (DP-U15) and confirm that the error UI pattern from UAT-6 would apply — the same `role="alert"` region and user-friendly message pattern.

**Verify:**
- Error message contains "parse" or "Unable to parse" wording
- Same visual treatment as fetch errors (red-accented, centered in panel)
- Filing selectors remain interactive for recovery

<!-- Reference screenshot: screenshots/07-error-parse.png -->

---

### UAT-8. Cache Behavior — Instant Re-display

**Action:**
1. Select Filing A (10-K 2023) and Filing B (10-Q 2023) — wait for diff to render
2. Change Filing B to a different filing (e.g., 10-Q 2022) — observe loading
3. Change Filing B back to the original (10-Q 2023) — observe behavior

**Verify:**
- Step 3 shows the diff **instantly** — no spinner, no "Fetching..." indicator
- The diff content appears immediately (same result as step 1)
- Section nav and change count badges populate instantly
- The previously computed diff is pixel-identical to the first render (same highlights, same sections)

<!-- Reference screenshot: screenshots/08-cache-instant.png -->

---

### UAT-9. Section Nav Integration

**Action:** After a diff has rendered, inspect the section navigation sidebar.

**Verify:**
- Section nav buttons correspond to the sections in the diff (Item 1, Item 1A, Item 2, etc.)
- Change count badges (amber pills) appear next to sections that have changes
- Unchanged sections do not have badges (or show "0" — depending on design)
- Diff summary bar at the top/bottom shows aggregate counts (e.g., "2 modified, 1 unchanged")
- Clicking a section nav button scrolls both panels to the matching section
- Scroll is smooth (`behavior: 'smooth'`)
- Active section is highlighted in the nav (after scrolling or via IntersectionObserver)

<!-- Reference screenshot: screenshots/09-section-nav.png -->

---

### UAT-10. Responsive — Tablet Viewport (768px)

**Action:** Resize viewport to 768x800. Select a company, select both filings, wait for diff.

**Verify:**
- Loading indicator is visible and centered (not clipped)
- Error messages wrap correctly (no horizontal overflow)
- Diff content renders without horizontal scrollbar on the main layout
- Section nav may collapse or adapt (depends on responsive design)
- Filing selectors remain usable
- Both panels are visible (may stack vertically at narrow widths)
- Change count badges are readable

<!-- Reference screenshot: screenshots/10-responsive-768.png -->

---

### UAT-11. Responsive — Mobile Viewport (375px)

**Action:** Resize viewport to 375x800. Select a company, select both filings, wait for diff.

**Verify:**
- Layout adapts to single-column or stacked arrangement
- Loading indicator is visible and not clipped
- Error messages are readable and wrapped
- Filing selectors are usable (touch-friendly target size)
- No horizontal scrollbar on the body
- Content is not truncated or hidden

<!-- Reference screenshot: screenshots/11-responsive-375.png -->

---

### UAT-12. No Console Errors During Full Flow

**Action:** Open browser DevTools console. Perform the full flow: search company → select → wait for filings → select Filing A → select Filing B → wait for diff → change Filing B → wait → change back (cache hit) → clear company.

**Verify:**
- No JavaScript errors in the console
- No React warnings (missing keys, prop type errors, "Can't perform state update on unmounted component")
- No failed network requests (other than intentionally triggered errors)
- No CORS errors
- No unhandled promise rejections

<!-- Reference screenshot: screenshots/12-no-console-errors.png -->

---

### UAT-13. Worker Proxy Verification

**Action:** Open the Network tab in DevTools. Select a company and both filings. Observe the network requests during the pipeline.

**Verify:**
- Filing fetch requests go through `/api/sec/archives/...` (not directly to `www.sec.gov`)
- EFTS search requests (if any) go through `/api/sec/efts/...` (not directly to `efts.sec.gov`)
- No CORS errors in the console
- Responses contain valid filing HTML (check response body in Network tab)
- Request headers do NOT include `User-Agent` from the browser (Worker proxy adds it)
- Response status codes are 200 for successful fetches

<!-- Reference screenshot: screenshots/13-worker-proxy.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2-10-live-diff-pipeline/screenshots/
  01-loading-fetching.png
  02-loading-parsing.png
  03-loading-diffing.png
  04-diff-rendered.png
  05-diff-sides-correct.png
  06-error-fetch.png
  07-error-parse.png
  08-cache-instant.png
  09-section-nav.png
  10-responsive-768.png
  11-responsive-375.png
  12-no-console-errors.png
  13-worker-proxy.png
```

## Pass/Fail Criteria

- **Pass:** All 13 steps verified. Loading indicators show stage-specific text during each pipeline phase. Diff renders correctly in both panels with appropriate side-specific highlights. Error messages are user-friendly and displayed in `role="alert"` regions. Cached pairs return instantly with no loading spinner. Section nav updates with correct change counts and scroll-to-section works. Layout holds at 768px and 375px viewports. No console errors throughout the full flow. Worker proxy routes all SEC requests correctly.

- **Fail:** Any step shows: missing or stuck loading indicator, diff rendering in wrong panels, raw error messages or stack traces shown to user, cache miss when same pair is re-selected (spinner appears), section nav shows stale data or wrong counts, layout breakage at responsive viewports, JavaScript errors or React warnings in console, or direct requests to SEC domains bypassing the Worker proxy.
