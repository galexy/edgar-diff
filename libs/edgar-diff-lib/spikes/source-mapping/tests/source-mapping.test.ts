/**
 * Spike A1 — Task 3: Comprehensive vitest tests for htmlparser2 source mapping.
 */

import { describe, it, expect } from 'vitest';
import { parseDocument } from 'htmlparser2';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document, Element, ChildNode } from 'domhandler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

/** Parse HTML with source index tracking enabled. */
function parse(html: string): Document {
  return parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

/** Collect all nodes depth-first. */
function collectNodes(doc: Document): ChildNode[] {
  const nodes: ChildNode[] = [];
  function walk(node: ChildNode): void {
    nodes.push(node);
    if (isElement(node)) {
      for (const child of node.children) walk(child);
    }
  }
  for (const child of doc.children) walk(child);
  return nodes;
}

/** Find first element by tag name. */
function findByTag(doc: Document, tag: string): Element | undefined {
  const nodes = collectNodes(doc);
  return nodes.find((n) => isElement(n) && n.tagName === tag) as Element | undefined;
}

/** Extract element including its closing tag using slice(start, end+1). */
function sliceNode(html: string, node: ChildNode): string {
  return html.slice(node.startIndex!, node.endIndex! + 1);
}

// ── Offset accuracy on known small strings ──────────────────────────

describe('offset accuracy on small HTML strings', () => {
  it('should capture a simple paragraph', () => {
    const html = '<p>Hello</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    expect(p).toBeDefined();
    expect(sliceNode(html, p)).toBe('<p>Hello</p>');
  });

  it('should capture nested elements', () => {
    const html = '<div><span>text</span></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div')!;
    const span = findByTag(doc, 'span')!;
    expect(sliceNode(html, div)).toBe('<div><span>text</span></div>');
    expect(sliceNode(html, span)).toBe('<span>text</span>');
  });

  it('should capture elements with attributes', () => {
    const html = '<a href="https://example.com" class="link">click</a>';
    const doc = parse(html);
    const a = findByTag(doc, 'a')!;
    expect(sliceNode(html, a)).toBe(html);
  });

  it('should handle text nodes', () => {
    const html = '<p>hello world</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    const textNode = p.children[0]!;
    expect(textNode.type).toBe('text');
    expect(sliceNode(html, textNode)).toBe('hello world');
  });

  it('should handle multiple sibling elements', () => {
    const html = '<ul><li>a</li><li>b</li><li>c</li></ul>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const lis = nodes.filter((n) => isElement(n) && n.tagName === 'li') as Element[];
    expect(lis).toHaveLength(3);
    expect(sliceNode(html, lis[0]!)).toBe('<li>a</li>');
    expect(sliceNode(html, lis[1]!)).toBe('<li>b</li>');
    expect(sliceNode(html, lis[2]!)).toBe('<li>c</li>');
  });
});

// ── Multi-byte characters ───────────────────────────────────────────

describe('multi-byte characters', () => {
  it('should handle emoji in text', () => {
    const html = '<p>🚀 launch</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    expect(sliceNode(html, p)).toBe('<p>🚀 launch</p>');
  });

  it('should handle CJK characters', () => {
    const html = '<p>中文测试</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    expect(sliceNode(html, p)).toBe('<p>中文测试</p>');
  });

  it('should handle accented characters', () => {
    const html = '<p>résumé café naïve</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    expect(sliceNode(html, p)).toBe('<p>résumé café naïve</p>');
  });

  it('should handle mixed multi-byte and ASCII', () => {
    const html = '<div>Hello世界🌍test</div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div')!;
    expect(sliceNode(html, div)).toBe('<div>Hello世界🌍test</div>');
  });

  it('should have correct text node indices with emoji prefix', () => {
    const html = '<span>🚀abc</span>';
    const doc = parse(html);
    const span = findByTag(doc, 'span')!;
    const text = span.children[0]!;
    // 🚀 is 2 UTF-16 code units, then 'abc' is 3
    expect(sliceNode(html, text)).toBe('🚀abc');
  });

  it('should handle compound emoji (ZWJ sequences)', () => {
    const html = '<p>👨‍👩‍👧‍👦</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    expect(sliceNode(html, p)).toBe('<p>👨‍👩‍👧‍👦</p>');
  });
});

// ── CDATA sections ──────────────────────────────────────────────────

describe('CDATA sections', () => {
  it('should handle CDATA-like content in script tags', () => {
    const html = '<script>//<![CDATA[\nvar x = 1;\n//]]></script>';
    const doc = parse(html);
    const script = findByTag(doc, 'script')!;
    expect(script).toBeDefined();
    expect(sliceNode(html, script)).toBe(html);
  });

  it('should handle script content with angle brackets', () => {
    const html = '<script>if (a < b && c > d) {}</script>';
    const doc = parse(html);
    const script = findByTag(doc, 'script')!;
    expect(sliceNode(html, script)).toBe(html);
  });
});

// ── HTML comments ───────────────────────────────────────────────────

describe('HTML comments', () => {
  it('should track comment node indices', () => {
    const html = '<div><!-- hello --></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div')!;
    const comment = div.children[0]!;
    expect(comment.type).toBe('comment');
    expect(sliceNode(html, comment)).toBe('<!-- hello -->');
  });

  it('should handle comments between elements', () => {
    const html = '<p>a</p><!-- mid --><p>b</p>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const comment = nodes.find((n) => n.type === 'comment')!;
    expect(comment).toBeDefined();
    expect(sliceNode(html, comment)).toBe('<!-- mid -->');
  });

  it('should handle multi-line comments', () => {
    const html = '<div><!--\n  multi\n  line\n--></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div')!;
    const comment = div.children[0]!;
    expect(comment.type).toBe('comment');
    expect(sliceNode(html, comment)).toBe('<!--\n  multi\n  line\n-->');
  });
});

// ── Deeply nested structures ────────────────────────────────────────

describe('deeply nested structures', () => {
  it('should maintain accurate indices at depth 10', () => {
    let html = '';
    const depth = 10;
    for (let i = 0; i < depth; i++) html += '<div>';
    html += 'innermost';
    for (let i = 0; i < depth; i++) html += '</div>';

    const doc = parse(html);
    const nodes = collectNodes(doc);
    const divs = nodes.filter((n) => isElement(n) && n.tagName === 'div') as Element[];
    expect(divs).toHaveLength(depth);

    // Outermost div captures everything
    expect(sliceNode(html, divs[0]!)).toBe(html);

    // Innermost div captures just its content
    const innermost = divs[depth - 1]!;
    expect(sliceNode(html, innermost)).toBe('<div>innermost</div>');
  });

  it('should handle nested tables (common in SEC filings)', () => {
    const html = '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const tables = nodes.filter((n) => isElement(n) && n.tagName === 'table') as Element[];
    expect(tables).toHaveLength(2);
    expect(sliceNode(html, tables[0]!)).toBe(html);
    expect(sliceNode(html, tables[1]!)).toBe('<table><tr><td>nested</td></tr></table>');
  });
});

// ── Self-closing tags ───────────────────────────────────────────────

describe('self-closing tags', () => {
  it('should handle <br>', () => {
    const html = '<p>line1<br>line2</p>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const br = nodes.find((n) => isElement(n) && n.tagName === 'br') as Element;
    expect(br).toBeDefined();
    expect(sliceNode(html, br)).toBe('<br>');
  });

  it('should handle <img> with attributes', () => {
    const html = '<img src="test.png" alt="photo">';
    const doc = parse(html);
    const img = findByTag(doc, 'img')!;
    expect(sliceNode(html, img)).toBe(html);
  });

  it('should handle <hr>', () => {
    const html = '<div><hr></div>';
    const doc = parse(html);
    const hr = findByTag(doc, 'hr')!;
    expect(sliceNode(html, hr)).toBe('<hr>');
  });

  it('should handle <input> with many attributes', () => {
    const html = '<input type="text" name="q" value="search" placeholder="Search...">';
    const doc = parse(html);
    const input = findByTag(doc, 'input')!;
    expect(sliceNode(html, input)).toBe(html);
  });

  it('should handle XHTML self-closing syntax', () => {
    const html = '<br/>';
    const doc = parse(html);
    const br = findByTag(doc, 'br')!;
    expect(sliceNode(html, br)).toBe('<br/>');
  });
});

// ── Boundary: all indices within [0, html.length] ──────────────────

describe('index boundary validation', () => {
  it('should have all indices within [0, html.length] for small doc', () => {
    const html = '<html><head><title>T</title></head><body><p>text</p></body></html>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
      expect(node.startIndex).toBeLessThanOrEqual(node.endIndex!);
    }
  });

  it('should have all indices within bounds for multibyte fixture', async () => {
    const html = await readFile(join(FIXTURES_DIR, 'multibyte.html'), 'utf-8');
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
      expect(node.startIndex).toBeLessThanOrEqual(node.endIndex!);
    }
  });

  it('should have startIndex < endIndex for all non-empty elements', () => {
    const html = '<div><p>content</p><span>more</span></div>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const elements = nodes.filter((n) => isElement(n)) as Element[];
    for (const el of elements) {
      expect(el.startIndex).toBeLessThan(el.endIndex!);
    }
  });
});

// ── Performance ─────────────────────────────────────────────────────

describe('performance', () => {
  it('should parse full 10-K in under 500ms', async () => {
    let html: string;
    try {
      html = await readFile(join(FIXTURES_DIR, 'apple-10k.html'), 'utf-8');
    } catch {
      // Skip if fixture not available
      return;
    }

    const t0 = performance.now();
    parse(html);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(500);
  });

  it('should parse 10-K with consistent results across iterations', async () => {
    let html: string;
    try {
      html = await readFile(join(FIXTURES_DIR, 'apple-10k.html'), 'utf-8');
    } catch {
      return;
    }

    const doc1 = parse(html);
    const doc2 = parse(html);
    const nodes1 = collectNodes(doc1);
    const nodes2 = collectNodes(doc2);

    expect(nodes1.length).toBe(nodes2.length);
    // Spot-check a few indices
    for (let i = 0; i < Math.min(100, nodes1.length); i++) {
      expect(nodes1[i]!.startIndex).toBe(nodes2[i]!.startIndex);
      expect(nodes1[i]!.endIndex).toBe(nodes2[i]!.endIndex);
    }
  });
});

// ── endIndex semantics ──────────────────────────────────────────────

describe('endIndex semantics', () => {
  it('endIndex is inclusive — need slice(start, end + 1) for full capture', () => {
    const html = '<b>bold</b>';
    const doc = parse(html);
    const b = findByTag(doc, 'b')!;
    // endIndex points to the last character of the closing tag (the '>')
    expect(html[b.endIndex!]).toBe('>');
    // slice(start, end) misses the last char
    expect(html.slice(b.startIndex!, b.endIndex!)).toBe('<b>bold</b');
    // slice(start, end + 1) captures everything
    expect(html.slice(b.startIndex!, b.endIndex! + 1)).toBe('<b>bold</b>');
  });

  it('endIndex for text nodes is inclusive', () => {
    const html = '<p>text</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    const text = p.children[0]!;
    expect(html.slice(text.startIndex!, text.endIndex! + 1)).toBe('text');
  });
});

// ── Indices are JS string indices (UTF-16), not byte offsets ────────

describe('indices are JS string indices', () => {
  it('should use char indices not byte indices for emoji', () => {
    const html = '<p>🚀x</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    const text = p.children[0]!;

    // '🚀' is 2 UTF-16 code units, 'x' is 1 = 3 total
    // As bytes (UTF-8), '🚀' is 4 bytes, 'x' is 1 = 5 total
    const slice = html.slice(text.startIndex!, text.endIndex! + 1);
    expect(slice).toBe('🚀x');

    // If they were byte indices, the slice would be wrong
    // The startIndex should be 3 (<p> is 3 chars)
    expect(text.startIndex).toBe(3);
    // endIndex should be 5 (3 + 2 code units for 🚀 = 5, then +1 for 'x' = 6, but inclusive so 5)
    expect(text.endIndex).toBe(3 + 2 + 1 - 1); // 5
  });

  it('should use char indices for CJK', () => {
    const html = '<p>中x</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p')!;
    const text = p.children[0]!;

    // '中' is 1 UTF-16 code unit but 3 UTF-8 bytes
    expect(text.startIndex).toBe(3); // after <p>
    expect(html.slice(text.startIndex!, text.endIndex! + 1)).toBe('中x');
  });
});
