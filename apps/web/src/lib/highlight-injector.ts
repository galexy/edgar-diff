import type { WordChange, SectionDiff, Paragraph } from '@edgar-diff/lib';

export type Side = 'old' | 'new';

interface CharMapping {
  pieceIndex: number;
  charOffset: number;
}

interface TextPiece {
  type: 'text' | 'br';
  node: Node;
  content: string;
}

/**
 * Wrap an entire paragraph's HTML in a block-level <ins> or <del>.
 */
export function wrapParagraph(
  paragraphHtml: string,
  changeType: 'added' | 'removed',
): string {
  if (changeType === 'added') {
    return `<ins class="diff-paragraph-added">${paragraphHtml}</ins>`;
  }
  return `<del class="diff-paragraph-removed">${paragraphHtml}</del>`;
}

// ─── DOM walking helpers ─────────────────────────────────────────

function collectTextPieces(node: Node, pieces: TextPiece[]): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) {
      pieces.push({ type: 'text', node: child, content: child.textContent ?? '' });
    } else if (
      child.nodeType === Node.ELEMENT_NODE &&
      (child as Element).tagName === 'BR'
    ) {
      pieces.push({ type: 'br', node: child, content: ' ' });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      collectTextPieces(child, pieces);
    }
  }
}

/**
 * Build mapping from normalized text positions to DOM text node positions.
 */
export function buildNormalizedMapping(container: DocumentFragment): {
  normalizedText: string;
  charMap: CharMapping[];
  pieces: TextPiece[];
} {
  const pieces: TextPiece[] = [];
  collectTextPieces(container, pieces);

  // Build raw text from pieces
  const rawChars: { char: string; pieceIndex: number; charOffset: number }[] = [];
  for (let pi = 0; pi < pieces.length; pi++) {
    const content = pieces[pi].content;
    for (let ci = 0; ci < content.length; ci++) {
      rawChars.push({ char: content[ci], pieceIndex: pi, charOffset: ci });
    }
  }

  // Normalize: NBSP → space, collapse whitespace, trim
  const charMap: CharMapping[] = [];
  let normalized = '';
  let lastWasSpace = true; // treat start as "after space" to trim leading

  for (const rc of rawChars) {
    let ch = rc.char;
    // NBSP → space
    if (ch === '\u00a0') ch = ' ';
    // Treat all whitespace as space
    const isWhitespace = /\s/.test(ch);
    if (isWhitespace) {
      if (lastWasSpace) continue; // collapse
      charMap.push({ pieceIndex: rc.pieceIndex, charOffset: rc.charOffset });
      normalized += ' ';
      lastWasSpace = true;
    } else {
      charMap.push({ pieceIndex: rc.pieceIndex, charOffset: rc.charOffset });
      normalized += ch;
      lastWasSpace = false;
    }
  }

  // Trim trailing space
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    charMap.pop();
  }

  return { normalizedText: normalized, charMap, pieces };
}

// ─── Word-Level Highlight Injection ──────────────────────────────

/**
 * Inject <ins>/<del> highlights into paragraph HTML at WordChange offsets.
 */
export function injectWordHighlights(
  paragraphHtml: string,
  wordChanges: WordChange[],
  paragraphText: string,
): string {
  if (wordChanges.length === 0) return paragraphHtml;

  // Step 1: Parse HTML into DOM
  const template = document.createElement('template');
  template.innerHTML = paragraphHtml;
  const fragment = template.content;

  // Step 2+3: Build normalized mapping
  const { normalizedText, charMap, pieces } = buildNormalizedMapping(fragment);

  // Sanity check: normalized text should match paragraphText
  if (normalizedText !== paragraphText) {
    return paragraphHtml; // safety fallback
  }

  // Step 4: Sort changes by start offset, process in REVERSE order
  const sorted = [...wordChanges].sort((a, b) => a.start - b.start);

  for (let ci = sorted.length - 1; ci >= 0; ci--) {
    const change = sorted[ci];
    // Clamp offsets
    const start = Math.max(0, change.start);
    const end = Math.min(change.end, paragraphText.length);
    if (start >= end) continue;

    const tag = change.type === 'added' ? 'ins' : 'del';
    const className = change.type === 'added' ? 'diff-added' : 'diff-removed';

    wrapRange(pieces, charMap, start, end, tag, className);
  }

  // Step 5: Serialize back to HTML
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

// ─── Section-Level Highlight Application ─────────────────────────

/**
 * Apply all paragraph diff highlights to a section's HTML slice.
 */
export function applyHighlightsToSection(
  sectionHtml: string,
  sectionOffset: number,
  sectionDiff: SectionDiff,
  paragraphIndex: Map<string, Paragraph>,
  side: Side,
): string {
  // Collect replacements: { relStart, relEnd, html }
  const replacements: { relStart: number; relEnd: number; html: string }[] = [];

  for (const pd of sectionDiff.paragraphDiffs) {
    // Get the source location for this side
    const sourceLoc = pd.sourceMapping[side];
    if (!sourceLoc) continue; // No source on this side (e.g., added para on old side)

    // Convert absolute offsets to relative within section slice
    const relStart = sourceLoc.start - sectionOffset;
    const relEnd = sourceLoc.end - sectionOffset;

    // Bounds check
    if (relStart < 0 || relEnd > sectionHtml.length || relStart >= relEnd) continue;

    const paragraphHtml = sectionHtml.slice(relStart, relEnd);

    let replacedHtml: string;

    if (pd.changeType === 'added' && side === 'new') {
      replacedHtml = wrapParagraph(paragraphHtml, 'added');
    } else if (pd.changeType === 'removed' && side === 'old') {
      replacedHtml = wrapParagraph(paragraphHtml, 'removed');
    } else if (pd.changeType === 'modified' || pd.changeType === 'moved') {
      // Filter word changes by side
      const filteredChanges = (pd.wordChanges ?? []).filter((wc) =>
        side === 'old' ? wc.type === 'removed' : wc.type === 'added',
      );

      if (filteredChanges.length === 0) continue; // Nothing to highlight for this side

      // Look up the paragraph text for normalization mapping
      const paraKey = `${sourceLoc.start}:${sourceLoc.end}`;
      const paragraph = paragraphIndex.get(paraKey);
      if (!paragraph) continue;

      replacedHtml = injectWordHighlights(paragraphHtml, filteredChanges, paragraph.text);
    } else {
      // 'unchanged', 'reordered', etc. — no modification
      continue;
    }

    replacements.push({ relStart, relEnd, html: replacedHtml });
  }

  // Apply replacements in reverse offset order to preserve positions
  replacements.sort((a, b) => b.relStart - a.relStart);

  let result = sectionHtml;
  for (const rep of replacements) {
    result = result.slice(0, rep.relStart) + rep.html + result.slice(rep.relEnd);
  }

  return result;
}

/**
 * Wrap a range of normalized-text positions in <ins>/<del> elements.
 * Processes in reverse piece order to avoid invalidating node references.
 */
function wrapRange(
  pieces: TextPiece[],
  charMap: CharMapping[],
  start: number,
  end: number,
  wrapperTag: string,
  className: string,
): void {
  const startMap = charMap[start];
  // For end, we need the last character position (end-1), not one past
  const endMap = charMap[end - 1];

  if (!startMap || !endMap) return;

  // Process pieces in reverse order to avoid DOM mutation invalidation
  for (let pi = endMap.pieceIndex; pi >= startMap.pieceIndex; pi--) {
    const piece = pieces[pi];
    if (piece.type !== 'text') continue;

    const textNode = piece.node as Text;

    // Calculate the slice boundaries within this text node
    const sliceStart = (pi === startMap.pieceIndex) ? startMap.charOffset : 0;
    const sliceEnd = (pi === endMap.pieceIndex) ? endMap.charOffset + 1 : textNode.length;

    if (sliceStart >= sliceEnd) continue;

    // Split text node to isolate the range
    let targetNode: Text = textNode;

    // Split off the "after" portion first (so sliceStart position remains valid)
    if (sliceEnd < textNode.length) {
      targetNode.splitText(sliceEnd);
    }

    // Split off the "before" portion
    if (sliceStart > 0) {
      targetNode = targetNode.splitText(sliceStart);
    }

    // Wrap targetNode in the highlight element
    const wrapper = document.createElement(wrapperTag);
    wrapper.className = className;
    targetNode.parentNode!.insertBefore(wrapper, targetNode);
    wrapper.appendChild(targetNode);
  }
}
