# US-2.8: Company Search — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

**Recording requirements:** Screenshots MUST be saved to `.specs/us-2.8-company-search/screenshots/` and committed alongside the implementation. UAT results (pass/fail for each step, with a brief summary) MUST be recorded in the implementation PR body or as a PR comment, with screenshots attached/embedded so reviewers can see the visual verification without running the app.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Company search feature implemented with SearchBar combobox
- Worker endpoint available (local Wrangler or proxied)

## Test Steps

### 1. Search Bar Appearance — Default State

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Search bar is visually prominent in the header area
- Input is enabled (not grayed out or disabled)
- Placeholder text is visible and readable (mentions ticker, name, or CIK)
- Search bar spans an appropriate width (not too narrow to type a company name)
- No layout shift or visual clipping around the search bar

<!-- Reference screenshot: screenshots/01-search-bar-default.png -->

---

### 2. Search Bar Focus State

**Action:** Click on the search bar to give it focus

**Verify:**
- A visible focus ring or border change appears on focus
- Placeholder text remains visible until user types
- Cursor is active inside the input field
- No dropdown or listbox appears on focus alone (only after typing)

<!-- Reference screenshot: screenshots/02-search-bar-focused.png -->

---

### 3. Typing — Dropdown Appears with Matches

**Action:** Type "AAPL" in the search bar and wait for debounce (~300ms)

**Verify:**
- A dropdown/listbox appears below the search input
- At least one match is shown: "Apple Inc." with ticker "AAPL"
- Each match displays the company name and ticker symbol
- Dropdown is visually contained (no overflow outside viewport)
- Dropdown has a clear visual boundary (border, shadow, or background)

<!-- Reference screenshot: screenshots/03-dropdown-matches.png -->

---

### 4. Dropdown Hover Interaction

**Action:** Move the mouse over the dropdown matches

**Verify:**
- Hovered match is visually highlighted (background color change)
- Non-hovered matches remain in default style
- Mouse cursor shows pointer (indicating clickable)

<!-- Reference screenshot: screenshots/04-dropdown-hover.png -->

---

### 5. Keyboard Navigation of Dropdown

**Action:** With dropdown open, press ArrowDown to move through matches, then ArrowUp

**Verify:**
- ArrowDown highlights the next match in the list
- ArrowUp highlights the previous match
- Only one match is highlighted at a time
- Highlighted match is visually distinct from non-highlighted matches
- Focus remains on the input field (not moved to the list)

<!-- Reference screenshot: screenshots/05-keyboard-navigation.png -->

---

### 6. Select Match — Loading State

**Action:** Click on "Apple Inc." in the dropdown (or press Enter on highlighted match)

**Verify:**
- Dropdown closes after selection
- A loading indicator appears (spinner, skeleton, or "Loading..." text)
- Loading indicator is visually distinct and clearly visible
- Input shows the selected company name or ticker
- User cannot interact with results area during loading

<!-- Reference screenshot: screenshots/06-loading-state.png -->

---

### 7. Successful Resolution — Company Display

**Action:** Wait for the API call to resolve after selecting "AAPL"

**Verify:**
- Company name "Apple Inc." is displayed clearly
- CIK number "0000320193" is displayed alongside the name
- Result area is visually distinct from the search input (different background, border, or section)
- No layout shift when the result appears
- Loading indicator is removed
- The resolved information is easy to read (appropriate font size, contrast)

<!-- Reference screenshot: screenshots/07-successful-resolution.png -->

---

### 8. No Matches — Empty State

**Action:** Clear the input and type "XYZNOTREAL", wait for debounce

**Verify:**
- Dropdown shows a "No matches found" message or remains empty/hidden
- The empty state message is readable and not confusing
- No API call is triggered (check Network tab)
- No error styling is shown (this is not an error, just no results)

<!-- Reference screenshot: screenshots/08-no-matches.png -->

---

### 9. Error State Display

**Action:** Trigger an API error (e.g., disconnect network, or use a CIK that causes a server error)

**Verify:**
- An error message is visible and readable
- Error text is clear and user-friendly (not a raw exception or stack trace)
- Error styling distinguishes it from normal content (e.g., red text or red border)
- The search bar remains usable — user can type a new query to retry
- Error is announced to screen readers (check for `role="alert"`)

<!-- Reference screenshot: screenshots/09-error-state.png -->

---

### 10. Sequential Search — Previous Result Clears

**Action:** Search "AAPL" → select → see result → clear input → type "MSFT" → select → see result

**Verify:**
- When user starts typing a new query, the previous company result disappears
- New dropdown matches appear for the new query
- After selecting Microsoft, the result shows "Microsoft Corporation" (not Apple)
- No visual artifacts or ghost results from the previous search
- Loading state works correctly for the second search too

<!-- Reference screenshot: screenshots/10-sequential-search.png -->

---

### 11. Clear Input — Full Reset

**Action:** After a successful search result is displayed, clear the input field entirely

**Verify:**
- Company result disappears
- Dropdown closes
- Any error messages are cleared
- Search bar returns to its default state (placeholder visible)
- No stale data visible anywhere

<!-- Reference screenshot: screenshots/11-clear-reset.png -->

---

### 12. Keyboard-Only Full Flow

**Action:** Tab to the search bar, type "MSFT", press ArrowDown to highlight, press Enter to select, wait for result

**Verify:**
- Focus management works — Tab lands on the search input
- Typing activates the dropdown
- ArrowDown/Enter workflow selects without needing mouse
- Escape closes the dropdown without selecting
- The resolved company result is displayed after Enter
- Screen reader announcements are correct (check `aria-live` regions)

<!-- Reference screenshot: screenshots/12-keyboard-flow.png -->

---

### 13. Responsive — Narrow Viewport (768px)

**Action:** Resize viewport to 768x800. Perform a search and select a result.

**Verify:**
- Search bar adapts to narrower width without clipping
- Dropdown fits within the viewport (no horizontal overflow)
- Match text is readable (may truncate with ellipsis if needed)
- Result/error text wraps correctly
- No horizontal scrollbar appears

<!-- Reference screenshot: screenshots/13-responsive-768.png -->

---

### 14. Responsive — Mobile Viewport (375px)

**Action:** Resize viewport to 375x800. Perform a search and select a result.

**Verify:**
- Search bar fills available width
- Dropdown is usable (not clipped or overflowing)
- Touch targets are adequately sized for mobile
- Result display wraps and remains readable
- No layout breakage

<!-- Reference screenshot: screenshots/14-responsive-375.png -->

---

### 15. Accessibility — Screen Reader Semantics

**Action:** Inspect the DOM for ARIA attributes on the search bar and dropdown

**Verify:**
- Input has `role="combobox"`
- Input has `aria-expanded` attribute (false when closed, true when open)
- Input has `aria-controls` pointing to the listbox ID
- Input has `aria-autocomplete="list"`
- Dropdown list has `role="listbox"`
- Each option has `role="option"`
- Selected/highlighted option has `aria-selected="true"`
- Result area has `aria-live="polite"` for dynamic updates
- Error area has `role="alert"`
- The entire search area is wrapped in `role="search"`

<!-- Reference screenshot: screenshots/15-accessibility-aria.png -->

---

### 16. No Console Errors During Interaction

**Action:** Open browser DevTools console. Perform full search flow: type, select, see result, clear, search again, trigger error.

**Verify:**
- No JavaScript errors in the console
- No React warnings (missing keys, prop type errors, state-update-on-unmounted)
- No failed network requests (other than intentionally triggered errors)
- No CORS errors

<!-- Reference screenshot: screenshots/16-no-console-errors.png -->

---

### 17. Worker Endpoint Verification

**Action:** Search for a real ticker (e.g., "AAPL") and select. Check the Network tab.

**Verify:**
- Network requests go through the Worker endpoint (not directly to `data.sec.gov`)
- No CORS errors in the console
- Response contains valid company data matching the real SEC data
- Request/response headers look correct

<!-- Reference screenshot: screenshots/17-worker-endpoint.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2.8-company-search/screenshots/
  01-search-bar-default.png
  02-search-bar-focused.png
  03-dropdown-matches.png
  04-dropdown-hover.png
  05-keyboard-navigation.png
  06-loading-state.png
  07-successful-resolution.png
  08-no-matches.png
  09-error-state.png
  10-sequential-search.png
  11-clear-reset.png
  12-keyboard-flow.png
  13-responsive-768.png
  14-responsive-375.png
  15-accessibility-aria.png
  16-no-console-errors.png
  17-worker-endpoint.png
```

## Pass/Fail Criteria

- **Pass:** All 17 steps verified. Search bar renders correctly in default, focused, and active states. Dropdown appears with matches, supports keyboard navigation and hover interaction. Loading state is visible during API calls. Successful resolution displays company name and CIK. Error states are user-friendly and accessible. Sequential searches clear previous results. Responsive layout holds at 768px and 375px. ARIA attributes are correct for combobox pattern. No console errors. Worker endpoint handles requests without CORS issues.
- **Fail:** Any step shows broken layout, missing dropdown matches, incorrect or missing loading/error states, stale data from previous searches, inaccessible combobox pattern, console errors, CORS failures, or broken responsive behavior.
