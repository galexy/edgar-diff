# UI Testing Practices

This document defines the two-tier testing strategy for UI stories in the Edgar-Differ web app.

## Two Tiers of UI Testing

### Tier 1: Automated Tests (Vitest + Testing Library)

**What:** Unit and integration tests in `*.test.tsx` files, run via `pnpm nx run web:test`.

**What they cover:**
- DOM structure and element existence
- Text content and ARIA attributes
- Semantic HTML landmarks (header, nav, main)
- Component composition (App renders all sub-components)
- DOM ordering
- Accessibility (roles, labels, heading hierarchy)
- Interactive behavior (click handlers, state changes)

**What they cannot cover (jsdom limitations):**
- Visual layout (columns side-by-side, spacing, alignment)
- Computed CSS (actual widths, colors, fonts)
- Scroll behavior (independent scroll, overflow)
- Responsive breakpoints (viewport resizing)
- Pixel rendering

**When to write:** Every UI story gets automated tests. Write them during implementation as part of TDD or immediately after. These are the primary regression safety net.

**Where they live:** Co-located with the component they test:
```
apps/web/src/
  components/
    Header.test.tsx
    SearchBar.test.tsx
  App.test.tsx
```

---

### Tier 2: UAT (Agent-Executed Manual Checks)

**What:** Step-by-step visual checks executed by a tester agent via Chrome DevTools MCP. The agent navigates the running app, takes screenshots, and verifies that the rendered page matches the design intent.

**What they cover:**
- Visual layout correctness (columns, spacing, alignment)
- Responsive behavior at different viewports
- Scroll behavior (independent panel scrolling)
- Overall visual appearance (colors, typography, borders)
- Absence of console errors
- Graceful degradation at narrow viewports

**When to run:** At the **end of the dev/test cycle**, after all automated tests pass. UAT is the final sanity check before a PR is considered complete. Think of it as the agent equivalent of a developer eyeballing the page in a browser.

**Two levels of UAT docs:**

#### Story-Level UAT (`.specs/<story>/uat.md`)

Detailed checks specific to a single story. Lives with the spec and contains the full set of verification steps, reference screenshot placeholders, and pass/fail criteria for that story. Created during the design phase.

```
.specs/us-2-2-layout-skeleton/uat.md
.specs/us-2-3-filing-content/uat.md
```

#### App-Level UAT (`apps/web/tests/uat.md`)

A cumulative, **pruned** sanity suite covering the entire app. Updated by each story — new checks are added, obsolete checks are removed or rewritten. Used for regular full-app validation across stories, not just for the story that introduced the check.

```
apps/web/tests/uat.md
```

**Each story must update both:** create its own `.specs/<story>/uat.md` AND update the app-level `apps/web/tests/uat.md` (adding new checks, pruning checks that are no longer relevant due to UI changes). The app-level file should stay concise — it's a sanity suite, not an exhaustive test log.

---

## UAT Document Structure

Every `uat.md` follows this format:

1. **Prerequisites** — What needs to be running (dev server, MCP connection, viewport size)
2. **Numbered test steps** — Each step includes:
   - **Action:** What to do (navigate, resize, scroll, click)
   - **Verify:** What to check (bulleted list of expected visual outcomes)
   - **Reference screenshot comment:** Placeholder for a screenshot to compare against
3. **Reference screenshots** — Captured during initial implementation, stored alongside the UAT doc in a `screenshots/` directory
4. **Pass/fail criteria** — Clear definition of what constitutes a pass or fail

### Reference Screenshots

Screenshots are captured by the implementing agent during the first successful implementation and committed alongside the UAT doc:

```
.specs/<story-name>/screenshots/
  01-step-name.png
  02-step-name.png
```

These serve as **informal visual baselines** for future comparison. They are not pixel-perfect regression tests — a tester agent compares them by inspection, not by diff. When the UI intentionally changes (e.g., visual polish in a later story), the reference screenshots should be updated.

---

## When to Use Each Tier

| Scenario | Tier 1 (Automated) | Tier 2 (UAT) |
|----------|-------------------|---------------|
| Component renders correct text | Yes | - |
| Semantic HTML landmarks | Yes | - |
| Accessibility (ARIA, labels) | Yes | - |
| Three columns are side-by-side | - | Yes |
| Panels scroll independently | - | Yes |
| Layout at narrow viewport | - | Yes |
| Button click triggers state change | Yes | - |
| Visual appearance matches design | - | Yes |
| Console errors on page load | - | Yes |

**Rule of thumb:** If jsdom can verify it, write an automated test. If it requires a rendered browser, put it in the UAT.

---

## Workflow Integration

For any UI story:

1. **Design phase:** Write test plan (automated tests) AND story-level UAT doc in `.specs/<story>/`
2. **Implementation phase:** Write code + automated tests (TDD or test-after)
3. **Verification phase:**
   - Run `NX_OUTPUT_STYLE=stream pnpm nx run web:test` — all automated tests pass
   - Run story-level UAT steps via Chrome DevTools MCP — all visual checks pass
   - Capture reference screenshots (first implementation only)
4. **Update app-level UAT:** Add new checks to `apps/web/tests/uat.md`, prune obsolete ones
5. **Run app-level UAT:** Sanity-check the full app (not just the story) via MCP
6. **PR review:** Automated tests provide regression safety; UAT docs provide visual verification record
