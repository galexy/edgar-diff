import { describe, it, expect } from 'vitest';
import { parseAndMap, validateOffsets } from '../index.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname ?? __dirname, '..', 'fixtures');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wrap HTML fragments so linkedom parses all sibling elements */
function wrap(body: string): string {
  return `<html><body>${body}</body></html>`;
}

function assertOffsetPointsToTag(html: string, offset: number, tagName?: string): void {
  const snippet = html.slice(offset, offset + 80);
  expect(snippet[0]).toBe('<');
  if (tagName) {
    expect(snippet).toMatch(
      new RegExp(`^<${tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s>/]`, 'i'),
    );
  }
}

// ── Basic offset accuracy ──────────────────────────────────────────────────

describe('offset accuracy on known HTML', () => {
  it('finds exact offsets for simple well-formed HTML', () => {
    const html = wrap('<div><p>Hello</p><span>World</span></div>');
    const result = parseAndMap(html);

    expect(result.failedMatches).toBe(0);
    expect(result.totalElements).toBeGreaterThan(0);

    for (const offset of result.offsets) {
      if (offset.charOffset >= 0) {
        expect(html[offset.charOffset]).toBe('<');
      }
    }
  });

  it('produces correct character offsets for nested elements', () => {
    const html = wrap('<div><p>one</p><p>two</p></div>');
    const bodyStart = html.indexOf('<div>');
    const result = parseAndMap(html);

    const pOffsets = result.offsets.filter((o) => o.tagName === 'p');
    expect(pOffsets).toHaveLength(2);

    // First <p> starts after <div>
    expect(pOffsets[0].charOffset).toBe(bodyStart + 5);
    // Second <p> starts after </p>
    expect(pOffsets[1].charOffset).toBe(bodyStart + 15);
  });

  it('calculates correct charLength for elements', () => {
    const html = wrap('<div><span class="x">content</span></div>');
    const result = parseAndMap(html);

    const span = result.offsets.find((o) => o.tagName === 'span');
    expect(span).toBeDefined();

    const expected = '<span class="x">content</span>';
    expect(span!.charLength).toBe(expected.length);
    expect(html.slice(span!.charOffset, span!.charOffset + span!.charLength))
      .toBe(expected);
  });
});

// ── Multi-byte character handling ──────────────────────────────────────────

describe('multi-byte characters', () => {
  it('handles emoji correctly', () => {
    const html = wrap('<div>🚀</div><p>after</p>');
    const result = parseAndMap(html);

    const p = result.offsets.find((o) => o.tagName === 'p');
    expect(p).toBeDefined();
    assertOffsetPointsToTag(html, p!.charOffset, 'p');
  });

  it('handles CJK characters', () => {
    const html = wrap('<div>中文</div><span>after</span>');
    const result = parseAndMap(html);

    const span = result.offsets.find((o) => o.tagName === 'span');
    expect(span).toBeDefined();
    assertOffsetPointsToTag(html, span!.charOffset, 'span');
  });

  it('handles accented characters', () => {
    const html = wrap('<div>café résumé</div><p>next</p>');
    const result = parseAndMap(html);

    const p = result.offsets.find((o) => o.tagName === 'p');
    expect(p).toBeDefined();
    assertOffsetPointsToTag(html, p!.charOffset, 'p');
  });

  it('character offsets are character-based not byte-based', () => {
    // Each emoji is 2 UTF-16 code units (surrogate pair)
    const html = wrap('<div>🚀🔥</div><p>X</p>');
    const result = parseAndMap(html);

    const p = result.offsets.find((o) => o.tagName === 'p');
    expect(p).toBeDefined();
    // Verify the offset is a JS string index, not a byte offset
    expect(html[p!.charOffset]).toBe('<');
    expect(html.slice(p!.charOffset, p!.charOffset + 3)).toBe('<p>');
  });

  it('parses the multibyte fixture fully', () => {
    const html = readFileSync(join(FIXTURES, 'multibyte.html'), 'utf-8');
    const result = parseAndMap(html);

    expect(result.failedMatches).toBe(0);
    expect(result.totalElements).toBeGreaterThan(10);

    for (const offset of result.offsets) {
      if (offset.charOffset >= 0) {
        expect(html[offset.charOffset]).toBe('<');
      }
    }
  });
});

// ── Deduplication: repeated identical elements ─────────────────────────────

describe('deduplication of identical elements', () => {
  it('maps duplicate elements to distinct positions', () => {
    const html = wrap('<ul><li>item</li><li>item</li><li>item</li></ul>');
    const result = parseAndMap(html);

    const liOffsets = result.offsets.filter((o) => o.tagName === 'li');
    expect(liOffsets).toHaveLength(3);

    const uniqueOffsets = new Set(liOffsets.map((o) => o.charOffset));
    expect(uniqueOffsets.size).toBe(3);

    // Offsets should be in document order (ascending)
    expect(liOffsets[0].charOffset).toBeLessThan(liOffsets[1].charOffset);
    expect(liOffsets[1].charOffset).toBeLessThan(liOffsets[2].charOffset);
  });

  it('handles many duplicates correctly', () => {
    const rows = Array.from({ length: 50 }, () => '<tr><td>cell</td></tr>').join('');
    const html = wrap(`<table>${rows}</table>`);
    const result = parseAndMap(html);

    const tdOffsets = result.offsets.filter((o) => o.tagName === 'td');
    expect(tdOffsets).toHaveLength(50);

    for (let i = 1; i < tdOffsets.length; i++) {
      expect(tdOffsets[i].charOffset).toBeGreaterThan(tdOffsets[i - 1].charOffset);
    }
  });
});

// ── Sequential scanning maintains document order ───────────────────────────

describe('sequential scanning and document order', () => {
  it('offsets are in strictly increasing document order for siblings', () => {
    const html = wrap('<div><a>1</a><b>2</b><i>3</i><u>4</u></div>');
    const result = parseAndMap(html);

    const leaves = result.offsets.filter((o) =>
      ['a', 'b', 'i', 'u'].includes(o.tagName),
    );
    expect(leaves).toHaveLength(4);

    for (let i = 1; i < leaves.length; i++) {
      expect(leaves[i].charOffset).toBeGreaterThan(leaves[i - 1].charOffset);
    }
  });

  it('parent offset comes before children offsets', () => {
    const html = wrap('<section><div><p>text</p></div></section>');
    const result = parseAndMap(html);

    const section = result.offsets.find((o) => o.tagName === 'section');
    const div = result.offsets.find((o) => o.tagName === 'div');
    const p = result.offsets.find((o) => o.tagName === 'p');

    expect(section).toBeDefined();
    expect(div).toBeDefined();
    expect(p).toBeDefined();

    expect(section!.charOffset).toBeLessThan(div!.charOffset);
    expect(div!.charOffset).toBeLessThan(p!.charOffset);
  });
});

// ── Nested structures ──────────────────────────────────────────────────────

describe('nested structures', () => {
  it('parent outerHTML contains children but offsets are independent', () => {
    const html = wrap('<div id="outer"><div id="inner">text</div></div>');
    const result = parseAndMap(html);

    const divs = result.offsets.filter((o) => o.tagName === 'div');
    expect(divs.length).toBeGreaterThanOrEqual(2);

    // Outer div comes before inner div
    expect(divs[0].charOffset).toBeLessThan(divs[1].charOffset);
  });

  it('deeply nested structures maintain accuracy', () => {
    const html = wrap('<a><b><c><d><e>deep</e></d></c></b></a>');
    const result = parseAndMap(html);

    // Filter to just the test elements (exclude html, head, body)
    const testTags = result.offsets.filter((o) =>
      ['a', 'b', 'c', 'd', 'e'].includes(o.tagName),
    );
    expect(testTags).toHaveLength(5);

    for (let i = 1; i < testTags.length; i++) {
      expect(testTags[i].charOffset).toBeGreaterThan(testTags[i - 1].charOffset);
    }
  });
});

// ── Self-closing / void elements ───────────────────────────────────────────

describe('self-closing and void elements', () => {
  it('handles <br> correctly', () => {
    const html = wrap('<div>before<br>after</div>');
    const result = parseAndMap(html);

    const br = result.offsets.find((o) => o.tagName === 'br');
    expect(br).toBeDefined();
    assertOffsetPointsToTag(html, br!.charOffset, 'br');
  });

  it('handles self-closing <br/> syntax', () => {
    const html = wrap('<div>before<br/>after</div>');
    const result = parseAndMap(html);

    const br = result.offsets.find((o) => o.tagName === 'br');
    expect(br).toBeDefined();
    assertOffsetPointsToTag(html, br!.charOffset, 'br');
  });

  it('handles <img> with attributes', () => {
    const html = wrap('<div><img src="test.png" alt="test"></div>');
    const result = parseAndMap(html);

    const img = result.offsets.find((o) => o.tagName === 'img');
    expect(img).toBeDefined();
    assertOffsetPointsToTag(html, img!.charOffset, 'img');
  });

  it('handles <hr/> self-closing', () => {
    const html = wrap('<div>before<hr/>after</div>');
    const result = parseAndMap(html);

    const hr = result.offsets.find((o) => o.tagName === 'hr');
    expect(hr).toBeDefined();
    assertOffsetPointsToTag(html, hr!.charOffset, 'hr');
  });
});

// ── HTML comments ──────────────────────────────────────────────────────────

describe('HTML comments', () => {
  it('does not affect offset calculation around comments', () => {
    const html = wrap('<div>before</div><!-- comment --><p>after</p>');
    const result = parseAndMap(html);

    const p = result.offsets.find((o) => o.tagName === 'p');
    expect(p).toBeDefined();
    assertOffsetPointsToTag(html, p!.charOffset, 'p');
    // Verify offset is after the comment
    expect(html.slice(p!.charOffset, p!.charOffset + 3)).toBe('<p>');
  });

  it('comments do not appear as elements (linkedom limitation)', () => {
    const html = wrap('<div><!-- hidden --><p>visible</p></div>');
    const result = parseAndMap(html);

    // No comment nodes should appear as elements
    const commentElements = result.offsets.filter((o) => o.tagName === '#comment');
    expect(commentElements).toHaveLength(0);
  });
});

// ── Normalization edge cases ───────────────────────────────────────────────

describe('HTML normalization (linkedom behavior)', () => {
  it('handles extra whitespace in tags via fuzzy matching', () => {
    const html = wrap('<div  class="x"  >content</div>');
    const result = parseAndMap(html);

    const div = result.offsets.find(
      (o) => o.tagName === 'div' && html.slice(o.charOffset, o.charOffset + 5) === '<div ',
    );
    expect(div).toBeDefined();
    expect(result.failedMatches).toBe(0);
  });

  it('handles single-quote to double-quote normalization', () => {
    const html = wrap("<div class='test'>content</div>");
    const result = parseAndMap(html);

    // Find the div with class='test' (not the body wrapper div)
    const targetIdx = html.indexOf("<div class='test'>");
    const div = result.offsets.find((o) => o.tagName === 'div' && o.charOffset === targetIdx);
    expect(div).toBeDefined();
    // linkedom normalizes quotes, so this should be a fuzzy match
    expect(div!.matchType).toBe('fuzzy');
  });

  it('handles self-closing td (SEC filing pattern)', () => {
    const html = wrap('<table><tr><td style="width:1%"/><td style="width:99%"/></tr></table>');
    const result = parseAndMap(html);

    const tds = result.offsets.filter((o) => o.tagName === 'td');
    expect(tds).toHaveLength(2);
    expect(tds[0].charOffset).not.toBe(-1);
    expect(tds[1].charOffset).not.toBe(-1);
    expect(tds[0].charOffset).not.toBe(tds[1].charOffset);
  });

  it('handles uppercase tags', () => {
    const html = '<HTML><BODY><DIV><P>text</P></DIV></BODY></HTML>';
    const result = parseAndMap(html);

    // linkedom lowercases tag names in outerHTML, so fuzzy match needed
    const div = result.offsets.find((o) => o.tagName === 'div');
    expect(div).toBeDefined();
    expect(div!.matchType).toBe('fuzzy');
    assertOffsetPointsToTag(html, div!.charOffset, 'DIV');
  });
});

// ── Section boundary detection ─────────────────────────────────────────────

describe('section boundary detection', () => {
  it('finds standard 10-K section boundaries', () => {
    const html = wrap(`
      <div>
        <p>Item 1. Business</p>
        <p>Content of business section</p>
        <p>Item 1A. Risk Factors</p>
        <p>Content of risk factors</p>
        <p>Item 7. Management's Discussion</p>
        <p>MD&amp;A content</p>
        <p>Item 7A. Quantitative and Qualitative Disclosures</p>
        <p>Quantitative content</p>
        <p>Item 8. Financial Statements and Supplementary Data</p>
        <p>Financial content</p>
      </div>`);
    const result = parseAndMap(html);

    expect(result.sections).toHaveLength(5);
    expect(result.sections.map((s) => s.section)).toEqual([
      'Item 1', 'Item 1A', 'Item 7', 'Item 7A', 'Item 8',
    ]);

    for (let i = 1; i < result.sections.length; i++) {
      expect(result.sections[i].charOffset).toBeGreaterThan(result.sections[i - 1].charOffset);
    }
  });

  it('finds sections in multibyte fixture', () => {
    const html = readFileSync(join(FIXTURES, 'multibyte.html'), 'utf-8');
    const result = parseAndMap(html);

    const sectionNames = result.sections.map((s) => s.section);
    expect(sectionNames).toContain('Item 1');
    expect(sectionNames).toContain('Item 1A');
    expect(sectionNames).toContain('Item 8');
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('validateOffsets', () => {
  it('reports all offsets as valid for clean HTML', () => {
    const html = wrap('<div><p>Hello</p><span>World</span></div>');
    const { valid, invalid } = validateOffsets(html);

    expect(invalid).toBe(0);
    expect(valid).toBeGreaterThan(0);
  });

  it('verifies offsets point to actual tag openings', () => {
    const html = wrap('<div class="a"><p>text</p></div>');
    const { details } = validateOffsets(html);

    for (const d of details) {
      if (d.charOffset >= 0) {
        expect(d.verified).toBe(true);
        expect(d.snippet).toMatch(/^</);
      }
    }
  });
});

// ── Performance ────────────────────────────────────────────────────────────

describe('performance', () => {
  const appleFile = join(FIXTURES, 'apple-10k.html');
  const hasAppleFixture = existsSync(appleFile);

  it.skipIf(!hasAppleFixture)('parses full 10-K in under 2000ms', () => {
    const html = readFileSync(appleFile, 'utf-8');

    // Warm up
    parseAndMap(html);

    // Measure
    const start = performance.now();
    const result = parseAndMap(html);
    const elapsed = performance.now() - start;

    console.log(`  10-K parse time: ${elapsed.toFixed(0)}ms`);
    console.log(`  Elements: ${result.totalElements}`);
    console.log(`  Match rate: ${(((result.exactMatches + result.fuzzyMatches) / result.totalElements) * 100).toFixed(1)}%`);

    expect(elapsed).toBeLessThan(2000);
  });

  it.skipIf(!hasAppleFixture)('finds all 5 section boundaries in real filing', () => {
    const html = readFileSync(appleFile, 'utf-8');
    const result = parseAndMap(html);

    expect(result.sections).toHaveLength(5);
    expect(result.sections.map((s) => s.section)).toEqual([
      'Item 1', 'Item 1A', 'Item 7', 'Item 7A', 'Item 8',
    ]);

    for (const s of result.sections) {
      expect(s.charOffset).toBeGreaterThan(0);
      // Verify offset points to an opening '<'
      expect(html[s.charOffset]).toBe('<');
    }
  });

  it.skipIf(!hasAppleFixture)('achieves >99% match rate on real filing', () => {
    const html = readFileSync(appleFile, 'utf-8');
    const result = parseAndMap(html);

    const matchRate = (result.exactMatches + result.fuzzyMatches) / result.totalElements;
    console.log(`  Match rate: ${(matchRate * 100).toFixed(2)}%`);
    console.log(`  Exact: ${result.exactMatches}, Fuzzy: ${result.fuzzyMatches}, Failed: ${result.failedMatches}`);

    expect(matchRate).toBeGreaterThan(0.99);
  });
});

// ── Entity encoding ────────────────────────────────────────────────────────

describe('entity encoding', () => {
  it('preserves HTML entities in offsets', () => {
    const html = wrap('<div>&amp; &lt; &gt;</div>');
    const result = parseAndMap(html);

    expect(result.failedMatches).toBe(0);
    const div = result.offsets.find(
      (o) => o.tagName === 'div' && html.slice(o.charOffset + 1, o.charOffset + 4) === 'div',
    );
    expect(div).toBeDefined();
  });
});

// ── XBRL namespaced elements ───────────────────────────────────────────────

describe('XBRL namespaced elements', () => {
  it('handles ix:nonfraction elements', () => {
    const html = wrap('<div><ix:nonfraction name="dei:Revenue" format="ixt:num-dot-decimal">1,234</ix:nonfraction></div>');
    const result = parseAndMap(html);

    const ix = result.offsets.find((o) => o.tagName === 'ix:nonfraction');
    expect(ix).toBeDefined();
    if (ix) {
      expect(ix.charOffset).toBeGreaterThanOrEqual(0);
      assertOffsetPointsToTag(html, ix.charOffset, 'ix:nonfraction');
    }
  });
});
