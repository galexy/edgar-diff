# US-2.11 Synchronized Scrolling — UAT

## Prerequisites

- Dev server running: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
- Chrome DevTools MCP connected
- Default viewport: 1280x800
- Two filings loaded (e.g., AAPL 10-K 2024 vs 10-K 2025)

---

## UAT-1: Sync Toggle Button Visibility

**Action:** Navigate to `http://localhost:5173`

**Verify:**
- "Sync Scroll" toggle button visible in Header (top-right)
- Button shows enabled state (blue styling, link icon)
- Button has `aria-pressed="true"` (sync ON by default)

**Result:** PASS
**Screenshot:** `screenshots/01-uat1-sync-toggle-visible.png`

---

## UAT-2: Sync Scrolling Works

**Action:** Load two filings, scroll Filing A down several sections

**Verify:**
- Filing B scrolls to follow Filing A's section
- Both panels show content from similar sections

**Result:** PASS (with known caveat)
- Sync scrolling works correctly when scrolling incrementally (as a user would with mouse wheel)
- Panel A scrolled to item-7a area (scrollTop 42000), Panel B synced to item-7 area (scrollTop 37013) — adjacent sections, correct sync behavior
- **Caveat:** SectionNav click interference persists after coder's fix (commit 8b5662a changed sync hook to `behavior: 'instant'`). When clicking a section in SectionNav, Panel A navigates correctly but Panel B may land one section off (e.g., item-6 instead of item-7). This is because the SectionNav click handler scrolls both panels with `behavior: 'smooth'`, and the sync hook's scroll listener interrupts Panel B's smooth scroll. This does NOT affect normal user scrolling (mouse wheel, trackpad), which is the primary use case.

**Screenshot:** `screenshots/02-uat2-filings-loaded.png`, `screenshots/04-uat2-sync-scrolling.png`, `screenshots/09-uat2-retest-manual-sync.png`, `screenshots/10-uat2-sectionnav-interference.png`

---

## UAT-3: Toggle Disables Sync

**Action:** Click "Sync Scroll" toggle to disable, then scroll Filing A

**Verify:**
- Button shows disabled state (gray styling, broken chain icon)
- Button has `aria-pressed="false"`
- Scrolling Filing A does NOT cause Filing B to follow
- Panels scroll independently

**Result:** PASS
- Panel B stayed at scrollTop 32982 while Panel A scrolled from 33600 to 48600

**Screenshot:** `screenshots/05-uat3-sync-disabled.png`, `screenshots/06-uat3-independent-scroll.png`

---

## UAT-4: Toggle Re-enables Sync

**Action:** Click "Sync Scroll" toggle to re-enable, then scroll Filing A

**Verify:**
- Button shows enabled state (blue styling, link icon)
- Button has `aria-pressed="true"`
- Scrolling Filing A causes Filing B to follow again

**Result:** PASS
- Panel B moved from 32982 to 81642 after re-enabling sync and scrolling Panel A

**Screenshot:** `screenshots/07-uat4-sync-reenabled.png`

---

## UAT-5: Bidirectional Sync

**Action:** With sync enabled, scroll Filing B instead of Filing A

**Verify:**
- Filing A scrolls to match Filing B's position
- Sync works in both directions

**Result:** PASS
- Panel A moved from 81100 to 37206 when Panel B was scrolled up
- Both panels converged on the same section area (item-5/item-7)

**Screenshot:** `screenshots/08-uat5-bidirectional-sync.png`

---

## Known Issues

1. **SectionNav click interference (reduced but not resolved):** When sync is enabled and a user clicks a section in the SectionNav, the sync hook's scroll listener fires during Panel B's smooth scroll animation and redirects it to an intermediate section via `scrollIntoView({ behavior: 'instant' })`. Result: Panel A lands on the correct section, Panel B lands one section off. Root cause: `handleSectionClick` (App.tsx) scrolls both panels with `behavior: 'smooth'`, but the sync hook intercepts Panel B's scroll events mid-animation. Coder's fix (commit 8b5662a — `instant` instead of `smooth` in sync hook) improved the overshoot but doesn't prevent the interference. A proper fix would require a scroll guard in the click handler or disabling sync during programmatic scrolls. **Impact: Low** — affects only SectionNav clicks, not the primary use case of manual scrolling.

---

## Summary

| UAT | Status | Notes |
|-----|--------|-------|
| UAT-1: Toggle Visibility | PASS | Blue styling, aria-pressed=true |
| UAT-2: Sync Scrolling | PASS (caveat) | Manual scroll sync works; SectionNav click off-by-one persists |
| UAT-3: Toggle Disables | PASS | Panel B stays put when sync disabled |
| UAT-4: Toggle Re-enables | PASS | Panel B resumes following after re-enable |
| UAT-5: Bidirectional | PASS | Panel A follows Panel B scroll |

## Revision History

| Date | Changes |
|------|---------|
| 2026-03-14 | Initial UAT execution for US-2.11 |
| 2026-03-14 | Re-tested UAT-2 after coder fix (8b5662a). Manual sync confirmed PASS. SectionNav interference reduced but not eliminated — documented as low-impact caveat |
