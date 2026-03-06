/**
 * analyze-headings.ts — Analyze heading patterns in 10-K filings
 *
 * Usage: npx tsx scripts/analyze-headings.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import * as htmlparser2 from "htmlparser2";
import render from "dom-serializer";

const FIXTURES_DIR = join(
  import.meta.dirname,
  "..",
  "libs/edgar-diff-lib/tests/integration/fixtures"
);

const ITEM_REGEX = /item\s+\d+[a-z]?\b/i;
const ITEM_FULL_REGEX = /item\s+(\d+[a-z]?)[\.\s]/i;

interface HeadingMatch {
  text: string;
  itemId: string;
  tag: string;
  ancestors: string[];        // up to 5 levels of ancestor tags
  ancestorStyles: string[];   // inline styles on ancestors
  ancestorClasses: string[];  // CSS classes on ancestors
  inlineStyle: string;
  cssClasses: string;
  byteOffset: number;
  isTOC: boolean;
  hasIXBRL: boolean;
  nestingDepth: number;
  splitElement: boolean;      // text split across sibling elements
  rawHtml: string;            // raw HTML of the heading context
}

interface FilingAnalysis {
  filename: string;
  ticker: string;
  year: number;
  fileSize: number;
  headingCount: number;
  hasTOC: boolean;
  hasIXBRL: boolean;
  filingAgentHint: string;
  headings: HeadingMatch[];
  patternSummary: PatternSummary;
}

interface PatternSummary {
  primaryTag: string;         // most common tag for headings
  usesSemanticH: boolean;     // uses <h1>-<h6>
  usesBold: boolean;          // font-weight:bold or <b>/<strong>
  usesUppercase: boolean;     // text-transform:uppercase or all-caps text
  usesFontTag: boolean;       // uses <font> elements
  typicalNesting: string;     // e.g. "div>p>span>b"
  cssClassPattern: string;    // "semantic" | "auto-generated" | "none"
}

function parseFilingName(filename: string): { ticker: string; year: number } | null {
  const match = filename.match(/^10k-(.+)-(\d{4})\.html$/);
  if (!match) return null;
  return { ticker: match[1], year: parseInt(match[2], 10) };
}

function getAncestors(
  node: htmlparser2.AnyNode,
  depth: number
): Array<{ tag: string; style: string; classes: string }> {
  const ancestors: Array<{ tag: string; style: string; classes: string }> = [];
  let current = node.parentNode;
  for (let i = 0; i < depth && current; i++) {
    if (current.type === "tag" || current.type === "script" || current.type === "style") {
      const el = current as htmlparser2.Element;
      ancestors.push({
        tag: el.name,
        style: el.attribs?.style || "",
        classes: el.attribs?.class || "",
      });
    }
    current = current.parentNode;
  }
  return ancestors;
}

function hasIXBRLAncestor(node: htmlparser2.AnyNode): boolean {
  let current = node.parentNode;
  while (current) {
    if (
      (current.type === "tag" || current.type === "script") &&
      (current as htmlparser2.Element).name?.startsWith("ix:")
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function getNestingDepth(node: htmlparser2.AnyNode): number {
  let depth = 0;
  let current = node.parentNode;
  while (current) {
    if (current.type === "tag") depth++;
    current = current.parentNode;
  }
  return depth;
}

function getElementHtml(el: htmlparser2.Element): string {
  return render(el, { encodeEntities: false }).substring(0, 500);
}

function getBlockParent(node: htmlparser2.AnyNode): htmlparser2.Element | null {
  const blockTags = new Set([
    "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "td", "th", "li", "section", "article", "tr"
  ]);
  let current = node.parentNode;
  while (current) {
    if (current.type === "tag" && blockTags.has((current as htmlparser2.Element).name)) {
      return current as htmlparser2.Element;
    }
    current = current.parentNode;
  }
  return null;
}

function detectTOCBoundary(headings: HeadingMatch[]): number {
  // Heuristic: TOC entries tend to be clustered at the start and have lower byte offsets
  // Look for a gap in byte offsets between TOC and body
  if (headings.length < 4) return 0;

  // Find Items that appear multiple times (TOC + body)
  const itemOccurrences = new Map<string, number[]>();
  for (const h of headings) {
    const key = h.itemId.toLowerCase();
    if (!itemOccurrences.has(key)) itemOccurrences.set(key, []);
    itemOccurrences.get(key)!.push(h.byteOffset);
  }

  // If multiple items appear twice, the first occurrence is likely TOC
  const duplicated = [...itemOccurrences.entries()].filter(
    ([, offsets]) => offsets.length >= 2
  );

  if (duplicated.length >= 3) {
    // TOC boundary is after the last "first occurrence" of duplicated items
    const firstOccurrences = duplicated.map(([, offsets]) =>
      Math.min(...offsets)
    );
    return Math.max(...firstOccurrences);
  }

  return 0;
}

function detectFilingAgent(html: string): string {
  if (/workiva/i.test(html)) return "Workiva";
  if (/donnelley/i.test(html) || /DFIN/i.test(html) || /R\.R\. Donnelley/i.test(html))
    return "DFIN (RR Donnelley)";
  if (/toppan\s*merrill/i.test(html) || /merrill\s*corporation/i.test(html))
    return "Toppan Merrill";
  if (/edgar\s*online/i.test(html)) return "EDGAR Online";
  if (/vintage/i.test(html)) return "Vintage";
  return "Unknown";
}

function analyzeFile(filepath: string): FilingAnalysis | null {
  const filename = basename(filepath);
  const parsed = parseFilingName(filename);
  if (!parsed) return null;

  const html = readFileSync(filepath, "utf-8");
  const dom = htmlparser2.parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });

  const headings: HeadingMatch[] = [];
  const hasIXBRL = /<ix:/i.test(html);
  const filingAgentHint = detectFilingAgent(html);

  // Walk DOM finding text nodes that match item pattern
  function walk(nodes: htmlparser2.AnyNode[]) {
    for (const node of nodes) {
      if (node.type === "text") {
        const text = (node as htmlparser2.Text).data.trim();
        if (ITEM_REGEX.test(text)) {
          const fullMatch = text.match(ITEM_FULL_REGEX);
          const itemId = fullMatch ? `item-${fullMatch[1].toLowerCase()}` : "unknown";

          const blockParent = getBlockParent(node);
          const parentEl = node.parentNode as htmlparser2.Element | null;
          const tag = parentEl?.type === "tag" ? parentEl.name : "text";
          const ancestors = getAncestors(node, 5);

          // Get full text of the block parent to capture full heading
          let fullText = text;
          if (blockParent) {
            fullText = htmlparser2.DomUtils.textContent(blockParent).trim()
              .replace(/\s+/g, " ")
              .substring(0, 200);
          }

          // Detect split-element headings
          let splitElement = false;
          if (blockParent) {
            const children = blockParent.children.filter(
              (c) => c.type === "tag" || (c.type === "text" && (c as htmlparser2.Text).data.trim())
            );
            if (children.length > 1) {
              const textParts = children
                .map((c) => htmlparser2.DomUtils.textContent(c).trim())
                .filter(Boolean);
              const joined = textParts.join(" ");
              if (ITEM_REGEX.test(joined) && textParts.length > 1) {
                splitElement = true;
              }
            }
          }

          headings.push({
            text: fullText,
            itemId,
            tag,
            ancestors: ancestors.map((a) => a.tag),
            ancestorStyles: ancestors.map((a) => a.style).filter(Boolean),
            ancestorClasses: ancestors.map((a) => a.classes).filter(Boolean),
            inlineStyle: parentEl?.attribs?.style || "",
            cssClasses: parentEl?.attribs?.class || "",
            byteOffset: node.startIndex || 0,
            isTOC: false, // set below
            hasIXBRL: hasIXBRLAncestor(node),
            nestingDepth: getNestingDepth(node),
            splitElement,
            rawHtml: blockParent
              ? getElementHtml(blockParent).substring(0, 500)
              : "",
          });
        }
      }

      if ("children" in node && (node as htmlparser2.Element).children) {
        walk((node as htmlparser2.Element).children);
      }
    }
  }

  walk(dom.children);

  // Mark TOC entries
  const tocBoundary = detectTOCBoundary(headings);
  for (const h of headings) {
    if (tocBoundary > 0 && h.byteOffset <= tocBoundary) {
      h.isTOC = true;
    }
  }

  // Determine pattern summary
  const bodyHeadings = headings.filter((h) => !h.isTOC);
  const tagCounts = new Map<string, number>();
  let usesSemanticH = false;
  let usesBold = false;
  let usesUppercase = false;
  let usesFontTag = false;

  for (const h of bodyHeadings) {
    tagCounts.set(h.tag, (tagCounts.get(h.tag) || 0) + 1);
    if (/^h[1-6]$/.test(h.tag)) usesSemanticH = true;
    if (
      /font-weight\s*:\s*(bold|[6-9]00)/i.test(h.inlineStyle) ||
      h.ancestors.includes("b") ||
      h.ancestors.includes("strong") ||
      h.tag === "b" ||
      h.tag === "strong" ||
      h.ancestorStyles.some((s) => /font-weight\s*:\s*(bold|[6-9]00)/i.test(s))
    ) {
      usesBold = true;
    }
    if (
      /text-transform\s*:\s*uppercase/i.test(h.inlineStyle) ||
      h.ancestorStyles.some((s) => /text-transform\s*:\s*uppercase/i.test(s)) ||
      h.text === h.text.toUpperCase()
    ) {
      usesUppercase = true;
    }
    if (h.tag === "font" || h.ancestors.includes("font")) {
      usesFontTag = true;
    }
  }

  const primaryTag =
    [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

  // Determine nesting pattern
  const nestingPatterns = bodyHeadings.map((h) =>
    [...h.ancestors].reverse().join(">")
  );
  const nestingCounts = new Map<string, number>();
  for (const p of nestingPatterns) {
    nestingCounts.set(p, (nestingCounts.get(p) || 0) + 1);
  }
  const typicalNesting =
    [...nestingCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // CSS class pattern
  let cssClassPattern = "none";
  const classesUsed = bodyHeadings
    .map((h) => h.cssClasses)
    .filter(Boolean);
  if (classesUsed.length > 0) {
    const hasAutoGen = classesUsed.some((c) => /^[a-z]{1,3}\d+|cls_/i.test(c));
    cssClassPattern = hasAutoGen ? "auto-generated" : "semantic";
  }

  const hasTOC = tocBoundary > 0;

  return {
    filename,
    ticker: parsed.ticker,
    year: parsed.year,
    fileSize: html.length,
    headingCount: headings.length,
    hasTOC,
    hasIXBRL,
    filingAgentHint,
    headings,
    patternSummary: {
      primaryTag,
      usesSemanticH,
      usesBold,
      usesUppercase,
      usesFontTag,
      typicalNesting,
      cssClassPattern,
    },
  };
}

function generateMetaJson(analysis: FilingAnalysis): object {
  const bodyHeadings = analysis.headings.filter((h) => !h.isTOC);

  // Deduplicate by itemId, keeping last occurrence (body heading)
  const seen = new Map<string, HeadingMatch>();
  for (const h of bodyHeadings) {
    seen.set(h.itemId, h);
  }

  const expectedItems = [...seen.entries()].map(([id, h]) => ({
    id,
    heading: h.text.substring(0, 100),
    sourceOffset: h.byteOffset,
  }));

  return {
    ticker: analysis.ticker.toUpperCase(),
    year: analysis.year,
    filingDate: "TBD",
    patternFamily: "TBD",
    hasTOC: analysis.hasTOC,
    hasIXBRL: analysis.hasIXBRL,
    filingAgentHint: analysis.filingAgentHint,
    expectedItems,
  };
}

function main() {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.match(/^10k-.+-\d{4}\.html$/))
    .filter((f) => {
      // Skip tiny simplified test fixtures
      const stat = readFileSync(join(FIXTURES_DIR, f));
      return stat.length > 10000;
    })
    .sort();

  console.log(`Found ${files.length} real filing fixtures\n`);

  const analyses: FilingAnalysis[] = [];

  for (const file of files) {
    console.log(`Analyzing: ${file}...`);
    const analysis = analyzeFile(join(FIXTURES_DIR, file));
    if (!analysis) {
      console.log(`  [SKIP] Could not parse filename`);
      continue;
    }
    analyses.push(analysis);

    const bodyHeadings = analysis.headings.filter((h) => !h.isTOC);
    const tocHeadings = analysis.headings.filter((h) => h.isTOC);

    console.log(`  Size: ${(analysis.fileSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Agent: ${analysis.filingAgentHint}`);
    console.log(`  Total matches: ${analysis.headings.length} (${tocHeadings.length} TOC, ${bodyHeadings.length} body)`);
    console.log(`  iXBRL: ${analysis.hasIXBRL}`);
    console.log(`  Pattern: tag=${analysis.patternSummary.primaryTag}, bold=${analysis.patternSummary.usesBold}, uppercase=${analysis.patternSummary.usesUppercase}, semantic-h=${analysis.patternSummary.usesSemanticH}, font-tag=${analysis.patternSummary.usesFontTag}`);
    console.log(`  Nesting: ${analysis.patternSummary.typicalNesting}`);
    console.log(`  CSS classes: ${analysis.patternSummary.cssClassPattern}`);

    // Print sample headings
    const samples = bodyHeadings.slice(0, 3);
    for (const s of samples) {
      console.log(`    [${s.tag}] "${s.text.substring(0, 80)}" offset=${s.byteOffset} ixbrl=${s.hasIXBRL} split=${s.splitElement}`);
    }

    // Write meta JSON
    const metaPath = join(FIXTURES_DIR, `meta-10k-${analysis.ticker}-${analysis.year}.json`);
    const meta = generateMetaJson(analysis);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    console.log(`  -> Wrote ${basename(metaPath)}`);
    console.log();
  }

  // Aggregate summary
  console.log("=== AGGREGATE SUMMARY ===\n");

  // Group by pattern characteristics
  const patternGroups = new Map<string, string[]>();
  for (const a of analyses) {
    const key = [
      a.patternSummary.primaryTag,
      a.patternSummary.usesBold ? "bold" : "",
      a.patternSummary.usesUppercase ? "uppercase" : "",
      a.patternSummary.usesSemanticH ? "semantic-h" : "",
      a.patternSummary.usesFontTag ? "font-tag" : "",
    ]
      .filter(Boolean)
      .join("+");
    if (!patternGroups.has(key)) patternGroups.set(key, []);
    patternGroups.get(key)!.push(`${a.ticker.toUpperCase()} FY${a.year}`);
  }

  console.log("Pattern groups:");
  for (const [key, companies] of patternGroups) {
    console.log(`  ${key}: ${companies.join(", ")}`);
  }

  console.log("\nFiling agent distribution:");
  const agentCounts = new Map<string, string[]>();
  for (const a of analyses) {
    if (!agentCounts.has(a.filingAgentHint))
      agentCounts.set(a.filingAgentHint, []);
    agentCounts.get(a.filingAgentHint)!.push(
      `${a.ticker.toUpperCase()} FY${a.year}`
    );
  }
  for (const [agent, companies] of agentCounts) {
    console.log(`  ${agent}: ${companies.join(", ")}`);
  }

  // Write full analysis JSON
  const analysisPath = join(FIXTURES_DIR, "..", "heading-analysis.json");
  const summary = analyses.map((a) => ({
    filename: a.filename,
    ticker: a.ticker,
    year: a.year,
    fileSize: a.fileSize,
    headingCount: a.headingCount,
    bodyHeadingCount: a.headings.filter((h) => !h.isTOC).length,
    tocHeadingCount: a.headings.filter((h) => h.isTOC).length,
    hasTOC: a.hasTOC,
    hasIXBRL: a.hasIXBRL,
    filingAgentHint: a.filingAgentHint,
    patternSummary: a.patternSummary,
    sampleBodyHeadings: a.headings
      .filter((h) => !h.isTOC)
      .slice(0, 5)
      .map((h) => ({
        text: h.text.substring(0, 100),
        tag: h.tag,
        ancestors: h.ancestors,
        inlineStyle: h.inlineStyle.substring(0, 200),
        cssClasses: h.cssClasses,
        hasIXBRL: h.hasIXBRL,
        splitElement: h.splitElement,
        rawHtml: h.rawHtml.substring(0, 300),
      })),
  }));

  writeFileSync(analysisPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nFull analysis written to: ${analysisPath}`);
}

main();
