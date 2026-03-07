import type { Document, Element, Node } from 'domhandler';
import { isTag } from 'domhandler';
import type { SourceLocation } from '../types.js';
import type { HeadingCandidate, SectionBoundary, ExtractionContext } from './types.js';
import { getTextContent } from './dom-utils.js';

const ITEM_HEADING_RE =
  /^\s*(?:PART\s+[IV]+\s*[\u2014\u2013\u2014\u2013\u2014\u2013—–-]?\s*)?item\s+(\d+[a-z]?)[\s.:,\u2014\u2013—–-]/i;

const ITEM_HEADING_SIMPLE_RE = /^\s*item\s+(\d+[a-z]?)\s*$/i;

export const KNOWN_ITEMS = new Set([
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8',
  '9', '9a', '9b', '9c', '10', '11', '12', '13', '14', '15', '16',
]);

const BLOCK_ELEMENTS = new Set([
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'tr',
  'li', 'section', 'article', 'header', 'footer', 'main',
]);

/**
 * Extract item number from a heading string.
 * Returns null if not a recognized Item heading.
 */
export function extractItemNumber(rawText: string): string | null {
  const text = rawText.replace(/\u00a0/g, ' ');
  const match = text.match(ITEM_HEADING_RE) ?? text.match(ITEM_HEADING_SIMPLE_RE);
  if (!match) return null;
  const num = match[1].toLowerCase();
  return KNOWN_ITEMS.has(num) ? num : null;
}

/**
 * Normalize a heading string: lowercase, collapse whitespace, strip edge punctuation.
 */
export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;\u2014\u2013—–-]+/, '')
    .replace(/[\s.,:;\u2014\u2013—–-]+$/, '')
    .trim();
}

// Pre-compiled regexes for style checks (avoid recompilation per element)
const BOLD_STYLE_RE = /font-weight\s*:\s*(bold|[7-9]00)/i;
const CENTER_STYLE_RE = /text-align\s*:\s*center/i;
const UNDERLINE_STYLE_RE = /text-decoration\s*:\s*underline/i;
const FONT_SIZE_RE = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*pt/i;
const SEMANTIC_ID_RE = /item[_-]?\d/i;
const NON_LETTER_RE = /[^a-zA-Z]/g;

/** Check if text is ALL UPPERCASE (ignoring non-letter chars). */
function isAllUppercase(text: string): boolean {
  const letters = text.replace(NON_LETTER_RE, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

/** Check if heading text has a cross-reference prefix. */
function hasCrossRefPrefix(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith('see ') || t.startsWith('refer to ');
}

/**
 * Score a heading candidate based on heuristics.
 * Walks the ancestor chain once to check all style signals.
 */
function scoreCandidate(el: Element, text: string): number {
  let score = 0;

  // Text-based checks (no DOM traversal)
  if (isAllUppercase(text))       score += 2;
  if (hasCrossRefPrefix(text))    score -= 3;

  // Semantic ID check on the element itself
  const id = el.attribs?.['id'] ?? '';
  if (SEMANTIC_ID_RE.test(id))    score += 3;

  // Single ancestor walk for all style/tag signals
  let foundBold = false;
  let foundLargeFont = false;
  let foundCenter = false;
  let foundUnderline = false;
  let foundAnchor = false;
  let current: Element | null = el;
  while (current) {
    const name = current.name;

    if (!foundBold && (name === 'b' || name === 'strong')) foundBold = true;
    if (!foundAnchor && name === 'a') foundAnchor = true;

    // Read style attribute once per ancestor
    const needsStyleCheck = !foundBold || !foundLargeFont || !foundCenter || !foundUnderline;
    if (needsStyleCheck) {
      const style = current.attribs?.['style'];
      if (style) {
        if (!foundBold && BOLD_STYLE_RE.test(style)) foundBold = true;
        if (!foundLargeFont) {
          const m = style.match(FONT_SIZE_RE);
          if (m && parseFloat(m[1]) > 10) foundLargeFont = true;
        }
        if (!foundCenter && CENTER_STYLE_RE.test(style)) foundCenter = true;
        if (!foundUnderline && UNDERLINE_STYLE_RE.test(style)) foundUnderline = true;
      }
    }

    current = current.parent && isTag(current.parent) ? current.parent : null;
  }

  if (foundBold)      score += 3;
  if (foundLargeFont) score += 2;
  if (foundCenter)    score += 1;
  if (foundUnderline) score += 1;
  if (foundAnchor)    score -= 5;

  return score;
}

/**
 * Walk the DOM tree and find heading candidates.
 */
function findHeadingCandidates(doc: Document, context: ExtractionContext): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];

  function walk(node: Node): void {
    if (!isTag(node)) return;

    const name = node.name;

    if (BLOCK_ELEMENTS.has(name)) {
      const text = getTextContent(node).replace(/\u00a0/g, ' ').trim();
      if (text) {
        const itemNumber = extractItemNumber(text);
        if (itemNumber) {
          if (node.startIndex == null || node.endIndex == null) {
            context.warnings.push(`Skipping candidate "${itemNumber}" — missing source indices`);
            return;
          }
          const source: SourceLocation = {
            start: node.startIndex,
            end: node.endIndex + 1,
          };
          const score = scoreCandidate(node, text);
          candidates.push({ text, itemNumber, source, score });
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const child of doc.children) {
    walk(child);
  }

  return candidates;
}

/**
 * Deduplicate heading candidates: for each item number, keep the last occurrence.
 * Then sort by document position.
 */
function deduplicateCandidates(candidates: HeadingCandidate[]): HeadingCandidate[] {
  const byItem = new Map<string, HeadingCandidate>();
  for (const c of candidates) {
    const existing = byItem.get(c.itemNumber);
    // Keep highest score; if tied, last occurrence wins (handles TOC before body)
    if (!existing || c.score >= existing.score) {
      byItem.set(c.itemNumber, c);
    }
  }

  const deduped = Array.from(byItem.values());
  deduped.sort((a, b) => a.source.start - b.source.start);
  return deduped;
}

/**
 * Build section boundaries from deduplicated heading candidates.
 */
function buildSectionBoundaries(
  headings: HeadingCandidate[],
  htmlLength: number,
): SectionBoundary[] {
  return headings.map((heading, i) => ({
    heading,
    contentEnd: i + 1 < headings.length ? headings[i + 1].source.start : htmlLength,
  }));
}

/**
 * Extract sections from a pre-parsed DOM: find headings, deduplicate, build boundaries.
 */
export function extractSections(
  html: string,
  doc: Document,
  context: ExtractionContext,
): SectionBoundary[] {
  if (!html.trim()) {
    const msg = 'Empty HTML content';
    context.warnings.push(msg);
    context.logger?.warn(msg);
    return [];
  }

  const candidates = findHeadingCandidates(doc, context);

  if (candidates.length === 0) {
    const msg = 'No Item headings found';
    context.warnings.push(msg);
    context.logger?.warn(msg);
    return [];
  }

  const deduped = deduplicateCandidates(candidates);

  // Check for preamble content (only strip tags from first 10KB for perf)
  if (deduped.length > 0 && deduped[0].source.start > 0) {
    const preambleEnd = deduped[0].source.start;
    const sample = html.slice(0, Math.min(preambleEnd, 10240));
    const sampleText = sample.replace(/<[^>]*>/g, '').trim();
    if (sampleText.length > 0) {
      const msg = `Content before first Item heading was skipped (${preambleEnd} characters of HTML)`;
      context.warnings.push(msg);
      context.logger?.warn(msg);
    }
  }

  return buildSectionBoundaries(deduped, html.length);
}

