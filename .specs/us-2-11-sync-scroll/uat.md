# US-2.11 Synchronized Scrolling — UAT Results

> Executed: 2026-03-15
> Agent: Tester (Shannon)
> Browser: Chrome via DevTools MCP
> Dev server: localhost:5175

## Prerequisites

- Dev server running (`pnpm nx run web:dev`)
- Chrome DevTools MCP connected
- AAPL selected, two 10-K filings loaded (2024-11-01 and 2025-10-31)

---

## UAT-1: Toggle Visibility — PASS

**Action:** Navigate to http://localhost:5175
**Verify:**
- [x] "Sync Scroll" toggle button is visible in the Header
- [x] Button has `aria-pressed="true"` (enabled by default)
- [x] Blue enabled styling (`bg-blue-100 text-blue-700`)

**Screenshot:** `screenshots/01-uat1-toggle-visible-enabled.png`

---

## UAT-2: Content-Aligned Sync — PASS

**Action:** Load AAPL 10-K 2024 (Filing A) and 10-K 2025 (Filing B). Scroll Filing A.
**Verify:**
- [x] Both panels loaded with content (639 and 628 annotated blocks respectively)
- [x] At scrollTop=5000: Both panels show "iPad is the Company's line of multipurpose tablets..." — identical content at different source offsets (171848 old, 168056 new)
- [x] At scrollTop=40000: Both panels show "Mac" — exact content alignment on unchanged content
- [x] Content correspondence is correct — not just proportional scrolling, but actual content matching

**Key contrast with v1/v2:** This is NOT section-snapping (v1) or proportional mapping (v2). The offset-based lookup finds the actual corresponding paragraph in the other document.

**Screenshots:**
- `screenshots/02-uat2-both-panels-loaded.png`
- `screenshots/03-uat2-content-aligned-scroll-5000.png`
- `screenshots/04-uat2-content-aligned-scroll-40000.png`

---

## UAT-3: Toggle Disables Sync — PASS

**Action:** Click "Sync Scroll" toggle to disable. Scroll Filing A.
**Verify:**
- [x] Toggle shows `aria-pressed="false"` after click
- [x] Gray disabled styling (`bg-gray-100 text-gray-500`)
- [x] Filing A scrolled to 15000, Filing B stayed at 0
- [x] No programmatic scroll on Filing B

**Screenshots:**
- `screenshots/05-uat3-toggle-disabled.png`
- `screenshots/06-uat3-independent-scroll.png`

---

## UAT-4: Toggle Re-enables Sync — PASS

**Action:** Click toggle to re-enable. Scroll Filing A.
**Verify:**
- [x] Toggle shows `aria-pressed="true"` after re-click
- [x] Filing A scrolled to 10000, Filing B followed to 9912
- [x] Sync resumed from current positions

**Screenshot:** `screenshots/07-uat4-re-enabled-sync.png`

---

## UAT-5: Bidirectional Sync — PASS

**Action:** Scroll Filing B to 30000.
**Verify:**
- [x] Filing A followed to 30574
- [x] Both panels show identical content: "The Company is exposed to credit risk and fluctuations in the values of its inve..."
- [x] Content alignment verified via source offset comparison

**Screenshot:** `screenshots/08-uat5-bidirectional-sync.png`

---

## UAT-6: No Huge Jumps — PASS (CRITICAL)

**Action:** Scroll Filing A incrementally from 0 to 10000 in 1000px steps, then from 20000 to 40000 in 2000px steps.
**Verify:**
- [x] 0-10000 range: max delta between consecutive steps = 1456px (well within threshold)
- [x] 20000-40000 range: max delta = 4283px for 2000px steps (proportional, no snaps)
- [x] Smooth progression — no sudden jumps where panel snaps to a section top
- [x] Unchanged content tracks in lock-step (identical text at same relative position)
- [x] No jarring snaps through modified/added content regions

**Scroll tracking data (0-10000, 1000px steps):**
| Panel A | Panel B | B Delta |
|---------|---------|---------|
| 0 | 0 | — |
| 1000 | 974 | 974 |
| 2000 | 1974 | 1000 |
| 3000 | 2974 | 1000 |
| 4000 | 3974 | 1000 |
| 5000 | 4974 | 1000 |
| 6000 | 5974 | 1000 |
| 7000 | 7062 | 1088 |
| 8000 | 7788 | 726 |
| 9000 | 9244 | 1456 |
| 10000 | 9912 | 668 |

**Screenshots:**
- `screenshots/09-uat6-smooth-tracking-25000.png`
- `screenshots/10-uat6-smooth-tracking-60000.png`

---

## Console Errors

- [x] No console errors
- [x] No console warnings

---

## Pass/Fail Summary

| UAT | Description | Result |
|-----|-------------|--------|
| UAT-1 | Toggle Visibility | PASS |
| UAT-2 | Content-Aligned Sync | PASS |
| UAT-3 | Toggle Disables Sync | PASS |
| UAT-4 | Toggle Re-enables Sync | PASS |
| UAT-5 | Bidirectional Sync | PASS |
| UAT-6 | No Huge Jumps | PASS |

**Overall: ALL PASS**
