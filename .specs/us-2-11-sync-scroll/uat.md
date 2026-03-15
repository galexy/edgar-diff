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

**Result:** CONDITIONAL PASS
- Sync scrolling works when scrolling incrementally (as a user would with mouse wheel)
- **Known issue:** When scrolling via SectionNav clicks (which scroll both panels simultaneously), the sync scroll hook can interfere with the target destination due to the 150ms settle timeout being shorter than Chrome's smooth scroll duration (~500ms). Reported to coder for fix.

**Screenshot:** `screenshots/02-uat2-filings-loaded.png`, `screenshots/04-uat2-sync-scrolling.png`

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

1. **SectionNav interference (reported to coder):** When sync is enabled and a user clicks a section in the SectionNav, the sync scroll hook detects intermediate sections during the smooth scroll animation and fires competing `scrollIntoView` calls. This causes both panels to end up at the wrong section. Root cause: `SCROLL_SETTLE_MS` (150ms) is shorter than Chrome's smooth scroll duration (~500ms).

---

## Summary

| UAT | Status | Notes |
|-----|--------|-------|
| UAT-1: Toggle Visibility | PASS | Blue styling, aria-pressed=true |
| UAT-2: Sync Scrolling | CONDITIONAL PASS | Works incrementally; SectionNav interference bug |
| UAT-3: Toggle Disables | PASS | Panel B stays put when sync disabled |
| UAT-4: Toggle Re-enables | PASS | Panel B resumes following after re-enable |
| UAT-5: Bidirectional | PASS | Panel A follows Panel B scroll |

## Revision History

| Date | Changes |
|------|---------|
| 2026-03-14 | Initial UAT execution for US-2.11 |
