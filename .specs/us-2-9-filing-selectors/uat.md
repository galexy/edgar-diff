# US-2.9: Filing Selectors — UAT

Manual acceptance tests executed by a tester agent via Chrome DevTools MCP at the end of the dev/test cycle. These are **not** automated Vitest tests — they are visual sanity checks that verify the rendered page matches the design intent.

**Recording requirements:** Screenshots MUST be saved to `.specs/us-2-9-filing-selectors/screenshots/` and committed alongside the implementation. UAT results (pass/fail for each step, with a brief summary) MUST be recorded in the implementation PR body or as a PR comment, with screenshots attached/embedded so reviewers can see the visual verification without running the app.

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Company search feature (US-2.8) implemented and working
- Filing selector feature (US-2.9) implemented
- Worker endpoint available (local Wrangler or proxied)

## Test Steps

### 1. Filing Selectors — Default State (No Company Selected)

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- Both Filing A and Filing B panels have a dropdown/select element visible
- Both selectors are disabled (grayed out, cursor-not-allowed)
- Both show placeholder text "Select a filing..."
- Selectors are visually consistent between the two panels (same size, alignment, styling)
- No layout shift or clipping around the selectors

<!-- Reference screenshot: screenshots/01-selectors-disabled.png -->

---

### 2. Filing Selectors — Enabled After Company Selection

**Action:** Search for "AAPL" in the search bar, select "Apple Inc." from the dropdown, and wait for the company to resolve

**Verify:**
- Both filing selectors transition from disabled to enabled
- Placeholder text changes or remains as "Select a filing..." but selector is now interactive
- No layout shift when selectors become enabled
- The transition is smooth (no flash of unstyled content)

<!-- Reference screenshot: screenshots/02-selectors-enabled.png -->

---

### 3. Filing Dropdown — Options Display

**Action:** Click on the Filing A selector to open the dropdown

**Verify:**
- Dropdown opens and shows a list of filings
- Each option displays form type and filing date (e.g., "10-K | 2023-11-03")
- Options are sorted by date with most recent first
- Only supported form types appear (10-K, 10-K/A, 10-Q, 10-Q/A — no 8-K, S-1, etc.)
- Dropdown is readable and options are not truncated or overlapping
- Dropdown has clear visual boundaries

<!-- Reference screenshot: screenshots/03-dropdown-options.png -->

---

### 4. Filing Selection — Filing A

**Action:** Select a filing from the Filing A dropdown (e.g., "10-K | 2023-11-03")

**Verify:**
- Selected filing is displayed in the selector
- Dropdown closes after selection
- The selected option text is fully visible in the closed selector
- No visual artifacts or stale text

<!-- Reference screenshot: screenshots/04-filing-a-selected.png -->

---

### 5. Filing Selection — Filing B

**Action:** Click on the Filing B selector and select a different filing (e.g., "10-Q | 2023-08-04")

**Verify:**
- Filing B dropdown shows the same list of filings as Filing A
- Selected filing is displayed in the Filing B selector
- Filing A retains its previous selection (still shows "10-K | 2023-11-03")
- Both selectors show their respective selections independently

<!-- Reference screenshot: screenshots/05-filing-b-selected.png -->

---

### 6. Independent Selections — Both Panels

**Action:** Verify both panels after making different selections in step 4 and step 5

**Verify:**
- Filing A shows "10-K | 2023-11-03" (or whichever was selected)
- Filing B shows "10-Q | 2023-08-04" (or whichever was selected)
- Neither selection has overwritten the other
- Both selectors remain interactive (can change selections)

<!-- Reference screenshot: screenshots/06-independent-selections.png -->

---

### 7. Company Change — Selectors Reset

**Action:** Clear the search bar and search for a different company (e.g., "MSFT"), select "Microsoft Corporation"

**Verify:**
- Previous filing selections are cleared from both selectors
- Both selectors reload with Microsoft's filings
- Filing options show Microsoft's filing dates (different from Apple's)
- Selectors are enabled and interactive with new data
- No stale Apple filing data visible

<!-- Reference screenshot: screenshots/07-company-change-reset.png -->

---

### 8. Company Clear — Selectors Disable

**Action:** Clear the search input entirely (click the clear button or delete all text)

**Verify:**
- Both filing selectors revert to disabled state
- Both show placeholder text "Select a filing..."
- Both are grayed out with cursor-not-allowed
- No stale filing data visible
- State matches the initial load (step 1)

<!-- Reference screenshot: screenshots/08-selectors-after-clear.png -->

---

### 9. Loading State — During Filing Fetch

**Action:** Search for a company and observe the filing selectors during the submissions API call

**Verify:**
- A loading indicator is visible while filings are being fetched (spinner, text, or skeleton)
- Selectors are disabled during loading
- Loading indicator disappears once filings are loaded
- Transition from loading to populated is smooth

<!-- Reference screenshot: screenshots/09-loading-state.png -->

---

### 10. Responsive — Narrow Viewport (768px)

**Action:** Resize viewport to 768x800. Select a company and interact with filing selectors.

**Verify:**
- Filing selectors adapt to narrower panel width
- Dropdown options are readable (text may truncate with ellipsis if needed)
- Selectors are still usable (can open, select, close)
- No horizontal overflow or layout breakage
- Both panels remain visible side by side (or stack appropriately)

<!-- Reference screenshot: screenshots/10-responsive-768.png -->

---

### 11. Responsive — Mobile Viewport (375px)

**Action:** Resize viewport to 375x800. Select a company and interact with filing selectors.

**Verify:**
- Filing selectors fill available width within their panels
- Dropdown is usable (not clipped or overflowing viewport)
- Touch targets are adequately sized
- Option text wraps or truncates readably
- No layout breakage

<!-- Reference screenshot: screenshots/11-responsive-375.png -->

---

### 12. No Console Errors During Interaction

**Action:** Open browser DevTools console. Perform full flow: select company → open dropdowns → select filings → change company → clear search.

**Verify:**
- No JavaScript errors in the console
- No React warnings (missing keys, prop type errors, state-update-on-unmounted)
- No failed network requests (other than intentionally triggered errors)
- No CORS errors
- No abort-related errors logged

<!-- Reference screenshot: screenshots/12-no-console-errors.png -->

---

## Reference Screenshots

Screenshots are captured during implementation and stored alongside this UAT doc for future comparison. They serve as informal visual baselines — not pixel-perfect regression tests.

```
.specs/us-2-9-filing-selectors/screenshots/
  01-selectors-disabled.png
  02-selectors-enabled.png
  03-dropdown-options.png
  04-filing-a-selected.png
  05-filing-b-selected.png
  06-independent-selections.png
  07-company-change-reset.png
  08-selectors-after-clear.png
  09-loading-state.png
  10-responsive-768.png
  11-responsive-375.png
  12-no-console-errors.png
```

## Pass/Fail Criteria

- **Pass:** All 12 steps verified. Filing selectors render correctly in disabled and enabled states. Dropdowns show filtered (supported types only) and sorted (most recent first) filings. Selections work independently in both panels. Company changes and clears properly reset selectors. Loading state is visible during fetch. Responsive layout holds at 768px and 375px. No console errors during the full interaction flow.
- **Fail:** Any step shows broken layout, missing or incorrect filing options, stale data after company change/clear, dependent selections between panels, missing loading state, console errors, or broken responsive behavior.
