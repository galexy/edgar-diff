import { parseDocument } from 'htmlparser2';
import type { Node, Element } from 'domhandler';
import { isTag, isText } from 'domhandler';
import type { ContentBlock, Paragraph, Table, SourceLocation } from '../types.js';
import type { ExtractionContext, SectionBoundary } from './types.js';

/** Check if a node falls within the given range. */
function isInRange(node: Node, start: number, end: number): boolean {
  return node.startIndex != null && node.startIndex >= start && node.endIndex != null && node.endIndex! + 1 <= end;
}

/** Accumulate text from all descendant text nodes. */
function getTextContent(node: Node): string {
  if (isText(node)) {
    return node.data;
  }
  if (isTag(node)) {
    return node.children.map(getTextContent).join('');
  }
  return '';
}

/** Find all block-level elements within a range from the pre-parsed DOM. */
function findBlocksInRange(
  node: Node,
  start: number,
  end: number,
  blocks: ContentBlock[],
  context: ExtractionContext,
): void {
  if (!isTag(node)) return;

  const nodeStart = node.startIndex ?? -1;
  const nodeEnd = (node.endIndex ?? -1) + 1;

  // Skip nodes completely outside range
  if (nodeEnd <= start || nodeStart >= end) return;

  const name = node.name.toLowerCase();

  // Handle table elements — must start within range
  if (name === 'table' && nodeStart >= start && nodeStart < end) {
    // Clip end to section boundary
    const clippedEnd = Math.min(nodeEnd, end);
    const source: SourceLocation = { start: nodeStart, end: clippedEnd };
    const table: Table = {
      type: 'table',
      rows: [],
      source,
    };
    if (context.includeSourceHtml) {
      table.sourceHtml = context.html.slice(source.start, source.end);
    }
    blocks.push(table);
    return; // Don't recurse into tables
  }

  // Handle paragraph-level elements — must start within range
  if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(name) && nodeStart >= start && nodeStart < end) {
    // Skip if this element contains a table (table will be handled separately)
    const hasTable = hasDescendantTag(node, 'table');
    if (!hasTable) {
      const text = getTextContent(node)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 0 && text.trim().length > 0) {
        // Clip end to section boundary
        const clippedEnd = Math.min(nodeEnd, end);
        const source: SourceLocation = { start: nodeStart, end: clippedEnd };
        const paragraph: Paragraph = {
          type: 'paragraph',
          text,
          source,
        };
        if (context.includeSourceHtml) {
          paragraph.sourceHtml = context.html.slice(source.start, source.end);
        }
        blocks.push(paragraph);
      }
      return; // Don't recurse into already-handled paragraphs
    }
  }

  // Recurse into children
  for (const child of node.children) {
    findBlocksInRange(child, start, end, blocks, context);
  }
}

function hasDescendantTag(node: Element, tagName: string): boolean {
  for (const child of node.children) {
    if (isTag(child)) {
      if (child.name.toLowerCase() === tagName) return true;
      if (hasDescendantTag(child, tagName)) return true;
    }
  }
  return false;
}

/**
 * Extract content blocks from a section boundary using the pre-parsed DOM.
 */
export function extractContentBlocks(
  boundary: SectionBoundary,
  doc: import('domhandler').Document,
  context: ExtractionContext,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const contentStart = boundary.heading.source.end; // Start after heading element
  const contentEnd = boundary.contentEnd;

  for (const child of doc.children) {
    findBlocksInRange(child, contentStart, contentEnd, blocks, context);
  }

  // Filter whitespace-only paragraphs
  return blocks.filter(b => {
    if (b.type === 'paragraph') {
      return b.text.trim().length > 0;
    }
    return true;
  });
}
