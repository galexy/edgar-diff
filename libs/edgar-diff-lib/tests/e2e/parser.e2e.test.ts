import { describe, it, expect } from 'vitest';
import { parseFiling } from '../../src/parser/index.js';
import {
  ALL_FIXTURES,
  loadFixture,
  loadGroundTruth,
  getExpectedIds,
  makeRawFiling,
} from '../helpers/ground-truth.js';

// ============================================================
// E2E-1: Full pipeline -- fixture -> parse -> ground truth
// ============================================================

describe('E2E: fixture -> parse -> ground truth', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`${ticker.toUpperCase()} ${year}: sections match ground truth`, () => {
      const html = loadFixture(ticker, year);
      const raw = makeRawFiling(html);
      const doc = parseFiling(raw);

      // Verify structure
      expect(doc.filing).toBe(raw);
      expect(doc.sections).toBeInstanceOf(Array);
      expect(doc.parseWarnings).toBeInstanceOf(Array);

      // Verify against ground truth (when sufficient data available)
      const meta = loadGroundTruth(ticker, year);
      const expectedIds = getExpectedIds(meta);
      const detectedIds = doc.sections.map(s => s.id);

      if (expectedIds.length >= 3) {
        const hits = expectedIds.filter(id => detectedIds.includes(id));
        expect(hits.length / expectedIds.length).toBeGreaterThanOrEqual(0.80);
      }
      // All filings should produce some sections regardless of ground truth quality
      expect(doc.sections.length).toBeGreaterThan(0);

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

// ============================================================
// E2E-2: Performance -- parse time
// ============================================================

describe('E2E: performance', () => {
  it('parses the largest fixture within 2000ms', () => {
    // JPM FY2024 is ~12.3MB
    const html = loadFixture('jpm', 2024);
    const raw = makeRawFiling(html);

    const start = performance.now();
    parseFiling(raw);
    const elapsed = performance.now() - start;

    // Use 2000ms threshold to account for CI variability
    expect(elapsed).toBeLessThan(2000);
  });

  it('parse time scales linearly (not quadratically) with file size', () => {
    const smallHtml = loadFixture('aapl', 2024);  // ~1.4MB
    const largeHtml = loadFixture('jpm', 2024);   // ~12.3MB

    const startSmall = performance.now();
    parseFiling(makeRawFiling(smallHtml));
    const smallTime = performance.now() - startSmall;

    const startLarge = performance.now();
    parseFiling(makeRawFiling(largeHtml));
    const largeTime = performance.now() - startLarge;

    const sizeRatio = largeHtml.length / smallHtml.length;
    const timeRatio = largeTime / Math.max(smallTime, 1); // avoid div by zero
    // Allow up to 3x the size ratio for overhead, but not quadratic
    expect(timeRatio).toBeLessThan(sizeRatio * 3);
  });
});
