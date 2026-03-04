/**
 * Section extractor for SEC 10-K filings.
 * Parses HTML to find Item sections and extract their content as paragraphs.
 */
import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';

export interface Section {
  heading: string;
  normalizedHeading: string;
  paragraphs: string[];
  content: string;
  startIndex: number;
  endIndex: number;
}

/** Standard 10-K item patterns in order */
const ITEM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\s*item\s+1a[\.\s:\-–—]/i, label: 'item 1a' },
  { pattern: /^\s*item\s+1b[\.\s:\-–—]/i, label: 'item 1b' },
  { pattern: /^\s*item\s+1c[\.\s:\-–—]/i, label: 'item 1c' },
  { pattern: /^\s*item\s+1[\.\s:\-–—]/i, label: 'item 1' },
  { pattern: /^\s*item\s+2[\.\s:\-–—]/i, label: 'item 2' },
  { pattern: /^\s*item\s+3[\.\s:\-–—]/i, label: 'item 3' },
  { pattern: /^\s*item\s+4[\.\s:\-–—]/i, label: 'item 4' },
  { pattern: /^\s*item\s+5[\.\s:\-–—]/i, label: 'item 5' },
  { pattern: /^\s*item\s+6[\.\s:\-–—]/i, label: 'item 6' },
  { pattern: /^\s*item\s+7a[\.\s:\-–—]/i, label: 'item 7a' },
  { pattern: /^\s*item\s+7[\.\s:\-–—]/i, label: 'item 7' },
  { pattern: /^\s*item\s+8[\.\s:\-–—]/i, label: 'item 8' },
  { pattern: /^\s*item\s+9a[\.\s:\-–—]/i, label: 'item 9a' },
  { pattern: /^\s*item\s+9b[\.\s:\-–—]/i, label: 'item 9b' },
  { pattern: /^\s*item\s+9[\.\s:\-–—]/i, label: 'item 9' },
  { pattern: /^\s*item\s+10[\.\s:\-–—]/i, label: 'item 10' },
  { pattern: /^\s*item\s+11[\.\s:\-–—]/i, label: 'item 11' },
  { pattern: /^\s*item\s+12[\.\s:\-–—]/i, label: 'item 12' },
  { pattern: /^\s*item\s+13[\.\s:\-–—]/i, label: 'item 13' },
  { pattern: /^\s*item\s+14[\.\s:\-–—]/i, label: 'item 14' },
  { pattern: /^\s*item\s+15[\.\s:\-–—]/i, label: 'item 15' },
  { pattern: /^\s*item\s+16[\.\s:\-–—]/i, label: 'item 16' },
];

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function getTextContent(node: ChildNode): string {
  if (node.type === 'text') return node.data;
  if (isElement(node)) return node.children.map(getTextContent).join('');
  return '';
}

/** Check if a node looks like a heading element (styled or semantic) */
function isHeadingLike(node: Element): boolean {
  const tag = node.tagName.toLowerCase();
  // Semantic headings
  if (/^h[1-6]$/.test(tag)) return true;
  // Bold/strong elements
  if (tag === 'b' || tag === 'strong') return true;
  // Spans and divs with bold/large styling
  if (tag === 'span' || tag === 'div' || tag === 'p' || tag === 'a') {
    const style = node.attribs?.style || '';
    if (/font-weight\s*:\s*(bold|[7-9]\d\d)/i.test(style)) return true;
    if (/font-size\s*:\s*(1[4-9]|[2-9]\d)\s*pt/i.test(style)) return true;
  }
  return false;
}

interface HeadingMatch {
  label: string;
  heading: string;
  startIndex: number;
  endIndex: number;
  element: Element;
}

/**
 * Walk the DOM tree looking for Item headings.
 * Returns all heading matches found (may include duplicates like TOC entries).
 */
function findHeadings(nodes: ChildNode[]): HeadingMatch[] {
  const matches: HeadingMatch[] = [];

  function walk(node: ChildNode): void {
    if (!isElement(node)) return;

    if (isHeadingLike(node)) {
      const text = getTextContent(node).trim();
      if (text.length > 0 && text.length < 200) {
        for (const { pattern, label } of ITEM_PATTERNS) {
          if (pattern.test(text)) {
            matches.push({
              label,
              heading: text,
              startIndex: node.startIndex ?? -1,
              endIndex: node.endIndex ?? -1,
              element: node,
            });
            break;
          }
        }
      }
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return matches;
}

/**
 * Deduplicate headings: for each label, pick the one most likely to be the
 * actual section heading (not a TOC entry). Heuristic: the LAST occurrence
 * is typically the real heading; TOC entries come first.
 * But we also filter out very short text (likely TOC links).
 */
function deduplicateHeadings(matches: HeadingMatch[]): HeadingMatch[] {
  const byLabel = new Map<string, HeadingMatch[]>();
  for (const m of matches) {
    const arr = byLabel.get(m.label) || [];
    arr.push(m);
    byLabel.set(m.label, arr);
  }

  const result: HeadingMatch[] = [];
  for (const [, group] of byLabel) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Pick the one with the longest heading text (usually the content section, not TOC)
      // If tied, pick the last occurrence
      const sorted = [...group].sort((a, b) => {
        const lenDiff = b.heading.length - a.heading.length;
        if (lenDiff !== 0) return lenDiff;
        return b.startIndex - a.startIndex;
      });
      result.push(sorted[0]);
    }
  }

  // Sort by startIndex
  result.sort((a, b) => a.startIndex - b.startIndex);
  return result;
}

/**
 * Extract text paragraphs from an HTML section.
 * A paragraph is a non-empty block of text separated by block-level boundaries.
 */
function extractParagraphs(html: string): string[] {
  // Replace block-level tags with newlines, strip all remaining tags, split
  const blockTags = /(<\/?(p|div|br|tr|li|h[1-6]|table|thead|tbody|section|article)[^>]*\/?>)/gi;
  let text = html.replace(blockTags, '\n');
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#\d+;/gi, ' ');
  // Split on newlines, trim, filter empty
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  return paragraphs;
}

/**
 * Extract sections from a 10-K HTML filing.
 */
export function extractSections(html: string): Section[] {
  const doc = parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });

  const headings = deduplicateHeadings(findHeadings(doc.children));

  if (headings.length === 0) {
    return [];
  }

  const sections: Section[] = [];

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];

    // Section content runs from current heading start to next heading start (or end of doc)
    const sectionStart = current.startIndex;
    const sectionEnd = next ? next.startIndex - 1 : html.length - 1;

    if (sectionStart < 0) continue;

    const sectionHtml = html.slice(sectionStart, sectionEnd + 1);
    const paragraphs = extractParagraphs(sectionHtml);
    const content = paragraphs.join(' ');

    sections.push({
      heading: current.heading,
      normalizedHeading: normalizeHeading(current.label),
      paragraphs,
      content,
      startIndex: sectionStart,
      endIndex: sectionEnd,
    });
  }

  return sections;
}

/**
 * Normalize a heading string for comparison.
 */
export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\-–—:,;()]/g, '')
    .trim();
}
