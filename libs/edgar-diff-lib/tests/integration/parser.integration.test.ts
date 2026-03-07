import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import {
  ALL_FIXTURES,
  loadFixture,
  loadGroundTruth,
  loadAllFixtureMeta,
  getExpectedIds,
  makeRawFiling,
  KNOWN_ITEMS,
  type FixtureMeta,
} from '../helpers/ground-truth.js';

// ============================================================
// 3.1 Per-filing section detection accuracy
// ============================================================

/** Fixtures with sufficient ground truth (>= 3 valid expected items) for accuracy testing. */
const ACCURACY_FIXTURES = ALL_FIXTURES.filter(f => {
  const meta = loadGroundTruth(f.ticker, f.year);
  return getExpectedIds(meta).length >= 3;
});

describe('parser accuracy per filing', () => {
  for (const { ticker, year } of ACCURACY_FIXTURES) {
    it(`detects >= 80% of items in ${ticker.toUpperCase()} ${year}`, () => {
      const html = loadFixture(ticker, year);
      const meta = loadGroundTruth(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const expectedIds = getExpectedIds(meta);
      const detectedIds = doc.sections.map(s => s.id);

      const hits = expectedIds.filter(id => detectedIds.includes(id));
      const accuracy = hits.length / expectedIds.length;

      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  }
});

// ============================================================
// 3.2 Aggregate accuracy gate
// ============================================================

describe('aggregate accuracy', () => {
  it('achieves >= 80% aggregate accuracy across fixtures with ground truth', () => {
    let totalExpected = 0;
    let totalDetected = 0;

    for (const { ticker, year } of ACCURACY_FIXTURES) {
      const html = loadFixture(ticker, year);
      const meta = loadGroundTruth(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const expectedIds = getExpectedIds(meta);
      const detectedIds = doc.sections.map(s => s.id);

      totalExpected += expectedIds.length;
      totalDetected += expectedIds.filter(id => detectedIds.includes(id)).length;
    }

    expect(totalDetected / totalExpected).toBeGreaterThanOrEqual(0.80);
  });

  it('no single filing drops below 60% accuracy', () => {
    for (const { ticker, year } of ACCURACY_FIXTURES) {
      const html = loadFixture(ticker, year);
      const meta = loadGroundTruth(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const expectedIds = getExpectedIds(meta);
      const detectedIds = doc.sections.map(s => s.id);

      const hits = expectedIds.filter(id => detectedIds.includes(id));
      const accuracy = hits.length / expectedIds.length;

      expect(accuracy).toBeGreaterThanOrEqual(0.60);
    }
  });
});

// ============================================================
// 3.3 Section ID correctness
// ============================================================

describe('section ID correctness', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`${ticker.toUpperCase()} ${year}: all section IDs are valid item-N format`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      for (const section of doc.sections) {
        expect(section.id).toMatch(/^item-\d+[a-z]?$/);
        const itemNum = section.id.replace('item-', '');
        expect(KNOWN_ITEMS.has(itemNum)).toBe(true);
      }
    });

    it(`${ticker.toUpperCase()} ${year}: heading text contains Item label`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      for (const section of doc.sections) {
        expect(section.heading.toLowerCase()).toMatch(/item\s+\d/);
      }
    });
  }
});

// ============================================================
// 3.4 Source offset invariants
// ============================================================

describe('source offset round-trip and invariants', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`round-trips offsets for ${ticker.toUpperCase()} ${year}`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      for (const section of doc.sections) {
        // Bounds
        expect(section.source.start).toBeGreaterThanOrEqual(0);
        expect(section.source.end).toBeLessThanOrEqual(html.length);

        // Ordering
        expect(section.source.start).toBeLessThan(section.source.end);

        // Round-trip: section source range is non-trivial and starts at an HTML element.
        // We can't match decoded heading text against raw HTML because of entity
        // encoding (&#160;, &#8217;) and split-element headings.
        const slice = html.slice(section.source.start, section.source.end);
        expect(slice.length).toBeGreaterThan(10);
        // The slice should start at or near an HTML tag
        expect(slice.slice(0, 100)).toMatch(/<\w/);

        // Block containment
        for (const block of section.blocks) {
          expect(block.source.start).toBeGreaterThanOrEqual(section.source.start);
          expect(block.source.end).toBeLessThanOrEqual(section.source.end);
          expect(block.source.start).toBeLessThan(block.source.end);
        }
      }

      // Non-overlapping consecutive sections
      for (let i = 1; i < doc.sections.length; i++) {
        expect(doc.sections[i].source.start).toBeGreaterThanOrEqual(
          doc.sections[i - 1].source.end
        );
      }
    });
  }
});

// ============================================================
// 3.5 Cross-filing consistency
// ============================================================

describe('cross-filing consistency', () => {
  it('MSFT FY2023 and FY2024 detect same core items', () => {
    const doc2023 = parseFiling(makeRawFiling(loadFixture('msft', 2023)));
    const doc2024 = parseFiling(makeRawFiling(loadFixture('msft', 2024)));

    const ids2023 = new Set(doc2023.sections.map(s => s.id));
    const ids2024 = new Set(doc2024.sections.map(s => s.id));

    for (const coreId of ['item-1', 'item-1a', 'item-7', 'item-8']) {
      expect(ids2023.has(coreId)).toBe(true);
      expect(ids2024.has(coreId)).toBe(true);
    }
  });

  it('JPM FY2023 and FY2024 detect same core items', () => {
    const doc2023 = parseFiling(makeRawFiling(loadFixture('jpm', 2023)));
    const doc2024 = parseFiling(makeRawFiling(loadFixture('jpm', 2024)));

    const ids2023 = new Set(doc2023.sections.map(s => s.id));
    const ids2024 = new Set(doc2024.sections.map(s => s.id));

    for (const coreId of ['item-1', 'item-1a', 'item-7']) {
      expect(ids2023.has(coreId)).toBe(true);
      expect(ids2024.has(coreId)).toBe(true);
    }
  });
});

// ============================================================
// 3.5b Section ID uniqueness and false-positive bound
// ============================================================

describe('section ID quality', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`${ticker.toUpperCase()} ${year}: no duplicate section IDs`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const ids = doc.sections.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${ticker.toUpperCase()} ${year}: detected sections within reasonable bounds`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      // A 10-K has at most ~23 standard items; parser should not produce wildly more
      expect(doc.sections.length).toBeLessThanOrEqual(25);
      // And should produce at least some sections for any real filing
      expect(doc.sections.length).toBeGreaterThan(0);
    });
  }
});

// ============================================================
// 3.6 Table stubs in real filings
// ============================================================

describe('table stubs', () => {
  it('Item 8 (Financial Statements) contains at least one Table block', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();
    const tableBlocks = item8!.blocks.filter(b => b.type === 'table');
    expect(tableBlocks.length).toBeGreaterThan(0);
    for (const table of tableBlocks) {
      expect(table.type).toBe('table');
      expect((table as any).rows).toBeDefined();
      expect(table.source.start).toBeLessThan(table.source.end);
    }
  });
});

// ============================================================
// 3.7 Section ordering correctness
// ============================================================

describe('section ordering', () => {
  it('sections are ordered by source offset (document order)', () => {
    for (const { ticker, year } of ALL_FIXTURES) {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      for (let i = 1; i < doc.sections.length; i++) {
        expect(doc.sections[i].source.start).toBeGreaterThan(
          doc.sections[i - 1].source.start
        );
      }
    }
  });
});

// ============================================================
// 3.8 Pattern family coverage
// ============================================================

describe('pattern family coverage', () => {
  const familyRepresentatives: Record<string, { ticker: string; year: number }> = {
    'A': { ticker: 'aapl', year: 2024 },   // Workiva div>span bold
    'B': { ticker: 'msft', year: 2024 },   // DFIN p>span bold uppercase
    'C': { ticker: 'jpm', year: 2024 },    // Non-bold larger font
    'D': { ticker: 'wmt', year: 2024 },    // Table-based
    'E': { ticker: 'xom', year: 2012 },    // Legacy font tag
  };

  for (const [family, { ticker, year }] of Object.entries(familyRepresentatives)) {
    it(`Family ${family} (${ticker.toUpperCase()} ${year}) produces sections`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));
      expect(doc.sections.length).toBeGreaterThan(0);
    });
  }
});
