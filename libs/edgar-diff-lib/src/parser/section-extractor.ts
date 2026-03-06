import { parseDocument } from 'htmlparser2';
import type { Document, Element, Node } from 'domhandler';
import { isTag, isText } from 'domhandler';
import type { SourceLocation } from '../types.js';
import type { HeadingCandidate, SectionBoundary, ExtractionContext } from './types.js';

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

/** Accumulate all text content from a node and its descendants. */
function getTextContent(node: Node): string {
  if (isText(node)) {
    return node.data;
  }
  if (isTag(node)) {
    return node.children.map(getTextContent).join('');
  }
  return '';
}

/** Check if an element or any ancestor is a bold element or has bold styling. */
function hasBoldSignal(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const name = current.name.toLowerCase();
    if (name === 'b' || name === 'strong') return true;
    const style = current.attribs?.['style'] ?? '';
    if (/font-weight\s*:\s*(bold|[7-9]00)/i.test(style)) return true;
    current = current.parent && isTag(current.parent) ? current.parent : null;
  }
  return false;
}

/** Check if text is ALL UPPERCASE (ignoring non-letter chars). */
function isAllUppercase(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

/** Check if element has a semantic id matching item pattern. */
function hasSemanticId(el: Element): boolean {
  const id = el.attribs?.['id'] ?? '';
  return /item[_-]?\d/i.test(id);
}

/** Check if element or ancestor has text-align:center. */
function isCenterAligned(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const style = current.attribs?.['style'] ?? '';
    if (/text-align\s*:\s*center/i.test(style)) return true;
    current = current.parent && isTag(current.parent) ? current.parent : null;
  }
  return false;
}

/** Check if element or ancestor has text-decoration:underline. */
function hasUnderline(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const style = current.attribs?.['style'] ?? '';
    if (/text-decoration\s*:\s*underline/i.test(style)) return true;
    current = current.parent && isTag(current.parent) ? current.parent : null;
  }
  return false;
}

/** Check if element is inside an <a> tag. */
function isInsideAnchor(el: Element): boolean {
  let current = el.parent;
  while (current) {
    if (isTag(current) && current.name.toLowerCase() === 'a') return true;
    current = current.parent;
  }
  return false;
}

/** Check if heading text has a cross-reference prefix. */
function hasCrossRefPrefix(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith('see ') || t.startsWith('refer to ');
}

/** Check if element has a font-size larger than default body (10pt). */
function hasLargerFontSize(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const style = current.attribs?.['style'] ?? '';
    const match = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*pt/i);
    if (match) {
      return parseFloat(match[1]) > 10;
    }
    current = current.parent && isTag(current.parent) ? current.parent : null;
  }
  return false;
}

/** Score a heading candidate based on heuristics. */
function scoreCandidate(el: Element, text: string): number {
  let score = 0;

  if (hasBoldSignal(el))          score += 3;
  if (hasLargerFontSize(el))      score += 2;
  if (isAllUppercase(text))       score += 2;
  if (hasSemanticId(el))          score += 3;
  if (isCenterAligned(el))        score += 1;
  if (hasUnderline(el))           score += 1;

  if (isInsideAnchor(el))         score -= 5;
  if (hasCrossRefPrefix(text))    score -= 3;

  return score;
}

/**
 * Walk the DOM tree and find heading candidates.
 */
function findHeadingCandidates(doc: Document): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];

  function walk(node: Node): void {
    if (!isTag(node)) return;

    const name = node.name.toLowerCase();

    if (BLOCK_ELEMENTS.has(name)) {
      const text = getTextContent(node).replace(/\u00a0/g, ' ').trim();
      if (text) {
        const itemNumber = extractItemNumber(text);
        if (itemNumber) {
          const source: SourceLocation = {
            start: node.startIndex!,
            end: node.endIndex! + 1,
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
    // Last occurrence wins (handles TOC before body)
    byItem.set(c.itemNumber, c);
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
 * Extract sections from HTML: parse DOM, find headings, deduplicate, build boundaries.
 */
export function extractSections(
  html: string,
  context: ExtractionContext,
): SectionBoundary[] {
  if (!html.trim()) {
    const msg = 'Empty HTML content';
    context.warnings.push(msg);
    context.logger?.warn(msg);
    return [];
  }

  const doc = parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });

  const candidates = findHeadingCandidates(doc);

  if (candidates.length === 0) {
    const msg = 'No Item headings found';
    context.warnings.push(msg);
    context.logger?.warn(msg);
    return [];
  }

  const deduped = deduplicateCandidates(candidates);

  // Check for preamble content
  if (deduped.length > 0 && deduped[0].source.start > 0) {
    const preambleText = html.slice(0, deduped[0].source.start).replace(/<[^>]*>/g, '').trim();
    if (preambleText.length > 0) {
      const msg = `Content before first Item heading was skipped (${preambleText.length} characters)`;
      context.warnings.push(msg);
      context.logger?.warn(msg);
    }
  }

  return buildSectionBoundaries(deduped, html.length);
}

/**
 * Get the parsed DOM document for content extraction.
 */
export function parseHtml(html: string): Document {
  return parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });
}
