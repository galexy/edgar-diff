/**
 * Spike A2: linkedom + string scanning source mapping
 *
 * Approach: Parse HTML with linkedom to get a full DOM, then map each element
 * back to its position in the original HTML string using a pre-built tag index.
 *
 * Key challenge: linkedom normalizes HTML during parsing, so outerHTML may not
 * exactly match the original source. We use opening-tag attribute matching
 * with a pre-indexed tag position map for performance.
 */

import { parseHTML } from 'linkedom';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SourceOffset {
  /** Character offset in original HTML string */
  charOffset: number;
  /** Length in characters of the matched region */
  charLength: number;
  /** The tag name of the element */
  tagName: string;
  /** Whether this was an exact match or fuzzy */
  matchType: 'exact' | 'fuzzy' | 'failed';
  /** If fuzzy or failed, what normalization was detected */
  normalization?: string;
}

export interface SectionBoundary {
  /** Section identifier (e.g., "Item 1", "Item 7A") */
  section: string;
  /** Character offset in the original HTML */
  charOffset: number;
  /** The element's text content (trimmed) */
  textContent: string;
  /** Match quality */
  matchType: 'exact' | 'fuzzy' | 'failed';
}

export interface ParseResult {
  /** All element offsets found */
  offsets: SourceOffset[];
  /** Section boundaries detected */
  sections: SectionBoundary[];
  /** Total elements in DOM */
  totalElements: number;
  /** Elements that matched exactly */
  exactMatches: number;
  /** Elements that required fuzzy matching */
  fuzzyMatches: number;
  /** Elements that failed to match */
  failedMatches: number;
  /** Parse + mapping time in ms */
  elapsedMs: number;
}

// ── Tag index for fast lookup ──────────────────────────────────────────────

interface TagOccurrence {
  offset: number;
  /** End offset of the opening tag (position after '>') */
  endOffset: number;
  /** Normalized attribute signature for fast comparison */
  attrSig: string;
  /** Whether this is a self-closing tag */
  selfClosing: boolean;
}

/**
 * Build a normalized attribute signature from a tag string for fast comparison.
 * Normalizes: lowercase attr names, sort-stable, strip quote style.
 */
function buildAttrSignature(tagStr: string): string {
  const attrs: string[] = [];
  const attrRegex = /\s+([\w:.:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(tagStr)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs.push(`${name}=${value}`);
  }
  // Keep original order (linkedom preserves it, and order matters for matching)
  return attrs.join('\0');
}

/** Nested index: tagName → attrSig → TagOccurrence[] for O(1) lookup */
type TagIndex = Map<string, Map<string, TagOccurrence[]>>;
/** Flat index: tagName → all TagOccurrence[] (sorted by offset) for nesting search */
type FlatTagIndex = Map<string, TagOccurrence[]>;

interface BuiltIndex {
  nested: TagIndex;
  flat: FlatTagIndex;
}

/**
 * Pre-build index of all opening tags with their positions and attribute signatures.
 * Returns both a nested index (tagName → attrSig → occurrences) for O(1) lookup
 * and a flat index (tagName → all occurrences) for nesting-aware close-tag search.
 */
function buildTagIndex(html: string): BuiltIndex {
  const nested: TagIndex = new Map();
  const flat: FlatTagIndex = new Map();
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*(?::[a-zA-Z][a-zA-Z0-9._-]*)?)(\s[^>]*)?\s*(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    if (fullTag[1] === '/' || fullTag[1] === '!' || fullTag[1] === '?') continue;

    const tagName = match[1].toLowerCase();
    const attrSig = buildAttrSignature(fullTag);
    const selfClosing = match[3] === '/' || fullTag.endsWith('/>');

    const occ: TagOccurrence = {
      offset: match.index,
      endOffset: match.index + fullTag.length,
      attrSig,
      selfClosing,
    };

    // Nested index
    let byAttr = nested.get(tagName);
    if (!byAttr) {
      byAttr = new Map();
      nested.set(tagName, byAttr);
    }
    let arr = byAttr.get(attrSig);
    if (!arr) {
      arr = [];
      byAttr.set(attrSig, arr);
    }
    arr.push(occ);

    // Flat index
    let flatArr = flat.get(tagName);
    if (!flatArr) {
      flatArr = [];
      flat.set(tagName, flatArr);
    }
    flatArr.push(occ);
  }

  return { nested, flat };
}

// ── Void elements that never have closing tags ─────────────────────────────

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── Core: Walk DOM and map to source offsets ───────────────────────────────

/**
 * Binary search for the first index in a sorted array where offset >= target.
 */
function lowerBound(arr: TagOccurrence[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].offset < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Find the matching closing tag for a given tag name, handling nesting.
 * Uses the pre-built tag index (binary search) to count nested same-name opens,
 * and indexOf for closing tags.
 */
function findMatchingClose(
  html: string,
  tagName: string,
  searchFrom: number,
  allOpensForTag: TagOccurrence[],
): number {
  const closeLower = `</${tagName}>`;
  const closeUpper = `</${tagName.toUpperCase()}>`;
  const closeLen = closeLower.length;

  let depth = 1;
  let pos = searchFrom;

  while (depth > 0) {
    // Find next closing tag (case-insensitive)
    const nextCloseLo = html.indexOf(closeLower, pos);
    const nextCloseUp = html.indexOf(closeUpper, pos);
    let nextClose = -1;
    if (nextCloseLo >= 0 && nextCloseUp >= 0) nextClose = Math.min(nextCloseLo, nextCloseUp);
    else if (nextCloseLo >= 0) nextClose = nextCloseLo;
    else if (nextCloseUp >= 0) nextClose = nextCloseUp;

    if (nextClose < 0) return -1;

    // Count non-self-closing opens between pos and nextClose using binary search
    const startIdx = lowerBound(allOpensForTag, pos);
    for (let i = startIdx; i < allOpensForTag.length; i++) {
      const occ = allOpensForTag[i];
      if (occ.offset >= nextClose) break;
      if (!occ.selfClosing) depth++;
    }

    depth--;
    if (depth === 0) return nextClose + closeLen;
    pos = nextClose + closeLen;
  }

  return -1;
}

/**
 * Walk DOM tree depth-first and map each element to its source position
 * using the pre-built tag index for O(1) lookups per element.
 */
function walkAndMap(
  document: Document,
  originalHtml: string,
): SourceOffset[] {
  const offsets: SourceOffset[] = [];
  const { nested, flat } = buildTagIndex(originalHtml);

  // Per-signature cursor: index into the attrSig occurrence array
  // Key = tagName + '\0' + attrSig
  const cursorMap = new Map<string, number>();

  function walk(node: Node): void {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const el = node as Element;
    const outer = el.outerHTML;
    const tagName = el.tagName?.toLowerCase() ?? 'unknown';

    // Build attribute signature from linkedom's outerHTML opening tag
    const openMatch = outer.match(/^<[^>]*>/);
    const linkedomOpenTag = openMatch?.[0] ?? '';
    const linkedomAttrSig = buildAttrSignature(linkedomOpenTag);

    const byAttr = nested.get(tagName);
    let matched = false;

    if (byAttr) {
      // O(1) lookup by attribute signature
      const occurrences = byAttr.get(linkedomAttrSig);

      if (occurrences) {
        const cursorKey = tagName + '\0' + linkedomAttrSig;
        const startIdx = cursorMap.get(cursorKey) ?? 0;

        if (startIdx < occurrences.length) {
          const occ = occurrences[startIdx];

          // Compute element length
          const isVoid = VOID_ELEMENTS.has(tagName);
          let length: number;

          if (occ.selfClosing || isVoid) {
            length = occ.endOffset - occ.offset;
          } else {
            // Find the matching closing tag using nesting-aware search
            const allOpens = flat.get(tagName) ?? [];
            const closeEnd = findMatchingClose(originalHtml, tagName, occ.endOffset, allOpens);
            if (closeEnd >= 0) {
              length = closeEnd - occ.offset;
            } else {
              length = occ.endOffset - occ.offset; // just opening tag
            }
          }

          // Determine if it's an exact or fuzzy match
          const originalSlice = originalHtml.slice(occ.offset, occ.offset + outer.length);
          const isExact = originalSlice === outer;

          offsets.push({
            charOffset: occ.offset,
            charLength: length,
            tagName,
            matchType: isExact ? 'exact' : 'fuzzy',
            normalization: isExact ? undefined : 'tag-index',
          });
          cursorMap.set(cursorKey, startIdx + 1);
          matched = true;
        }
      }
    }

    if (!matched) {
      offsets.push({
        charOffset: -1,
        charLength: 0,
        tagName,
        matchType: 'failed',
        normalization: byAttr ? 'attrs-mismatch' : 'tag-not-in-index',
      });
    }

    // Recurse into children
    for (const child of el.childNodes) {
      walk(child);
    }
  }

  // Guard: linkedom may return null documentElement for empty/non-HTML input
  let root: Element | null = null;
  try {
    root = document.documentElement ?? document.body;
  } catch {
    // linkedom throws when accessing .body if documentElement is null
  }
  if (root) walk(root);

  return offsets;
}

// ── Section detection ──────────────────────────────────────────────────────

const SECTION_PATTERNS: Array<{ section: string; regex: RegExp }> = [
  { section: 'Item 1', regex: /Item\s+1\.?\s+Business/i },
  { section: 'Item 1A', regex: /Item\s+1A\.?\s+Risk\s+Factors/i },
  { section: 'Item 7', regex: /Item\s+7\.?\s+Management/i },
  { section: 'Item 7A', regex: /Item\s+7A\.?\s+Quantitative/i },
  { section: 'Item 8', regex: /Item\s+8\.?\s+Financial\s+Statements/i },
];

/** Get text content that belongs directly to this element (not children) */
function getDirectTextContent(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      text += child.textContent ?? '';
    }
  }
  return text;
}

function findSections(
  document: Document,
  offsets: SourceOffset[],
): SectionBoundary[] {
  const sections: SectionBoundary[] = [];
  const found = new Set<string>();

  // Build a map from element identity to offset for lookup.
  // Walk all elements in the same order as walkAndMap (querySelectorAll('*')
  // returns document order which matches our depth-first walk).
  const allElements = document.querySelectorAll('*');
  // The offsets array includes html/head/body from the walk root, but
  // querySelectorAll('*') includes all descendants. Build a lookup by
  // matching element index to offset index using tagName alignment.
  // Simplest reliable approach: build a WeakMap by walking the DOM the same
  // way walkAndMap does and pairing each element with its offset entry.
  const elementOffsetMap = new WeakMap<Node, SourceOffset>();
  let offsetIdx = 0;
  function buildMap(node: Node): void {
    if (node.nodeType !== 1) return;
    if (offsetIdx < offsets.length) {
      elementOffsetMap.set(node, offsets[offsetIdx]);
      offsetIdx++;
    }
    for (const child of node.childNodes) {
      buildMap(child);
    }
  }
  let root: Element | null = null;
  try {
    root = document.documentElement ?? document.body;
  } catch {
    // linkedom throws when accessing .body if documentElement is null
  }
  if (root) buildMap(root);

  for (const el of allElements) {
    const text = (el.textContent ?? '').trim();

    for (const { section, regex } of SECTION_PATTERNS) {
      if (found.has(section)) continue;
      if (!regex.test(text)) continue;

      // Prefer narrow elements (direct text matches or short content)
      const directText = getDirectTextContent(el).trim();
      if (!regex.test(directText) && text.length > 200) continue;

      // Look up this element's offset from the pre-computed offsets array
      const offset = elementOffsetMap.get(el);
      if (offset && offset.charOffset >= 0) {
        sections.push({
          section,
          charOffset: offset.charOffset,
          textContent: text.slice(0, 100),
          matchType: offset.matchType,
        });
        found.add(section);
      }
    }
  }

  return sections.sort((a, b) => a.charOffset - b.charOffset);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse HTML and map all elements to their source character offsets.
 */
export function parseAndMap(html: string): ParseResult {
  const start = performance.now();

  const { document } = parseHTML(html);

  const offsets = walkAndMap(document, html);
  const sections = findSections(document, offsets);

  const elapsed = performance.now() - start;

  const exact = offsets.filter((o) => o.matchType === 'exact').length;
  const fuzzy = offsets.filter((o) => o.matchType === 'fuzzy').length;
  const failed = offsets.filter((o) => o.matchType === 'failed').length;

  return {
    offsets,
    sections,
    totalElements: offsets.length,
    exactMatches: exact,
    fuzzyMatches: fuzzy,
    failedMatches: failed,
    elapsedMs: elapsed,
  };
}

/**
 * Quick validation: parse HTML and verify offsets point to valid content.
 */
export function validateOffsets(html: string): {
  valid: number;
  invalid: number;
  details: Array<{
    tagName: string;
    matchType: string;
    charOffset: number;
    verified: boolean;
    snippet?: string;
  }>;
} {
  const result = parseAndMap(html);
  let valid = 0;
  let invalid = 0;
  const details: Array<{
    tagName: string;
    matchType: string;
    charOffset: number;
    verified: boolean;
    snippet?: string;
  }> = [];

  for (const offset of result.offsets) {
    if (offset.charOffset < 0) {
      invalid++;
      details.push({
        tagName: offset.tagName,
        matchType: offset.matchType,
        charOffset: offset.charOffset,
        verified: false,
      });
      continue;
    }

    const snippet = html.slice(offset.charOffset, offset.charOffset + 50);
    const looksLikeTag = snippet.startsWith('<');

    if (looksLikeTag) {
      valid++;
    } else {
      invalid++;
    }

    details.push({
      tagName: offset.tagName,
      matchType: offset.matchType,
      charOffset: offset.charOffset,
      verified: looksLikeTag,
      snippet: snippet.slice(0, 40),
    });
  }

  return { valid, invalid, details };
}

// ── CLI runner ─────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const fixtureDir = path.join(import.meta.dirname ?? '.', 'fixtures');

  console.log('=== Multibyte fixture ===');
  const multibyte = fs.readFileSync(path.join(fixtureDir, 'multibyte.html'), 'utf-8');
  const mbResult = parseAndMap(multibyte);
  console.log(`Elements: ${mbResult.totalElements}`);
  console.log(`Exact: ${mbResult.exactMatches}, Fuzzy: ${mbResult.fuzzyMatches}, Failed: ${mbResult.failedMatches}`);
  console.log(`Sections: ${mbResult.sections.map((s) => s.section).join(', ')}`);
  console.log(`Time: ${mbResult.elapsedMs.toFixed(1)}ms`);

  const appleFile = path.join(fixtureDir, 'apple-10k.html');
  if (fs.existsSync(appleFile)) {
    console.log('\n=== Apple 10-K ===');
    const apple = fs.readFileSync(appleFile, 'utf-8');
    const appleResult = parseAndMap(apple);
    console.log(`Elements: ${appleResult.totalElements}`);
    console.log(`Exact: ${appleResult.exactMatches}, Fuzzy: ${appleResult.fuzzyMatches}, Failed: ${appleResult.failedMatches}`);
    console.log(`Match rate: ${(((appleResult.exactMatches + appleResult.fuzzyMatches) / appleResult.totalElements) * 100).toFixed(1)}%`);
    console.log(`Sections: ${appleResult.sections.map((s) => `${s.section} @${s.charOffset} (${s.matchType})`).join(', ')}`);
    console.log(`Time: ${appleResult.elapsedMs.toFixed(1)}ms`);

    const failed = appleResult.offsets.filter((o) => o.matchType === 'failed');
    if (failed.length > 0) {
      const failedByTag = new Map<string, number>();
      for (const f of failed) {
        failedByTag.set(f.tagName, (failedByTag.get(f.tagName) || 0) + 1);
      }
      console.log('\nFailed by tag:');
      for (const [tag, count] of [...failedByTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`  ${tag}: ${count}`);
      }
    }
  }
}
