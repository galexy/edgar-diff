/**
 * Extracts 10-K sections from EDGAR HTML filings using htmlparser2.
 * Handles Apple's div>span style headings and Microsoft's formatting.
 */
import { Parser } from 'htmlparser2';

export interface Section {
  heading: string;
  normalizedHeading: string;
  paragraphs: string[];
  startIndex: number;
  endIndex: number;
}

/**
 * Pattern matching Item headings in 10-K filings.
 * Matches: "Item 1", "Item 1A", "ITEM 1A.", "Item 7A", etc.
 * Anchored to avoid matching mid-sentence references.
 */
const ITEM_HEADING_RE =
  /^\s*(?:PART\s+[IV]+\s*[\u2014\u2013—–-]?\s*)?item\s+(\d+[a-z]?)[\s.:,\u2014\u2013—–-]/i;

/** Simplified match for headings that are just "Item N" with optional trailing content */
const ITEM_HEADING_SIMPLE_RE = /^\s*item\s+(\d+[a-z]?)\s*$/i;

/** Known 10-K item numbers for validation */
const KNOWN_ITEMS = new Set([
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8', '9', '9a', '9b', '10',
  '11', '12', '13', '14', '15', '16',
]);

export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;\u2014\u2013—–-]+/, '')
    .replace(/[\s.,:;\u2014\u2013—–-]+$/, '')
    .trim();
}

/**
 * Extract item number from a heading string.
 * Returns null if not a recognized Item heading.
 */
function extractItemNumber(text: string): string | null {
  const match = text.match(ITEM_HEADING_RE) ?? text.match(ITEM_HEADING_SIMPLE_RE);
  if (!match) return null;
  const num = match[1].toLowerCase();
  return KNOWN_ITEMS.has(num) ? num : null;
}

interface HeadingCandidate {
  text: string;
  itemNumber: string;
  startIndex: number;
}

/**
 * Extract sections from a 10-K HTML filing.
 * Uses htmlparser2 to find section headings (Item N patterns)
 * and extract paragraph text between them.
 */
export function extractSections(html: string): Section[] {
  const headingCandidates: HeadingCandidate[] = [];

  // Accumulate text within potential heading elements
  let currentText = '';
  let currentStartIndex = -1;
  let inHeadingContext = false;
  // Track bold/font-weight context for heading detection
  let boldDepth = 0;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const style = attribs['style'] ?? '';
        const isBold =
          style.includes('font-weight:bold') ||
          style.includes('font-weight: bold') ||
          style.includes('font-weight:700') ||
          style.includes('font-weight: 700') ||
          name === 'b' ||
          name === 'strong';

        if (isBold) boldDepth++;

        // Start accumulating text at block-level elements
        if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'tr'].includes(name)) {
          if (!inHeadingContext) {
            currentText = '';
            currentStartIndex = parser.startIndex;
            inHeadingContext = true;
          }
        }
      },
      ontext(text) {
        if (inHeadingContext) {
          currentText += text;
        }
      },
      onclosetag(name) {
        if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'tr'].includes(name)) {
          if (inHeadingContext && currentText.trim()) {
            const itemNum = extractItemNumber(currentText.trim());
            if (itemNum) {
              headingCandidates.push({
                text: currentText.trim(),
                itemNumber: itemNum,
                startIndex: currentStartIndex,
              });
            }
          }
          inHeadingContext = false;
          currentText = '';
        }

        if (boldDepth > 0) boldDepth--;
      },
    },
  );

  parser.write(html);
  parser.end();

  // Deduplicate: for each item number, take the FIRST occurrence that looks like a heading
  // (some filings have a table of contents that lists all items first)
  // Strategy: group by item number. If there are exactly 2 occurrences, assume the second
  // is the actual section heading (first is TOC). If >2, try to find the one after TOC.
  const groupedByItem = new Map<string, HeadingCandidate[]>();
  for (const c of headingCandidates) {
    const arr = groupedByItem.get(c.itemNumber) ?? [];
    arr.push(c);
    groupedByItem.set(c.itemNumber, arr);
  }

  // Heuristic: sort all candidates by position. The table of contents is usually
  // in the first ~10% of the document. Pick the last occurrence of each item
  // (which should be the actual section heading, not TOC reference).
  const deduped: HeadingCandidate[] = [];
  for (const [, candidates] of groupedByItem) {
    // Take the last occurrence — it's typically the actual heading, not TOC
    deduped.push(candidates[candidates.length - 1]);
  }

  // Sort by position in document
  deduped.sort((a, b) => a.startIndex - b.startIndex);

  // Build sections: each section runs from its heading to the next heading
  const sections: Section[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const heading = deduped[i];
    const nextStart = i + 1 < deduped.length ? deduped[i + 1].startIndex : html.length;

    const sectionHtml = html.slice(heading.startIndex, nextStart);
    const paragraphs = extractParagraphs(sectionHtml);

    sections.push({
      heading: heading.text,
      normalizedHeading: normalizeHeading(heading.text),
      paragraphs,
      startIndex: heading.startIndex,
      endIndex: nextStart - 1,
    });
  }

  return sections;
}

/**
 * Extract paragraph text blocks from a section's HTML.
 * Strips tags and returns meaningful text blocks.
 */
function extractParagraphs(sectionHtml: string): string[] {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  const parser = new Parser({
    onopentag(name) {
      if (['p', 'div'].includes(name)) {
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
          currentParagraph = '';
        }
      }
    },
    ontext(text) {
      currentParagraph += text;
    },
    onclosetag(name) {
      if (['p', 'div'].includes(name)) {
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
          currentParagraph = '';
        }
      }
    },
  });

  parser.write(sectionHtml);
  parser.end();

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  // Filter out very short or noise paragraphs
  return paragraphs
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 10);
}
