# Test Plan: US-1.3 Parse Filing into Structured Sections (vda.4)

## Overview

This test plan validates `parseFiling()` and its internal components (`section-extractor.ts`, heading detection, content block extraction). The parser takes a `RawFiling` with HTML and returns a `StructuredDocument` with sections, content blocks, source mappings, and parse warnings.

Key references:
- Architecture doc section 5 (API types), section 7 (error handling), section 8 (testing approach)
- HTML pattern catalog (`.specs/epic-1-library/html-patterns.md`) -- 5 pattern families (A-E)
- Spike prototype (`spikes/diff-algorithm/section-extractor.ts`)
- Implementation design (`.specs/vda4-parser/implementation-design.md`)

Design notes affecting tests:
- **SourceLocation uses exclusive end**: `{ start, end }` where `html.slice(start, end)` works directly
- **Tables are stubs for v1**: `Table` blocks emitted with `rows: []` and valid `source` (full extraction in US-1.4)
- **No subsections for v1**: all sections are `level: 1` with `subsections: []`
- **Preamble discarded**: content before first Item heading is not captured
- **Non-breaking spaces**: regex must handle `\u00a0` between ITEM and number (WMT pattern)
- **Font-size scoring**: hardcoded 10pt body default for v1 (targets Family C detection)

---

## 1. BDD Acceptance Criteria

### Scenario 1: Happy path -- well-formed 10-K parsed correctly
```gherkin
Given a RawFiling containing well-formed 10-K HTML (AAPL FY2024, Family A)
When parseFiling(raw) is called
Then the result is a StructuredDocument
And result.sections contains at least 15 FilingSection entries
And each section has a non-empty id matching /^item-\d+[a-z]?$/
And each section has a non-empty heading string
And each section has source.start < source.end
And result.filing === raw (same reference)
And result.parseWarnings is an array (possibly empty)
```

### Scenario 2: All 5 pattern families produce correct results
```gherkin
Given one filing from each pattern family:
  | Family | Filing         |
  | A      | AAPL FY2024    |
  | B      | MSFT FY2024    |
  | C      | JPM FY2024     |
  | D      | WMT FY2024     |
  | E      | XOM FY2012     |
When parseFiling(raw) is called for each
Then each produces a StructuredDocument with sections.length > 0
And each filing achieves >= 80% section detection accuracy vs ground truth
```

### Scenario 3: Source offset round-trip
```gherkin
Given a parsed StructuredDocument
When for each section, html.slice(section.source.start, section.source.end) is evaluated
Then the resulting substring contains the section's heading text
And section.source.start >= 0
And section.source.end <= html.length
```

### Scenario 4: Content blocks extracted correctly
```gherkin
Given a parsed StructuredDocument with at least one non-empty section
When inspecting section.blocks
Then each block is either { type: 'paragraph', text, source } or { type: 'table', rows, source }
And paragraph blocks have non-empty text
And paragraph blocks have source.start < source.end
And html.slice(block.source.start, block.source.end) contains the paragraph text (normalized)
```

### Scenario 5: parseWarnings populated for anomalies
```gherkin
Given HTML with a heading that matches the Item regex but cannot be classified
When parseFiling(raw) is called
Then result.parseWarnings contains at least one warning string
And each warning is a human-readable message
```

### Scenario 6: Logger receives warnings
```gherkin
Given a Logger object with a warn() spy
When parseFiling(raw, { logger }) is called on HTML that produces warnings
Then logger.warn was called at least once
And each call received a string argument
```

### Scenario 7: Empty/malformed HTML handled gracefully
```gherkin
Given a RawFiling with html = ""
When parseFiling(raw) is called
Then it returns a StructuredDocument with sections = []
And parseWarnings contains a warning about empty input
And no exception is thrown
```

---

## 2. Unit Tests

All unit tests use inline HTML fixtures (< 30 lines each). Test file: `tests/unit/parser.test.ts`.

### 2.1 extractItemNumber()

```typescript
// U1: Standard mixed-case heading
expect(extractItemNumber('Item 1A. Risk Factors')).toBe('1a');

// U2: Uppercase heading
expect(extractItemNumber('ITEM 7. MANAGEMENT DISCUSSION')).toBe('7');

// U3: Bare item number
expect(extractItemNumber('Item 1')).toBe('1');

// U4: With PART prefix and em-dash
expect(extractItemNumber('PART I \u2014 Item 1. Business')).toBe('1');

// U5: Non-item text returns null
expect(extractItemNumber('The Company reported...')).toBeNull();

// U6: Cross-reference (not anchored to start) returns null
expect(extractItemNumber('See Item 1A for details')).toBeNull();

// U7: Regulation reference (item 601) -- invalid 10-K item
expect(extractItemNumber('Item 601 of Regulation S-K')).toBeNull();

// U8: Item with trailing period only
expect(extractItemNumber('Item 1B.')).toBe('1b');

// U9: Unicode en-dash separator
expect(extractItemNumber('Item 7A \u2013 Market Risk')).toBe('7a');

// U28: Non-breaking space between ITEM and number (WMT pattern)
expect(extractItemNumber('ITEM\u00a01. BUSINESS')).toBe('1');

// U29: Non-breaking space in simple form
expect(extractItemNumber('ITEM\u00a01A.')).toBe('1a');
```

### 2.2 normalizeHeading()

```typescript
// U10: Collapse whitespace and trim
expect(normalizeHeading('  Item  1A.   Risk  Factors  ')).toBe('item 1a. risk factors');

// U11: Strip leading/trailing punctuation
expect(normalizeHeading('---Item 1.---')).toBe('item 1');

// U12: Lowercase
expect(normalizeHeading('ITEM 7A. QUANTITATIVE DISCLOSURES')).toBe('item 7a. quantitative disclosures');
```

### 2.3 Section extraction -- Pattern Family A (Workiva div>span, bold)

```typescript
// U13: Family A -- div>span with font-weight:700
const htmlA = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Apple designs iPhones.</p>
<div><span style="font-weight:700">Item 1A. Risk Factors</span></div>
<p>Risks include competition.</p>
</body></html>`;
// Expect 2 sections: item-1, item-1a
```

### 2.4 Section extraction -- Pattern Family B (DFIN p>span, bold, uppercase)

```typescript
// U14: Family B -- p>span with font-weight:bold, uppercase text
const htmlB = `<html><body>
<p><span style="font-weight:bold;font-size:12pt">ITEM 1. BUSINESS</span></p>
<p>Microsoft develops software.</p>
<p><span style="font-weight:bold;font-size:12pt">ITEM 1A. RISK FACTORS</span></p>
<p>Risks include regulation.</p>
</body></html>`;
// Expect 2 sections: item-1, item-1a
```

### 2.5 Section extraction -- Pattern Family C (non-bold, larger font)

```typescript
// U15: Family C -- div>span with font-weight:400 but larger font-size
const htmlC = `<html><body>
<div><span style="font-size:12pt;font-weight:400">Item 1. Business.</span></div>
<p style="font-size:10pt">JPMorgan provides financial services.</p>
<div><span style="font-size:12pt;font-weight:400">Item 1A. Risk Factors</span></div>
<p style="font-size:10pt">Banking risks exist.</p>
</body></html>`;
// Expect 2 sections: item-1, item-1a
```

### 2.6 Section extraction -- Pattern Family D (table-based)

```typescript
// U16: Family D -- headings in table cells
const htmlD = `<html><body>
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
</body></html>`;
// Expect 2 sections: item-1, item-1a
```

### 2.7 Section extraction -- Pattern Family E (legacy font tag)

```typescript
// U17: Family E -- p>b>font with text-transform:uppercase
const htmlE = `<html><body>
<p><b><font style="font-size:11pt;text-transform:uppercase">ITEM 1. BUSINESS</font></b></p>
<p>ExxonMobil explores for oil.</p>
<p><b><font style="font-size:11pt;text-transform:uppercase">ITEM 1A. RISK FACTORS</font></b></p>
<p>Oil price volatility is a risk.</p>
</body></html>`;
// Expect 2 sections: item-1, item-1a
```

### 2.8 TOC deduplication

```typescript
// U18: Item appears twice (TOC + body) -- should keep body occurrence only
const htmlTOC = `<html><body>
<div><a href="#item1"><span style="font-weight:700">Item 1. Business</span></a></div>
<div><a href="#item1a"><span style="font-weight:700">Item 1A. Risk Factors</span></a></div>
<hr/>
<div id="item1"><span style="font-weight:700">Item 1. Business</span></div>
<p>Actual business content here.</p>
<div id="item1a"><span style="font-weight:700">Item 1A. Risk Factors</span></div>
<p>Actual risk content here.</p>
</body></html>`;
// Expect 2 sections, each with source offset pointing past the TOC
```

### 2.9 Split-element heading handling

```typescript
// U19: Heading split across sibling spans (MSFT pattern)
const htmlSplit = `<html><body>
<p><span style="font-weight:bold">ITEM </span><span style="font-weight:bold">1. BUSINESS</span></p>
<p>Content here.</p>
</body></html>`;
// Expect 1 section: item-1, heading contains "ITEM 1. BUSINESS"

// U20: Heading split across td cells (WMT pattern)
const htmlSplitTd = `<html><body>
<table><tr>
  <td><span style="font-weight:700">ITEM\u00a01.</span></td>
  <td><span style="font-weight:700">BUSINESS</span></td>
</tr></table>
<p>Content here.</p>
</body></html>`;
// Expect 1 section: item-1
```

### 2.10 iXBRL wrapper transparency

```typescript
// U21: Heading wrapped in ix:nonNumeric should still be detected
const htmlIXBRL = `<html><body>
<div><ix:nonNumeric><span style="font-weight:700">Item 1C. Cybersecurity</span></ix:nonNumeric></div>
<p>Cybersecurity program details.</p>
</body></html>`;
// Expect 1 section: item-1c
```

### 2.11 Source offset accuracy

```typescript
// U22: Verify start/end offsets allow round-trip slice
const html = `<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>`;
const doc = parseFiling(makeRawFiling(html));
const section = doc.sections[0];
const slice = html.slice(section.source.start, section.source.end);
expect(slice).toContain('Item 1. Business');
expect(section.source.start).toBeGreaterThanOrEqual(0);
expect(section.source.end).toBeLessThanOrEqual(html.length);
```

### 2.12 Paragraph extraction from section HTML

```typescript
// U23: Paragraphs extracted with text and source mappings
const html = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>First paragraph of business section.</p>
<p>Second paragraph with more details.</p>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
expect(doc.sections[0].blocks).toHaveLength(2);
expect(doc.sections[0].blocks[0]).toMatchObject({
  type: 'paragraph',
  text: expect.stringContaining('First paragraph'),
});
expect(doc.sections[0].blocks[0].source.start).toBeLessThan(doc.sections[0].blocks[0].source.end);
```

### 2.13 Empty sections / sections with only tables

```typescript
// U24: Section with no content between headings
const htmlEmpty = `<html><body>
<div><span style="font-weight:700">Item 4. Mine Safety Disclosures</span></div>
<div><span style="font-weight:700">Item 5. Market Info</span></div>
</body></html>`;
const doc = parseFiling(makeRawFiling(htmlEmpty));
const item4 = doc.sections.find(s => s.id === 'item-4');
expect(item4).toBeDefined();
expect(item4!.blocks).toHaveLength(0);

// U25: Section with only a table (no paragraphs) -- table emitted as stub
const htmlTable = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Revenue</td><td>$100B</td></tr></table>
<div><span style="font-weight:700">Item 9. Changes</span></div>
</body></html>`;
const doc2 = parseFiling(makeRawFiling(htmlTable));
const item8 = doc2.sections.find(s => s.id === 'item-8');
expect(item8).toBeDefined();
expect(item8!.blocks).toHaveLength(1);
expect(item8!.blocks[0]).toMatchObject({ type: 'table', rows: [] });
expect(item8!.blocks[0].source.start).toBeLessThan(item8!.blocks[0].source.end);
// Table stub round-trip: slice should contain <table> content
const tableSlice = html.slice(item8!.blocks[0].source.start, item8!.blocks[0].source.end);
expect(tableSlice).toContain('<table');
```

### 2.14 Subsections always empty for v1

```typescript
// U30: All sections have level=1 and empty subsections array
const html = `<html><body>
<div><span style="font-weight:700">Item 1. Business</span></div>
<p>Content.</p>
<h3>Overview</h3>
<p>Sub-content that is NOT detected as a subsection.</p>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
expect(doc.sections[0].level).toBe(1);
expect(doc.sections[0].subsections).toEqual([]);
```

### 2.15 Preamble content before first heading is discarded

```typescript
// U31: Content before first Item heading is not captured as a section
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
// No preamble section exists
```

### 2.16 parseFiling() orchestrator

```typescript
// U26: Minimal HTML -- orchestrator returns valid StructuredDocument shape
const html = `<html><body><h2>Item 1. Business</h2><p>Content.</p></body></html>`;
const raw: RawFiling = { /* minimal valid RawFiling with html */ };
const doc = parseFiling(raw);
expect(doc.filing).toBe(raw);
expect(doc.sections).toBeInstanceOf(Array);
expect(doc.parseWarnings).toBeInstanceOf(Array);

// U27: With includeSourceHtml option
const doc2 = parseFiling(raw, { includeSourceHtml: true });
expect(doc2.sections[0].sourceHtml).toBeDefined();
expect(doc2.sections[0].sourceHtml).toContain('Item 1');
```

---

## 3. Integration Tests

Test file: `tests/integration/parser.integration.test.ts`. Uses real filing fixtures from `tests/integration/fixtures/`.

### 3.1 Per-filing section detection accuracy

```typescript
describe('parser accuracy per filing', () => {
  const fixtures = loadAllFixtureMeta(); // reads meta-10k-*.json files

  for (const meta of fixtures) {
    it(`detects >= 80% of items in ${meta.ticker} ${meta.year}`, () => {
      const html = readFixture(`10k-${meta.ticker.toLowerCase()}-${meta.year}.html`);
      const raw = makeRawFiling(html);
      const doc = parseFiling(raw);

      const expectedIds = meta.expectedItems
        .filter(e => e.id.startsWith('item-') && e.id !== 'unknown')
        .map(e => e.id);
      const detectedIds = doc.sections.map(s => s.id);

      const hits = expectedIds.filter(id => detectedIds.includes(id));
      const accuracy = hits.length / expectedIds.length;

      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  }
});
```

### 3.2 Aggregate accuracy across all fixtures

```typescript
it('achieves >= 80% aggregate accuracy across all fixtures', () => {
  let totalExpected = 0;
  let totalDetected = 0;

  for (const meta of loadAllFixtureMeta()) {
    const html = readFixture(`10k-${meta.ticker.toLowerCase()}-${meta.year}.html`);
    const doc = parseFiling(makeRawFiling(html));

    const expectedIds = meta.expectedItems
      .filter(e => e.id.startsWith('item-') && e.id !== 'unknown')
      .map(e => e.id);
    const detectedIds = doc.sections.map(s => s.id);

    totalExpected += expectedIds.length;
    totalDetected += expectedIds.filter(id => detectedIds.includes(id)).length;
  }

  expect(totalDetected / totalExpected).toBeGreaterThanOrEqual(0.80);
});
```

### 3.3 Cross-filing consistency

```typescript
describe('cross-filing consistency', () => {
  it('MSFT FY2023 and FY2024 detect same core items', () => {
    const doc2023 = parseFiling(makeRawFiling(readFixture('10k-msft-2023.html')));
    const doc2024 = parseFiling(makeRawFiling(readFixture('10k-msft-2024.html')));

    const ids2023 = new Set(doc2023.sections.map(s => s.id));
    const ids2024 = new Set(doc2024.sections.map(s => s.id));

    // Core items present in both years
    for (const coreId of ['item-1', 'item-1a', 'item-7', 'item-8']) {
      expect(ids2023.has(coreId)).toBe(true);
      expect(ids2024.has(coreId)).toBe(true);
    }
  });

  it('JPM FY2023 and FY2024 detect same core items', () => {
    const doc2023 = parseFiling(makeRawFiling(readFixture('10k-jpm-2023.html')));
    const doc2024 = parseFiling(makeRawFiling(readFixture('10k-jpm-2024.html')));

    const ids2023 = new Set(doc2023.sections.map(s => s.id));
    const ids2024 = new Set(doc2024.sections.map(s => s.id));

    for (const coreId of ['item-1', 'item-1a', 'item-7']) {
      expect(ids2023.has(coreId)).toBe(true);
      expect(ids2024.has(coreId)).toBe(true);
    }
  });
});
```

### 3.4 Source offset round-trip on real filings

```typescript
describe('source offset round-trip', () => {
  const fixtures = loadAllFixtureMeta();

  for (const meta of fixtures) {
    it(`round-trips offsets for ${meta.ticker} ${meta.year}`, () => {
      const html = readFixture(`10k-${meta.ticker.toLowerCase()}-${meta.year}.html`);
      const doc = parseFiling(makeRawFiling(html));

      for (const section of doc.sections) {
        expect(section.source.start).toBeGreaterThanOrEqual(0);
        expect(section.source.end).toBeLessThanOrEqual(html.length);
        expect(section.source.start).toBeLessThan(section.source.end);

        const slice = html.slice(section.source.start, section.source.end);
        // The slice should contain the heading text (possibly with HTML tags)
        const headingWords = section.heading.split(/\s+/).slice(0, 3).join('.*');
        expect(slice).toMatch(new RegExp(headingWords, 'i'));
      }
    });
  }
});
```

### 3.5 Section ordering correctness

```typescript
it('sections are ordered by source offset (document order)', () => {
  for (const meta of loadAllFixtureMeta()) {
    const html = readFixture(`10k-${meta.ticker.toLowerCase()}-${meta.year}.html`);
    const doc = parseFiling(makeRawFiling(html));

    for (let i = 1; i < doc.sections.length; i++) {
      expect(doc.sections[i].source.start).toBeGreaterThan(
        doc.sections[i - 1].source.start
      );
    }
  }
});
```

### 3.6 Pattern family coverage

```typescript
describe('pattern family coverage', () => {
  const familyRepresentatives: Record<string, string> = {
    'A': '10k-aapl-2024.html',   // Workiva div>span bold
    'B': '10k-msft-2024.html',   // DFIN p>span bold uppercase
    'C': '10k-jpm-2024.html',    // Non-bold larger font
    'D': '10k-wmt-2024.html',    // Table-based
    'E': '10k-xom-2012.html',    // Legacy font tag
  };

  for (const [family, fixture] of Object.entries(familyRepresentatives)) {
    it(`Family ${family} (${fixture}) produces sections`, () => {
      const html = readFixture(fixture);
      const doc = parseFiling(makeRawFiling(html));
      expect(doc.sections.length).toBeGreaterThan(0);
    });
  }
});
```

---

## 4. E2E Tests

Test file: `tests/integration/parser-e2e.test.ts`.

### E2E-1: Full pipeline -- load fixture, parse, verify against ground truth

```typescript
describe('E2E: fixture -> parse -> ground truth', () => {
  for (const meta of loadAllFixtureMeta()) {
    it(`${meta.ticker} ${meta.year}: sections match ground truth`, () => {
      const html = readFixture(`10k-${meta.ticker.toLowerCase()}-${meta.year}.html`);
      const raw = makeRawFiling(html);
      const doc = parseFiling(raw);

      // Verify structure
      expect(doc.filing).toBe(raw);
      expect(doc.sections).toBeInstanceOf(Array);
      expect(doc.parseWarnings).toBeInstanceOf(Array);

      // Verify against ground truth
      const expectedIds = meta.expectedItems
        .filter(e => e.id.startsWith('item-') && e.id !== 'unknown')
        .map(e => e.id);
      const detectedIds = doc.sections.map(s => s.id);

      const hits = expectedIds.filter(id => detectedIds.includes(id));
      expect(hits.length / expectedIds.length).toBeGreaterThanOrEqual(0.80);

      // Verify all sections have valid content blocks
      for (const section of doc.sections) {
        for (const block of section.blocks) {
          expect(['paragraph', 'table']).toContain(block.type);
          if (block.type === 'paragraph') {
            expect(block.text.length).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});
```

### E2E-2: Performance -- parse time < 500ms for largest filing

```typescript
it('parses the largest fixture within 500ms', () => {
  // JPM and BAC are ~12MB; MSFT is ~7.8MB
  const html = readFixture('10k-jpm-2024.html');
  const raw = makeRawFiling(html);

  const start = performance.now();
  parseFiling(raw);
  const elapsed = performance.now() - start;

  expect(elapsed).toBeLessThan(500);
});
```

---

## 5. Boundary Conditions

### B1: Zero, one, many sections

```typescript
// B1a: Zero sections -- HTML with no Item headings
const htmlNoItems = '<html><body><p>Just a paragraph with no items.</p></body></html>';
const doc = parseFiling(makeRawFiling(htmlNoItems));
expect(doc.sections).toHaveLength(0);

// B1b: One section
const htmlOneItem = '<html><body><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></body></html>';
const doc1 = parseFiling(makeRawFiling(htmlOneItem));
expect(doc1.sections).toHaveLength(1);

// B1c: Many sections (all standard 10-K items -- 16+)
// Covered by integration tests with real fixtures
```

### B2: Empty HTML input

```typescript
const doc = parseFiling(makeRawFiling(''));
expect(doc.sections).toHaveLength(0);
expect(doc.parseWarnings.length).toBeGreaterThan(0);
```

### B3: Very large filings

```typescript
// Integration test: JPM FY2024 is ~12.3MB, BAC is ~12.3MB
// Covered by E2E-2 performance test
```

### B4: Legacy font-tag filings

```typescript
// XOM FY2012 -- 8.7MB, uses <p><b><font> pattern
// Covered by integration test for Family E and pattern family coverage
```

### B5: Deeply nested headings

```typescript
const htmlDeep = `<html><body>
<div><div><div><p><b><span>Item 1. Business</span></b></p></div></div></div>
<p>Content under deeply nested heading.</p>
</body></html>`;
const doc = parseFiling(makeRawFiling(htmlDeep));
expect(doc.sections).toHaveLength(1);
expect(doc.sections[0].id).toBe('item-1');
```

### B6: Headings inside table cells

```typescript
// Covered by U16 (Family D unit test) and WMT/XOM integration tests
```

### B7: Split-element headings

```typescript
// Covered by U19, U20 (unit tests) and MSFT/WMT integration tests
```

### B8: Unicode dashes in headings

```typescript
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
```

### B9: Filings with missing body tag

```typescript
const htmlNoBody = `<html><div><span style="font-weight:700">Item 1. Business</span></div><p>Content.</p></html>`;
const doc = parseFiling(makeRawFiling(htmlNoBody));
// htmlparser2 is tolerant -- should still find the heading
expect(doc.sections.length).toBeGreaterThanOrEqual(1);
```

---

## 6. Error Conditions

### E1: Empty string input

```typescript
const doc = parseFiling(makeRawFiling(''));
expect(doc.sections).toHaveLength(0);
// No exception thrown
```

### E2: Non-HTML content

```typescript
const doc = parseFiling(makeRawFiling('This is just plain text, not HTML at all.'));
expect(doc.sections).toHaveLength(0);
// No exception -- parser treats as text node, finds no headings

const docXml = parseFiling(makeRawFiling('<?xml version="1.0"?><data>not html</data>'));
expect(docXml.sections).toHaveLength(0);
```

### E3: Truncated/malformed HTML

```typescript
const htmlTruncated = '<html><body><div><span style="font-weight:700">Item 1. Bus';
const doc = parseFiling(makeRawFiling(htmlTruncated));
// htmlparser2 handles truncated HTML gracefully
// May or may not detect the heading depending on truncation point
expect(() => parseFiling(makeRawFiling(htmlTruncated))).not.toThrow();
```

### E4: HTML with duplicate html tags

```typescript
const htmlDuplicate = `<html><body><p>First doc</p></body></html>
<html><body><div><span style="font-weight:700">Item 1. Business</span></div></body></html>`;
const doc = parseFiling(makeRawFiling(htmlDuplicate));
// Should not crash; may detect the heading in the second "document"
expect(() => parseFiling(makeRawFiling(htmlDuplicate))).not.toThrow();
```

---

## 7. Test Data

### 7.1 Inline HTML fixtures (unit tests)

Each pattern family has a dedicated inline fixture (U13-U17) with 2 sections and minimal content. Additional inline fixtures cover:
- TOC deduplication (U18)
- Split-element headings (U19, U20)
- iXBRL wrappers (U21)
- Source offset verification (U22)
- Paragraph extraction (U23)
- Empty sections (U24)
- Edge cases (B1-B9, E1-E4)

### 7.2 Real filing fixtures (integration tests)

Available in `tests/integration/fixtures/`:

| Fixture | Size | Family | Has Meta |
|---------|------|--------|----------|
| 10k-aapl-2024.html | 1.4 MB | A | Yes |
| 10k-amzn-2024.html | 1.8 MB | A | Yes |
| 10k-bac-2024.html | 12.3 MB | A | Yes |
| 10k-cvx-2024.html | 5.7 MB | A | Yes |
| 10k-msft-2023.html | 6.5 MB | B | Yes |
| 10k-msft-2024.html | 7.8 MB | B | Yes |
| 10k-brk-b-2024.html | 10.2 MB | B | Yes |
| 10k-jpm-2023.html | 12.6 MB | C | Yes |
| 10k-jpm-2024.html | 12.3 MB | C | Yes |
| 10k-jnj-2024.html | 3.5 MB | C | Yes |
| 10k-pg-2024.html | 2.4 MB | C | Yes |
| 10k-wmt-2024.html | 2.2 MB | D | Yes |
| 10k-xom-2024.html | 5.7 MB | D | Yes |
| 10k-unh-2024.html | 2.7 MB | D | Yes |
| 10k-xom-2012.html | 8.7 MB | E | Yes |

Cross-year pairs: MSFT (2023/2024), JPM (2023/2024).

### 7.3 Meta JSON ground truth

Each fixture has a companion `meta-10k-{ticker}-{year}.json` with `expectedItems[]`. Note: the draft ground truth files contain some false positives (cross-references, regulation items) -- these have `id: "unknown"` or non-standard IDs like `item-601`, `item-408` and should be filtered out when computing accuracy (only count `item-N` where N is a valid 10-K item number).

### 7.4 Test utility: makeRawFiling()

```typescript
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
```

---

## 8. Accuracy Measurement Protocol

Follows the same protocol as vda.13 test plan:

```
accuracy = (correctly detected items) / (total valid items in ground truth)
```

Where "valid items" are those with `id` matching `/^item-\d+[a-z]?$/` and the number is in `KNOWN_ITEMS` (1, 1a, 1b, 1c, 2, 3, 4, 5, 6, 7, 7a, 8, 9, 9a, 9b, 9c, 10-16). This filters out `unknown`, `item-601`, `item-408`, and other false positives in the draft ground truth.

A "correctly detected" item means:
1. The parser returns a section with matching `id`
2. The section's `source` offset points to the body (not TOC)

### Thresholds
- Per-filing: >= 80%
- Aggregate: >= 80%
- No filing below 60% (would indicate a pattern family gap)

---

## 9. Test File Organization

```
tests/
  unit/
    parser.test.ts              # U1-U27, B1-B9, E1-E4
  integration/
    parser.integration.test.ts  # I1-I6 (accuracy, cross-filing, round-trip)
    parser-e2e.test.ts          # E2E-1, E2E-2 (full pipeline, performance)
    fixtures/
      10k-*.html                # Real filing HTML (already committed)
      meta-10k-*.json           # Ground truth (already committed)
```
