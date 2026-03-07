/**
 * Spike A1 — Task 3: Comprehensive vitest tests for htmlparser2 source mapping.
 */

import { describe, it, expect } from 'vitest';
import { parseDocument } from 'htmlparser2';
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document, Element, ChildNode, Text } from 'domhandler';
import { assertDefined } from '../../../tests/helpers/assert-defined.js';

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
  assertDefined(node.startIndex);
  assertDefined(node.endIndex);
  return html.slice(node.startIndex, node.endIndex + 1);
}

// ── Offset accuracy on known small strings ──────────────────────────

describe('offset accuracy on small HTML strings', () => {
  it('should capture a simple paragraph', () => {
    const html = '<p>Hello</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    expect(sliceNode(html, p)).toBe('<p>Hello</p>');
  });

  it('should capture nested elements', () => {
    const html = '<div><span>text</span></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    const span = findByTag(doc, 'span');
    assertDefined(span);
    expect(sliceNode(html, div)).toBe('<div><span>text</span></div>');
    expect(sliceNode(html, span)).toBe('<span>text</span>');
  });

  it('should capture elements with attributes', () => {
    const html = '<a href="https://example.com" class="link">click</a>';
    const doc = parse(html);
    const a = findByTag(doc, 'a');
    assertDefined(a);
    expect(sliceNode(html, a)).toBe(html);
  });

  it('should handle text nodes', () => {
    const html = '<p>hello world</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const textNode = p.children[0];
    assertDefined(textNode);
    expect(textNode.type).toBe('text');
    expect(sliceNode(html, textNode)).toBe('hello world');
  });

  it('should handle multiple sibling elements', () => {
    const html = '<ul><li>a</li><li>b</li><li>c</li></ul>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const lis = nodes.filter((n) => isElement(n) && n.tagName === 'li') as Element[];
    expect(lis).toHaveLength(3);
    const li0 = lis[0]; assertDefined(li0);
    const li1 = lis[1]; assertDefined(li1);
    const li2 = lis[2]; assertDefined(li2);
    expect(sliceNode(html, li0)).toBe('<li>a</li>');
    expect(sliceNode(html, li1)).toBe('<li>b</li>');
    expect(sliceNode(html, li2)).toBe('<li>c</li>');
  });
});

// ── Multi-byte characters ───────────────────────────────────────────

describe('multi-byte characters', () => {
  it('should handle emoji in text', () => {
    const html = '<p>🚀 launch</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    expect(sliceNode(html, p)).toBe('<p>🚀 launch</p>');
  });

  it('should handle CJK characters', () => {
    const html = '<p>中文测试</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    expect(sliceNode(html, p)).toBe('<p>中文测试</p>');
  });

  it('should handle accented characters', () => {
    const html = '<p>résumé café naïve</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    expect(sliceNode(html, p)).toBe('<p>résumé café naïve</p>');
  });

  it('should handle mixed multi-byte and ASCII', () => {
    const html = '<div>Hello世界🌍test</div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    expect(sliceNode(html, div)).toBe('<div>Hello世界🌍test</div>');
  });

  it('should have correct text node indices with emoji prefix', () => {
    const html = '<span>🚀abc</span>';
    const doc = parse(html);
    const span = findByTag(doc, 'span');
    assertDefined(span);
    const text = span.children[0];
    assertDefined(text);
    // 🚀 is 2 UTF-16 code units, then 'abc' is 3
    expect(sliceNode(html, text)).toBe('🚀abc');
  });

  it('should handle compound emoji (ZWJ sequences)', () => {
    const html = '<p>👨‍👩‍👧‍👦</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    expect(sliceNode(html, p)).toBe('<p>👨‍👩‍👧‍👦</p>');
  });
});

// ── CDATA sections ──────────────────────────────────────────────────

describe('CDATA sections', () => {
  it('should handle CDATA-like content in script tags', () => {
    const html = '<script>//<![CDATA[\nvar x = 1;\n//]]></script>';
    const doc = parse(html);
    const script = findByTag(doc, 'script');
    assertDefined(script);
    expect(sliceNode(html, script)).toBe(html);
  });

  it('should handle script content with angle brackets', () => {
    const html = '<script>if (a < b && c > d) {}</script>';
    const doc = parse(html);
    const script = findByTag(doc, 'script');
    assertDefined(script);
    expect(sliceNode(html, script)).toBe(html);
  });
});

// ── HTML comments ───────────────────────────────────────────────────

describe('HTML comments', () => {
  it('should track comment node indices', () => {
    const html = '<div><!-- hello --></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    const comment = div.children[0];
    assertDefined(comment);
    expect(comment.type).toBe('comment');
    expect(sliceNode(html, comment)).toBe('<!-- hello -->');
  });

  it('should handle comments between elements', () => {
    const html = '<p>a</p><!-- mid --><p>b</p>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const comment = nodes.find((n) => n.type === 'comment');
    assertDefined(comment);
    expect(sliceNode(html, comment)).toBe('<!-- mid -->');
  });

  it('should handle multi-line comments', () => {
    const html = '<div><!--\n  multi\n  line\n--></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    const comment = div.children[0];
    assertDefined(comment);
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
    const outerDiv = divs[0]; assertDefined(outerDiv);
    expect(sliceNode(html, outerDiv)).toBe(html);

    // Innermost div captures just its content
    const innermost = divs[depth - 1];
    assertDefined(innermost);
    expect(sliceNode(html, innermost)).toBe('<div>innermost</div>');
  });

  it('should handle nested tables (common in SEC filings)', () => {
    const html = '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const tables = nodes.filter((n) => isElement(n) && n.tagName === 'table') as Element[];
    expect(tables).toHaveLength(2);
    const table0 = tables[0]; assertDefined(table0);
    const table1 = tables[1]; assertDefined(table1);
    expect(sliceNode(html, table0)).toBe(html);
    expect(sliceNode(html, table1)).toBe('<table><tr><td>nested</td></tr></table>');
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
    const img = findByTag(doc, 'img');
    assertDefined(img);
    expect(sliceNode(html, img)).toBe(html);
  });

  it('should handle <hr>', () => {
    const html = '<div><hr></div>';
    const doc = parse(html);
    const hr = findByTag(doc, 'hr');
    assertDefined(hr);
    expect(sliceNode(html, hr)).toBe('<hr>');
  });

  it('should handle <input> with many attributes', () => {
    const html = '<input type="text" name="q" value="search" placeholder="Search...">';
    const doc = parse(html);
    const input = findByTag(doc, 'input');
    assertDefined(input);
    expect(sliceNode(html, input)).toBe(html);
  });

  it('should handle XHTML self-closing syntax', () => {
    const html = '<br/>';
    const doc = parse(html);
    const br = findByTag(doc, 'br');
    assertDefined(br);
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
      assertDefined(node.endIndex);
      expect(node.startIndex).toBeLessThanOrEqual(node.endIndex);
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
      assertDefined(node.endIndex);
      expect(node.startIndex).toBeLessThanOrEqual(node.endIndex);
    }
  });

  it('should have startIndex < endIndex for all non-empty elements', () => {
    const html = '<div><p>content</p><span>more</span></div>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const elements = nodes.filter((n) => isElement(n)) as Element[];
    for (const el of elements) {
      assertDefined(el.endIndex);
      expect(el.startIndex).toBeLessThan(el.endIndex);
    }
  });
});

// ── Performance ─────────────────────────────────────────────────────

describe('performance', () => {
  const filingPath = join(FIXTURES_DIR, 'apple-10k.html');

  async function loadFixtureOrSkip(ctx: { skip: () => void }): Promise<string> {
    try {
      await access(filingPath);
    } catch {
      ctx.skip();
      return ''; // unreachable after skip
    }
    return readFile(filingPath, 'utf-8');
  }

  it('should parse full 10-K in under 500ms', async (ctx) => {
    const html = await loadFixtureOrSkip(ctx);

    const t0 = performance.now();
    parse(html);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(500);
  });

  it('should parse 10-K with consistent results across iterations', async (ctx) => {
    const html = await loadFixtureOrSkip(ctx);

    const doc1 = parse(html);
    const doc2 = parse(html);
    const nodes1 = collectNodes(doc1);
    const nodes2 = collectNodes(doc2);

    expect(nodes1.length).toBe(nodes2.length);
    // Spot-check a few indices
    for (let i = 0; i < Math.min(100, nodes1.length); i++) {
      const n1 = nodes1[i]; assertDefined(n1);
      const n2 = nodes2[i]; assertDefined(n2);
      expect(n1.startIndex).toBe(n2.startIndex);
      expect(n1.endIndex).toBe(n2.endIndex);
    }
  });
});

// ── endIndex semantics ──────────────────────────────────────────────

describe('endIndex semantics', () => {
  it('endIndex is inclusive — need slice(start, end + 1) for full capture', () => {
    const html = '<b>bold</b>';
    const doc = parse(html);
    const b = findByTag(doc, 'b');
    assertDefined(b);
    assertDefined(b.startIndex);
    assertDefined(b.endIndex);
    // endIndex points to the last character of the closing tag (the '>')
    expect(html[b.endIndex]).toBe('>');
    // slice(start, end) misses the last char
    expect(html.slice(b.startIndex, b.endIndex)).toBe('<b>bold</b');
    // slice(start, end + 1) captures everything
    expect(html.slice(b.startIndex, b.endIndex + 1)).toBe('<b>bold</b>');
  });

  it('endIndex for text nodes is inclusive', () => {
    const html = '<p>text</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const text = p.children[0];
    assertDefined(text);
    assertDefined(text.startIndex);
    assertDefined(text.endIndex);
    expect(html.slice(text.startIndex, text.endIndex + 1)).toBe('text');
  });
});

// ── Indices are JS string indices (UTF-16), not byte offsets ────────

describe('indices are JS string indices', () => {
  it('should use char indices not byte indices for emoji', () => {
    const html = '<p>🚀x</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const text = p.children[0];
    assertDefined(text);
    assertDefined(text.startIndex);
    assertDefined(text.endIndex);

    // '🚀' is 2 UTF-16 code units, 'x' is 1 = 3 total
    // As bytes (UTF-8), '🚀' is 4 bytes, 'x' is 1 = 5 total
    const slice = html.slice(text.startIndex, text.endIndex + 1);
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
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const text = p.children[0];
    assertDefined(text);
    assertDefined(text.startIndex);
    assertDefined(text.endIndex);

    // '中' is 1 UTF-16 code unit but 3 UTF-8 bytes
    expect(text.startIndex).toBe(3); // after <p>
    expect(html.slice(text.startIndex, text.endIndex + 1)).toBe('中x');
  });
});

// ── Empty HTML ──────────────────────────────────────────────────────

describe('empty HTML', () => {
  it('should produce no nodes for empty string', () => {
    const doc = parse('');
    const nodes = collectNodes(doc);
    expect(nodes).toHaveLength(0);
  });

  it('should handle whitespace-only HTML', () => {
    const html = '   \n\t  ';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    // Should have one text node
    expect(nodes).toHaveLength(1);
    const node0 = nodes[0]; assertDefined(node0);
    expect(node0.type).toBe('text');
    expect(sliceNode(html, node0)).toBe(html);
  });
});

// ── Malformed HTML ──────────────────────────────────────────────────

describe('malformed HTML', () => {
  it('should handle unclosed tags with valid indices', () => {
    const html = '<div><p>unclosed<span>also unclosed';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
    }
  });

  it('should handle mismatched closing tags with valid indices', () => {
    const html = '<div><p>text</span></div>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
    }
  });

  it('should handle duplicate closing tags', () => {
    const html = '<p>text</p></p></p>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
    }
  });

  it('should handle interleaved tags', () => {
    const html = '<b><i>bold-italic</b></i>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
    }
  });
});

// ── Section boundary detection ──────────────────────────────────────

describe('section boundary detection', () => {
  function getTextContent(node: ChildNode): string {
    if (node.type === 'text') return (node as Text).data;
    if (isElement(node)) return node.children.map(getTextContent).join('');
    return '';
  }

  function findSectionHeadings(doc: Document, html: string): { label: string; slice: string }[] {
    const patterns = [
      { label: 'Item 1 ', pattern: /\bItem\s+1[.\s]/i },
      { label: 'Item 1A', pattern: /\bItem\s+1A\b/i },
      { label: 'Item 7 ', pattern: /\bItem\s+7[.\s]/i },
      { label: 'Item 7A', pattern: /\bItem\s+7A\b/i },
      { label: 'Item 8 ', pattern: /\bItem\s+8[.\s]/i },
    ];
    const found = new Set<string>();
    const results: { label: string; slice: string }[] = [];

    function walk(node: ChildNode): void {
      if (found.size === patterns.length) return;
      if (isElement(node)) {
        const text = getTextContent(node).trim();
        for (const p of patterns) {
          if (found.has(p.label)) continue;
          if (p.pattern.test(text)) {
            found.add(p.label);
            results.push({ label: p.label, slice: sliceNode(html, node) });
            break;
          }
        }
        for (const child of node.children) walk(child);
      }
    }
    for (const child of doc.children) walk(child);
    return results;
  }

  it('should find all 5 section headings in synthetic SEC HTML', () => {
    const html = `<html><body>
      <h2>Item 1. Business</h2>
      <p>Description of business...</p>
      <h2>Item 1A. Risk Factors</h2>
      <p>Risk factors...</p>
      <h2>Item 7. MD&amp;A</h2>
      <p>Management discussion...</p>
      <h2>Item 7A. Quantitative Disclosures</h2>
      <p>Market risk...</p>
      <h2>Item 8. Financial Statements</h2>
      <p>Financial data...</p>
    </body></html>`;

    const doc = parse(html);
    const hits = findSectionHeadings(doc, html);
    expect(hits).toHaveLength(5);
    expect(hits.map((h) => h.label)).toEqual(['Item 1 ', 'Item 1A', 'Item 7 ', 'Item 7A', 'Item 8 ']);
  });

  it('should handle SEC-style inline formatting in section headings', () => {
    const html = `<div><span style="font-weight:bold">Item 1. Business</span></div>
      <div><span style="font-weight:bold">Item 1A. Risk Factors</span></div>
      <div><b>Item 7. MD&amp;A</b></div>
      <div><b>Item 7A. Market Risk</b></div>
      <div><b>Item 8. Financial Statements</b></div>`;

    const doc = parse(html);
    const hits = findSectionHeadings(doc, html);
    expect(hits).toHaveLength(5);
    // Verify slices contain the expected text
    for (const hit of hits) {
      expect(hit.slice).toContain('Item');
    }
  });
});
