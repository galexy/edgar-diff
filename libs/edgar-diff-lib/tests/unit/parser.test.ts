import { describe, it, expect, vi } from 'vitest';
import { assertDefined } from '../helpers/assert-defined.js';
import { Temporal } from '@js-temporal/polyfill';
import { extractItemNumber, normalizeHeading } from '../../src/parser/section-extractor.js';
import { parseFiling } from '../../src/parser/parser.js';
import type { RawFiling } from '../../src/client/types.js';
import type { Logger, Table } from '../../src/types.js';

function makeRawFiling(html: string, overrides?: Partial<RawFiling>): RawFiling {
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: 'test-filing.htm',
    html,
    fetchedAt: Temporal.Now.instant(),
    ...overrides,
  };
}

describe('extractItemNumber', () => {
  it('U1: standard mixed-case heading', () => {
    expect(extractItemNumber('Item 1A. Risk Factors')).toBe('1a');
  });

  it('U2: uppercase heading', () => {
    expect(extractItemNumber('ITEM 7. MANAGEMENT DISCUSSION')).toBe('7');
  });

  it('U3: bare item number', () => {
    expect(extractItemNumber('Item 1')).toBe('1');
  });

  it('U4: with PART prefix and em-dash', () => {
    expect(extractItemNumber('PART I \u2014 Item 1. Business')).toBe('1');
  });

  it('U5: non-item text returns null', () => {
    expect(extractItemNumber('The Company reported...')).toBeNull();
  });

  it('U6: cross-reference (not anchored to start) returns null', () => {
    expect(extractItemNumber('See Item 1A for details')).toBeNull();
  });

  it('U7: regulation reference (item 601) returns null', () => {
    expect(extractItemNumber('Item 601 of Regulation S-K')).toBeNull();
  });

  it('U32: KNOWN_ITEMS boundary -- Item 16 valid, Item 17 not', () => {
    expect(extractItemNumber('Item 16. Exhibits')).toBe('16');
    expect(extractItemNumber('Item 17. Financial Statements')).toBeNull();
  });

  it('U33: Item 9c (last valid lettered item)', () => {
    expect(extractItemNumber('Item 9C. Disclosure Regarding Foreign Jurisdictions')).toBe('9c');
  });

  it('U8: item with trailing period only', () => {
    expect(extractItemNumber('Item 1B.')).toBe('1b');
  });

  it('U9: unicode en-dash separator', () => {
    expect(extractItemNumber('Item 7A \u2013 Market Risk')).toBe('7a');
  });

  it('U28: non-breaking space between ITEM and number (WMT pattern)', () => {
    expect(extractItemNumber('ITEM\u00a01. BUSINESS')).toBe('1');
  });

  it('U29: non-breaking space in simple form', () => {
    expect(extractItemNumber('ITEM\u00a01A.')).toBe('1a');
  });
});

describe('normalizeHeading', () => {
  it('U10: collapse whitespace and trim', () => {
    expect(normalizeHeading('  Item  1A.   Risk  Factors  ')).toBe('item 1a. risk factors');
  });

  it('U11: strip leading/trailing punctuation', () => {
    expect(normalizeHeading('---Item 1.---')).toBe('item 1');
  });

  it('U12: lowercase', () => {
    expect(normalizeHeading('ITEM 7A. QUANTITATIVE DISCLOSURES')).toBe('item 7a. quantitative disclosures');
  });
});

// --- Section extraction tests ---

describe('section extraction - pattern families', () => {
  it.each<{ name: string; testId: string; html: string }>([
    {
      name: 'A (div>span bold)',
      testId: 'U13',
      html: `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Apple designs iPhones.</p>
<div><span style="font-weight:700">Item 1A. Risk Factors</span></div>
<p>Risks include competition.</p>
</body></html>`,
    },
    {
      name: 'B (DFIN bold uppercase)',
      testId: 'U14',
      html: `<html><body>
<p><span style="font-weight:bold;font-size:12pt">ITEM 1. BUSINESS</span></p>
<p>Microsoft develops software.</p>
<p><span style="font-weight:bold;font-size:12pt">ITEM 1A. RISK FACTORS</span></p>
<p>Risks include regulation.</p>
</body></html>`,
    },
    {
      name: 'C (non-bold larger font)',
      testId: 'U15',
      html: `<html><body>
<div><span style="font-size:12pt;font-weight:400">Item 1. Business.</span></div>
<p style="font-size:10pt">JPMorgan provides financial services.</p>
<div><span style="font-size:12pt;font-weight:400">Item 1A. Risk Factors</span></div>
<p style="font-size:10pt">Banking risks exist.</p>
</body></html>`,
    },
    {
      name: 'D (table-based)',
      testId: 'U16',
      html: `<html><body>
<table><tr>
  <td><span style="font-weight:700">ITEM 1.</span></td>
  <td><span style="font-weight:700">BUSINESS</span></td>
</tr></table>
<p>Walmart operates retail stores.</p>
<table><tr>
  <td><span style="font-weight:700">ITEM 1A.</span></td>
  <td><span style="font-weight:700">RISK FACTORS</span></td>
</tr></table>
<p>Retail risks include competition.</p>
</body></html>`,
    },
    {
      name: 'E (legacy font tag)',
      testId: 'U17',
      html: `<html><body>
<p><b><font style="font-size:11pt;text-transform:uppercase">ITEM 1. BUSINESS</font></b></p>
<p>ExxonMobil explores for oil.</p>
<p><b><font style="font-size:11pt;text-transform:uppercase">ITEM 1A. RISK FACTORS</font></b></p>
<p>Oil price volatility is a risk.</p>
</body></html>`,
    },
  ])('$testId: detects 2 sections from Pattern Family $name', ({ html }) => {
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].id).toBe('item-1');
    expect(doc.sections[1].id).toBe('item-1a');
  });
});

describe('TOC deduplication', () => {
  it('U18: keeps body occurrence, not TOC', () => {
    const htmlTOC = `<html><body>
<div><a href="#item1"><span style="font-weight:700">Item 1. Business</span></a></div>
<div><a href="#item1a"><span style="font-weight:700">Item 1A. Risk Factors</span></a></div>
<hr/>
<div id="item1"><span style="font-weight:700">Item 1. Business</span></div>
<p>Actual business content here.</p>
<div id="item1a"><span style="font-weight:700">Item 1A. Risk Factors</span></div>
<p>Actual risk content here.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlTOC));
    expect(doc.sections).toHaveLength(2);
    // Sections should point past the TOC (to the body headings)
    const hrIndex = htmlTOC.indexOf('<hr');
    expect(doc.sections[0].source.start).toBeGreaterThan(hrIndex);
  });
});

describe('split-element headings', () => {
  it('U19: heading split across sibling spans (MSFT pattern)', () => {
    const htmlSplit = `<html><body>
<p><span style="font-weight:bold">ITEM </span><span style="font-weight:bold">1. BUSINESS</span></p>
<p>Content here.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlSplit));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe('item-1');
    expect(doc.sections[0].heading).toContain('ITEM');
    expect(doc.sections[0].heading).toContain('BUSINESS');
  });

  it('U20: heading split across td cells (WMT pattern)', () => {
    const htmlSplitTd = `<html><body>
<table><tr>
  <td><span style="font-weight:700">ITEM\u00a01.</span></td>
  <td><span style="font-weight:700">BUSINESS</span></td>
</tr></table>
<p>Content here.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlSplitTd));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe('item-1');
  });
});

describe('iXBRL wrapper transparency', () => {
  it('U21: heading inside ix:nonNumeric detected', () => {
    const htmlIXBRL = `<html><body>
<div><ix:nonnumeric><span style="font-weight:700">Item 1C. Cybersecurity</span></ix:nonnumeric></div>
<p>Cybersecurity program details.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlIXBRL));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe('item-1c');
  });
});

describe('source offset accuracy', () => {
  it('U22: start/end offsets allow round-trip slice', () => {
    const html = `<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const section = doc.sections[0];
    const slice = html.slice(section.source.start, section.source.end);
    expect(slice).toContain('Item 1. Business');
    expect(section.source.start).toBeGreaterThanOrEqual(0);
    expect(section.source.end).toBeLessThanOrEqual(html.length);
  });
});

describe('paragraph extraction', () => {
  it('U23: paragraphs extracted with text and source mappings', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>First paragraph of business section.</p>
<p>Second paragraph with more details.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.sections[0].blocks.length).toBeGreaterThanOrEqual(2);
    const paragraphs = doc.sections[0].blocks.filter(b => b.type === 'paragraph');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0]).toMatchObject({
      type: 'paragraph',
      text: expect.stringContaining('First paragraph'),
    });
    expect(paragraphs[0].source.start).toBeLessThan(paragraphs[0].source.end);
  });
});

describe('empty sections / table stubs', () => {
  it('U24: section with no content between headings', () => {
    const htmlEmpty = `<html><body>
<div><span style="font-weight:700">Item 4. Mine Safety Disclosures</span></div>
<div><span style="font-weight:700">Item 5. Market Info</span></div>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlEmpty));
    const item4 = doc.sections.find(s => s.id === 'item-4');
    assertDefined(item4);
    expect(item4.blocks).toHaveLength(0);
  });

  it('U25: section with only a table -- table emitted with populated rows', () => {
    const htmlTable = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Revenue</td><td>$100B</td></tr></table>
<div><span style="font-weight:700">Item 9. Changes</span></div>
</body></html>`;
    const doc2 = parseFiling(makeRawFiling(htmlTable));
    const item8 = doc2.sections.find(s => s.id === 'item-8');
    assertDefined(item8);
    expect(item8.blocks).toHaveLength(1);
    const table = item8.blocks[0] as Table;
    expect(table.type).toBe('table');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells[0].text).toBe('Revenue');
    expect(table.source.start).toBeLessThan(table.source.end);
    const tableSlice = htmlTable.slice(table.source.start, table.source.end);
    expect(tableSlice).toContain('<table');
  });
});

describe('subsections and preamble', () => {
  it('U30: all sections have level=1 and empty subsections', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Content.</p>
<h3>Overview</h3>
<p>Sub-content that is NOT detected as a subsection.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.sections[0].level).toBe(1);
    expect(doc.sections[0].subsections).toEqual([]);
  });

  it('U31: content before first Item heading is not captured as a section', () => {
    const html = `<html><body>
<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p>
<p>FORM 10-K</p>
<p>Apple Inc.</p>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Business content.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe('item-1');
  });
});

describe('parseFiling() orchestrator', () => {
  it('U26: returns valid StructuredDocument shape', () => {
    const html = `<html><body><h2>Item 1. Business</h2><p>Content.</p></body></html>`;
    const raw = makeRawFiling(html);
    const doc = parseFiling(raw);
    expect(doc.filing).toBe(raw);
    expect(doc.sections).toBeInstanceOf(Array);
    expect(doc.parseWarnings).toBeInstanceOf(Array);
  });

  it('U27: with includeSourceHtml option', () => {
    const html = `<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>`;
    const raw = makeRawFiling(html);
    const doc2 = parseFiling(raw, { includeSourceHtml: true });
    expect(doc2.sections[0].sourceHtml).toBeDefined();
    expect(doc2.sections[0].sourceHtml).toContain('Item 1');
  });
});

describe('cross-reference suppression', () => {
  it('U34: bold Item heading inside <a> tag should NOT be detected', () => {
    const htmlCrossRef = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Our business is described below.</p>
<p>For risk factors, see <a href="#item1a"><span style="font-weight:700">Item 1A. Risk Factors</span></a> above.</p>
<div><span style="font-weight:700">Item 2. Properties</span></div>
<p>Properties content.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlCrossRef));
    expect(doc.sections.map(s => s.id)).toEqual(['item-1', 'item-2']);
  });
});

describe('sourceHtml default behavior', () => {
  it('U35: sourceHtml is undefined when includeSourceHtml is not set', () => {
    const html = `<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.sections[0].sourceHtml).toBeUndefined();
  });
});

describe('preamble skipped warning', () => {
  it('U36: warning emitted for preamble content', () => {
    const html = `<html><body>
<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p>
<p>FORM 10-K</p>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Content.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    expect(doc.parseWarnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/content before first item heading/i)])
    );
  });
});

describe('section ID uniqueness', () => {
  it('U37: no duplicate section IDs', () => {
    const htmlDup = `<html><body>
<div><a href="#i1"><span style="font-weight:700">Item 1. Business</span></a></div>
<div><a href="#i1a"><span style="font-weight:700">Item 1A. Risk Factors</span></a></div>
<hr/>
<div id="i1"><span style="font-weight:700">Item 1. Business</span></div>
<p>Business content.</p>
<div id="i1a"><span style="font-weight:700">Item 1A. Risk Factors</span></div>
<p>Risk content.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlDup));
    const ids = doc.sections.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('block ordering', () => {
  it('U38: blocks are ordered by source offset', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>First paragraph.</p>
<p>Second paragraph.</p>
<p>Third paragraph.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const blocks = doc.sections[0].blocks;
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].source.start).toBeGreaterThan(blocks[i - 1].source.start);
    }
  });
});

describe('whitespace-only content', () => {
  it('U39: whitespace-only paragraphs filtered out', () => {
    const htmlWs = `<html><body>
<div><span style="font-weight:700">Item 4. Mine Safety Disclosures</span></div>
<p>&nbsp;</p>
<p>   </p>
<div><span style="font-weight:700">Item 5. Market Info</span></div>
<p>Content here.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlWs));
    const item4 = doc.sections.find(s => s.id === 'item-4');
    assertDefined(item4);
    expect(item4.blocks.every(b => b.type !== 'paragraph' || b.text.trim().length > 0)).toBe(true);
  });
});

describe('logger integration', () => {
  it('U-logger: logger.warn called for empty HTML', () => {
    const logger: Logger = { warn: vi.fn() };
    parseFiling(makeRawFiling(''), { logger });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('boundary conditions', () => {
  it('B1a: zero sections -- no Item headings', () => {
    const doc = parseFiling(makeRawFiling('<html><body><p>Just a paragraph with no items.</p></body></html>'));
    expect(doc.sections).toHaveLength(0);
  });

  it('B1b: one section', () => {
    const doc = parseFiling(makeRawFiling('<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>'));
    expect(doc.sections).toHaveLength(1);
  });

  it('B2: empty HTML input', () => {
    const doc = parseFiling(makeRawFiling(''));
    expect(doc.sections).toHaveLength(0);
    expect(doc.parseWarnings.length).toBeGreaterThan(0);
  });

  it('B5: deeply nested headings', () => {
    const htmlDeep = `<html><body>
<div><div><div><p><b><span>Item 1. Business</span></b></p></div></div></div>
<p>Content under deeply nested heading.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlDeep));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe('item-1');
  });

  it('B8: unicode dashes in headings', () => {
    const htmlUnicode = `<html><body>
<div><span style="font-weight:700">Item 1A \u2014 Risk Factors</span></div>
<p>Content.</p>
<div><span style="font-weight:700">Item 7A \u2013 Market Risk</span></div>
<p>Content.</p>
</body></html>`;
    const doc = parseFiling(makeRawFiling(htmlUnicode));
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].id).toBe('item-1a');
    expect(doc.sections[1].id).toBe('item-7a');
  });

  it('B9: filing with missing body tag', () => {
    const doc = parseFiling(makeRawFiling('<html><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></html>'));
    expect(doc.sections.length).toBeGreaterThanOrEqual(1);
  });
});

describe('layout table transparency', () => {
  it('U40: layout wrapper table containing two inner data tables produces 2 table blocks', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>
    <table><tr><td>Revenue</td><td>$100B</td></tr></table>
    <table><tr><td>Expenses</td><td>$80B</td></tr></table>
  </td></tr>
</table>
<div><span style="font-weight:700">Item 9. Changes</span></div>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const item8 = doc.sections.find(s => s.id === 'item-8');
    assertDefined(item8);
    const tables = item8.blocks.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
  });

  it('U41: layout wrapper table containing paragraphs and data tables produces both block types', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>
    <p>The following table summarizes revenue.</p>
    <table><tr><td>Revenue</td><td>$100B</td></tr></table>
  </td></tr>
</table>
<div><span style="font-weight:700">Item 9. Changes</span></div>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const item8 = doc.sections.find(s => s.id === 'item-8');
    assertDefined(item8);
    const paragraphs = item8.blocks.filter(b => b.type === 'paragraph');
    const tables = item8.blocks.filter(b => b.type === 'table');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs[0].text).toContain('summarizes revenue');
  });

  it('U42: nested layout tables (layout within layout) still extract inner data tables', () => {
    const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>
    <table>
      <tr><td>
        <table><tr><td>Revenue</td><td>$100B</td></tr></table>
        <table><tr><td>Expenses</td><td>$80B</td></tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
<div><span style="font-weight:700">Item 9. Changes</span></div>
</body></html>`;
    const doc = parseFiling(makeRawFiling(html));
    const item8 = doc.sections.find(s => s.id === 'item-8');
    assertDefined(item8);
    const tables = item8.blocks.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
    const tableTexts = tables.map(t => (t as Table).rows[0].cells[0].text);
    expect(tableTexts).toContain('Revenue');
    expect(tableTexts).toContain('Expenses');
  });
});

describe('error conditions', () => {
  it('E1: empty string input', () => {
    const doc = parseFiling(makeRawFiling(''));
    expect(doc.sections).toHaveLength(0);
  });

  it('E2: non-HTML content', () => {
    const doc = parseFiling(makeRawFiling('This is just plain text, not HTML at all.'));
    expect(doc.sections).toHaveLength(0);

    const docXml = parseFiling(makeRawFiling('<?xml version="1.0"?><data>not html</data>'));
    expect(docXml.sections).toHaveLength(0);
  });

  it('E3: truncated/malformed HTML', () => {
    const htmlTruncated = '<html><body><div><span style="font-weight:700">Item 1. Bus';
    expect(() => parseFiling(makeRawFiling(htmlTruncated))).not.toThrow();
  });

  it('E4: HTML with duplicate html tags', () => {
    const htmlDuplicate = `<html><body><p>First doc</p></body></html>
<html><body><div><span style="font-weight:700">Item 1. Business</span></div></body></html>`;
    expect(() => parseFiling(makeRawFiling(htmlDuplicate))).not.toThrow();
  });
});
