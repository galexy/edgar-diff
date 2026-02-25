# edgar-diff: SEC Filing Comparison Tool

## Press Release

### Investor Research Tool Turns Hours of Filing Comparison Into Seconds

**For Immediate Release**

Today we announce **edgar-diff**, an open-source tool that lets investors instantly see what changed between any two SEC filings. By pulling full-text filings directly from the EDGAR database and producing a structured, section-by-section diff, edgar-diff eliminates the most time-consuming step in fundamental analysis: manually comparing this year's 10-K to last year's.

A typical annual report runs 100–200 pages. Subtle but critical changes — a new risk factor, a revised revenue recognition policy, a restructured segment — are buried across dozens of sections. Today, finding those changes means reading both filings cover to cover or skimming and hoping you don't miss something. Either way, it doesn't scale. An analyst covering 30 names simply cannot do deep year-over-year comparison on all of them.

edgar-diff solves this by doing the mechanical work of comparison instantly, so the investor can focus entirely on interpretation — the part that actually generates alpha.

**Key capabilities:**

- **Side-by-side diff view** — Additions, deletions, and modifications highlighted inline across both filings, organized by section (Risk Factors, MD&A, Financial Statements, Notes, etc.).
- **Change summary** — A succinct, AI-generated overview of material differences displayed immediately, so you know where to focus before you dive into the details.
- **LLM chat panel** — A side panel where you can ask questions about the filing and the diff in context. "Why did they add this risk factor?" or "How did the language around goodwill impairment change?" — answered with direct references to the source text.
- **Direct EDGAR integration** — Pulls full-text filings (HTML/XBRL) directly from the SEC EDGAR database. No third-party data dependency.
- **Reusable diff library** — The core diffing engine is a standalone library, decoupled from the UI, so it can be embedded in other systems — screening pipelines, real-time filing monitors, or custom research platforms.

"I read every word of every filing. The problem was never reading — it was finding what changed. edgar-diff gives me that instantly, which means I can cover more companies with the same depth of analysis." — Target user

edgar-diff is available as both a web application for interactive research and a library for programmatic use.

---

## Frequently Asked Questions

### Customer FAQ

**Q: Who is this for?**

A: Fundamental investors — value investors, equity analysts, portfolio managers — who read SEC filings in depth and need to compare them across periods. If you read entire 10-Ks and care about the specific wording changes, not just the financial summary tables, this tool is for you.

**Q: What filings does it support?**

A: Any text-based filing available on SEC EDGAR. The primary use case is comparing annual reports (10-K) year over year, but it also supports 10-Q (quarterly), 8-K (current reports), proxy statements (DEF 14A), and any other filing type where textual comparison is meaningful.

**Q: How does the diff work? Is it just a text diff?**

A: No. A naive text diff on raw HTML would be unreadable. edgar-diff parses filings into their semantic structure — sections, subsections, tables, notes — and then performs the comparison at that structural level. This means you see "Risk Factor added: Supply Chain Disruption" rather than a wall of green-highlighted HTML tags.

**Q: What does the AI summary include?**

A: When a diff is generated, a concise summary appears immediately. It covers: number of sections with changes, new or removed risk factors, changes to accounting policies, segment reporting changes, material modifications to forward-looking language, and other significant textual differences. This is intended as a navigation aid — a map of where to look — not a replacement for reading the actual changes.

**Q: Can I ask follow-up questions about the diff?**

A: Yes. The LLM chat panel has full context of both filings and the diff. You can ask questions like "Summarize all changes to the debt covenant section," "What new risk factors were added?", or "Compare the language around inventory valuation between the two years." Responses include direct references to the source text so you can verify.

**Q: Does the AI interpretation replace my own analysis?**

A: No, and intentionally so. The summary and chat features are designed to help you navigate and query the filings faster, not to tell you what to think. The side-by-side diff is always the primary view — you see exactly what changed, in the original language, and form your own conclusions.

**Q: Where does the data come from?**

A: Directly from the SEC EDGAR full-text filing database. No intermediary, no third-party data vendor. You get the same filing the SEC published, diffed against another filing the SEC published.

**Q: Can I compare any two filings from the same company?**

A: Yes. You specify the company (by ticker or CIK number) and select which two filings to compare. The most common use case is consecutive annual reports (e.g., FY2024 10-K vs. FY2023 10-K), but you can compare any two filings of the same type.

**Q: How fast is it?**

A: The summary appears within seconds. The full structured diff typically generates in under 30 seconds depending on filing length. Once generated, navigation is instant.

**Q: Can I use the diff engine in my own systems?**

A: Yes. The core diffing engine — EDGAR fetching, filing parsing, structural alignment, and diff computation — is packaged as a standalone library with a clean API. You can integrate it into screening pipelines, alerting systems, or any other research infrastructure. The library has no dependency on the web UI.

**Q: Is this real-time? Can it alert me when a new filing is published?**

A: The web application is a research tool — you pull up filings on demand. However, because the diff engine is a standalone library, you can build real-time or near-real-time monitoring on top of it. The library is designed to support this use case even though the initial UI does not.

**Q: What is the cost?**

A: edgar-diff is open source. You can self-host the web application and use the library freely. The only external cost is the LLM API usage for the summary and chat features.

---

### Technical FAQ

**Q: What is the high-level architecture?**

A: The system has four components, each independently usable:

1. **EDGAR Client** — Fetches and caches full-text filings from SEC EDGAR. Handles rate limiting, CIK/ticker resolution, and filing index navigation.
2. **Filing Parser** — Converts raw HTML/XBRL filings into a structured document model: ordered sections, subsections, paragraphs, and tables. This is the hardest part of the system — 10-K formatting is not standardized across filers.
3. **Diff Engine** — Takes two parsed filing structures and produces a structured diff: section-level alignment, paragraph-level change detection, and inline text diffs within changed paragraphs. This is the core library.
4. **Web Application** — Side-by-side diff viewer with section navigation, AI summary, and LLM chat panel.

Components 1–3 are the library. Component 4 is the UI.

**Q: Why is the filing parser the hardest part?**

A: SEC filings are submitted in HTML, but there is no enforced structural schema. Every company (and often every filing agent like Donnelley or Toppan Merrill) uses different HTML patterns to represent the same logical structure. "Item 1A. Risk Factors" might be an `<h2>`, a bold `<p>`, a `<div>` with a specific class, or just uppercase text in a `<font>` tag. The parser must handle all of these variations and normalize them into a consistent structure.

**Q: How does the diff engine handle structural changes?**

A: The diff engine works in two passes:

1. **Section alignment** — Match sections across the two filings using heading text similarity. This handles cases where sections are renamed or reordered.
2. **Content diffing** — Within matched sections, perform paragraph-level and then word-level differencing. New/removed sections are surfaced as wholesale additions or deletions.

This two-pass approach ensures that a company renaming "Item 1A. Risk Factors" to "Item 1A. Risk Factors and Uncertainties" doesn't cause the entire section to show as deleted and re-added.

**Q: What technology stack?**

A: To be determined based on implementation planning. Key constraints:
- The library must be usable independently of the web UI.
- The web UI needs to render large diffs performantly (filings can be 200+ pages).
- The EDGAR client must respect SEC rate limits (10 requests/second).
- The LLM integration should be model-agnostic (support multiple providers).

**Q: How does the LLM chat panel work?**

A: The chat panel maintains a conversation with an LLM that has been provided with both filings and the computed diff as context. When the user asks a question, the system constructs a prompt that includes the relevant sections of both filings and the diff for those sections. For very long filings, a retrieval step selects the most relevant sections rather than including the full text.

**Q: How is the library distributed?**

A: As a package (language-specific package manager) with a programmatic API. The core operations are:
- `fetch_filing(company, filing_type, date)` → raw filing
- `parse_filing(raw_filing)` → structured document
- `diff_filings(filing_a, filing_b)` → structured diff
- `summarize_diff(diff)` → AI-generated summary

This API is sufficient to build any downstream application — the web UI is just one consumer of it.

**Q: What about tables and financial statements?**

A: Tables are parsed into a structured representation and diffed cell-by-cell. This is critical for financial statements where a single number change matters. The diff view renders table changes with cell-level highlighting rather than treating the entire table as a text blob.

**Q: How do you handle XBRL data?**

A: XBRL (structured financial data) is available for most recent filings and provides machine-readable financial statements. The system uses XBRL data where available to improve table parsing accuracy and to provide precise financial figure comparisons. For older filings without XBRL, it falls back to HTML table parsing.
