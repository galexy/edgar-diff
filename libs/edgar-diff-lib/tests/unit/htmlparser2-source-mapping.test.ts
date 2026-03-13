/**
 * htmlparser2 source-mapping assumption tests.
 *
 * These verify behaviors of htmlparser2 that our parser depends on:
 * - withStartIndices / withEndIndices produce JS string (UTF-16) indices
 * - endIndex is inclusive (need slice(start, end + 1) for full capture)
 * - Multi-byte characters (emoji, CJK, ZWJ) don't corrupt offsets
 * - Malformed HTML still produces valid indices
 *
 * Ported from spikes/source-mapping/ before archival.
 */

import { describe, it, expect } from 'vitest';
import { parseDocument } from 'htmlparser2';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Document, Element, ChildNode } from 'domhandler';
import { assertDefined } from '../helpers/assert-defined.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'integration', 'fixtures');

function parse(html: string): Document {
  return parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

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

function findByTag(doc: Document, tag: string): Element | undefined {
  const nodes = collectNodes(doc);
  return nodes.find((n) => isElement(n) && n.tagName === tag) as Element | undefined;
}

function sliceNode(html: string, node: ChildNode): string {
  assertDefined(node.startIndex);
  assertDefined(node.endIndex);
  return html.slice(node.startIndex, node.endIndex + 1);
}

// ── Multi-byte characters ───────────────────────────────────────────

describe('htmlparser2: multi-byte characters', () => {
  it.each([
    { name: 'emoji', html: '<p>\u{1F680} launch</p>', expected: '<p>\u{1F680} launch</p>' },
    { name: 'CJK', html: '<p>中文测试</p>', expected: '<p>中文测试</p>' },
    { name: 'accented', html: '<p>résumé café naïve</p>', expected: '<p>résumé café naïve</p>' },
    { name: 'mixed multi-byte and ASCII', html: '<div>Hello世界\u{1F30D}test</div>', expected: '<div>Hello世界\u{1F30D}test</div>' },
    { name: 'compound emoji (ZWJ)', html: '<p>\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}</p>', expected: '<p>\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}</p>' },
  ])('preserves correct offsets for $name', ({ html, expected }) => {
    const doc = parse(html);
    const tag = html.startsWith('<p') ? 'p' : 'div';
    const el = findByTag(doc, tag);
    assertDefined(el);
    expect(sliceNode(html, el)).toBe(expected);
  });

  it('text node indices correct with emoji prefix', () => {
    const html = '<span>\u{1F680}abc</span>';
    const doc = parse(html);
    const span = findByTag(doc, 'span');
    assertDefined(span);
    const text = span.children[0];
    assertDefined(text);
    expect(sliceNode(html, text)).toBe('\u{1F680}abc');
  });
});

// ── CDATA sections ──────────────────────────────────────────────────

describe('htmlparser2: CDATA sections', () => {
  it.each([
    { name: 'CDATA-like content in script', html: '<script>//<![CDATA[\nvar x = 1;\n//]]></script>' },
    { name: 'script with angle brackets', html: '<script>if (a < b && c > d) {}</script>' },
  ])('handles $name', ({ html }) => {
    const doc = parse(html);
    const script = findByTag(doc, 'script');
    assertDefined(script);
    expect(sliceNode(html, script)).toBe(html);
  });
});

// ── HTML comments ───────────────────────────────────────────────────

describe('htmlparser2: HTML comments', () => {
  it('tracks comment node indices', () => {
    const html = '<div><!-- hello --></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    const comment = div.children[0];
    assertDefined(comment);
    expect(comment.type).toBe('comment');
    expect(sliceNode(html, comment)).toBe('<!-- hello -->');
  });

  it('handles multi-line comments', () => {
    const html = '<div><!--\n  multi\n  line\n--></div>';
    const doc = parse(html);
    const div = findByTag(doc, 'div');
    assertDefined(div);
    const comment = div.children[0];
    assertDefined(comment);
    expect(sliceNode(html, comment)).toBe('<!--\n  multi\n  line\n-->');
  });
});

// ── Self-closing tags ───────────────────────────────────────────────

describe('htmlparser2: self-closing tags', () => {
  it.each([
    { name: '<br>', html: '<p>line1<br>line2</p>', tag: 'br', expected: '<br>' },
    { name: '<img>', html: '<img src="test.png" alt="photo">', tag: 'img', expected: '<img src="test.png" alt="photo">' },
    { name: '<hr>', html: '<div><hr></div>', tag: 'hr', expected: '<hr>' },
    { name: '<input>', html: '<input type="text" name="q" value="search" placeholder="Search...">', tag: 'input', expected: '<input type="text" name="q" value="search" placeholder="Search...">' },
    { name: 'XHTML <br/>', html: '<br/>', tag: 'br', expected: '<br/>' },
  ])('handles $name', ({ html, tag, expected }) => {
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const el = nodes.find((n) => isElement(n) && n.tagName === tag) as Element;
    expect(el).toBeDefined();
    expect(sliceNode(html, el)).toBe(expected);
  });
});

// ── Deeply nested structures ────────────────────────────────────────

describe('htmlparser2: deeply nested structures', () => {
  it('maintains accurate indices at depth 10', () => {
    let html = '';
    const depth = 10;
    for (let i = 0; i < depth; i++) html += '<div>';
    html += 'innermost';
    for (let i = 0; i < depth; i++) html += '</div>';

    const doc = parse(html);
    const nodes = collectNodes(doc);
    const divs = nodes.filter((n) => isElement(n) && n.tagName === 'div') as Element[];
    expect(divs).toHaveLength(depth);

    const outerDiv = divs[0]; assertDefined(outerDiv);
    expect(sliceNode(html, outerDiv)).toBe(html);

    const innermost = divs[depth - 1]; assertDefined(innermost);
    expect(sliceNode(html, innermost)).toBe('<div>innermost</div>');
  });

  it('handles nested tables (common in SEC filings)', () => {
    const html = '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    const tables = nodes.filter((n) => isElement(n) && n.tagName === 'table') as Element[];
    expect(tables).toHaveLength(2);
    expect(sliceNode(html, tables[0]!)).toBe(html);
    expect(sliceNode(html, tables[1]!)).toBe('<table><tr><td>nested</td></tr></table>');
  });
});

// ── endIndex semantics ──────────────────────────────────────────────

describe('htmlparser2: endIndex semantics', () => {
  it('endIndex is inclusive -- need slice(start, end + 1) for full capture', () => {
    const html = '<b>bold</b>';
    const doc = parse(html);
    const b = findByTag(doc, 'b');
    assertDefined(b);
    assertDefined(b.startIndex);
    assertDefined(b.endIndex);
    expect(html[b.endIndex]).toBe('>');
    expect(html.slice(b.startIndex, b.endIndex)).toBe('<b>bold</b'.slice(0));
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

describe('htmlparser2: indices are JS string indices', () => {
  it('uses char indices not byte indices for emoji', () => {
    const html = '<p>\u{1F680}x</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const text = p.children[0];
    assertDefined(text);
    assertDefined(text.startIndex);
    assertDefined(text.endIndex);

    const slice = html.slice(text.startIndex, text.endIndex + 1);
    expect(slice).toBe('\u{1F680}x');
    expect(text.startIndex).toBe(3); // after <p>
    expect(text.endIndex).toBe(3 + 2 + 1 - 1); // 5
  });

  it('uses char indices for CJK', () => {
    const html = '<p>中x</p>';
    const doc = parse(html);
    const p = findByTag(doc, 'p');
    assertDefined(p);
    const text = p.children[0];
    assertDefined(text);
    assertDefined(text.startIndex);
    expect(text.startIndex).toBe(3);
    expect(html.slice(text.startIndex, text.endIndex! + 1)).toBe('中x');
  });
});

// ── Malformed HTML ──────────────────────────────────────────────────

describe('htmlparser2: malformed HTML', () => {
  it.each([
    { name: 'unclosed tags', html: '<div><p>unclosed<span>also unclosed' },
    { name: 'mismatched closing tags', html: '<div><p>text</span></div>' },
    { name: 'duplicate closing tags', html: '<p>text</p></p></p>' },
    { name: 'interleaved tags', html: '<b><i>bold-italic</b></i>' },
  ])('produces valid indices for $name', ({ html }) => {
    const doc = parse(html);
    const nodes = collectNodes(doc);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
    }
  });
});

// ── Empty HTML ──────────────────────────────────────────────────────

describe('htmlparser2: empty HTML', () => {
  it('produces no nodes for empty string', () => {
    const doc = parse('');
    expect(collectNodes(doc)).toHaveLength(0);
  });

  it('handles whitespace-only HTML', () => {
    const html = '   \n\t  ';
    const doc = parse(html);
    const nodes = collectNodes(doc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe('text');
    expect(sliceNode(html, nodes[0]!)).toBe(html);
  });
});

// ── Index boundary validation on real fixture ───────────────────────

describe('htmlparser2: index boundary validation', () => {
  it('all indices within bounds for multibyte fixture', async () => {
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

  it('all indices within bounds for real 10-K filing', async () => {
    const html = await readFile(join(FIXTURES_DIR, '10k-aapl-2024.html'), 'utf-8');
    const doc = parse(html);
    const nodes = collectNodes(doc);
    expect(nodes.length).toBeGreaterThan(1000);
    for (const node of nodes) {
      expect(node.startIndex).toBeGreaterThanOrEqual(0);
      expect(node.startIndex).toBeLessThanOrEqual(html.length);
      expect(node.endIndex).toBeGreaterThanOrEqual(0);
      expect(node.endIndex).toBeLessThanOrEqual(html.length);
      assertDefined(node.endIndex);
      expect(node.startIndex).toBeLessThanOrEqual(node.endIndex);
    }
  });

  it('parsing is deterministic (consistent results across runs)', async () => {
    const html = await readFile(join(FIXTURES_DIR, '10k-aapl-2024.html'), 'utf-8');
    const doc1 = parse(html);
    const doc2 = parse(html);
    const nodes1 = collectNodes(doc1);
    const nodes2 = collectNodes(doc2);

    expect(nodes1.length).toBe(nodes2.length);
    for (let i = 0; i < Math.min(100, nodes1.length); i++) {
      expect(nodes1[i]!.startIndex).toBe(nodes2[i]!.startIndex);
      expect(nodes1[i]!.endIndex).toBe(nodes2[i]!.endIndex);
    }
  });
});
