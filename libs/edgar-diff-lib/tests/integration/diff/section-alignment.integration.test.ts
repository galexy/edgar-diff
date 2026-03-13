import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFiling } from '../../../src/parser/parser.js';
import { alignSections } from '../../../src/diff/section-aligner.js';
import { diffFilings } from '../../../src/diff/diff-engine.js';
import { makeRawFiling } from '../../helpers/ground-truth.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

function parseFixture(html: string) {
  const filing = makeRawFiling(html);
  return parseFiling(filing);
}

describe('Integration: Section Alignment with Real Filings', () => {
  describe('Apple 10-K FY2023 vs FY2024', () => {
    const appleFY2023 = parseFixture(loadFixture('10k-aapl-2023.html'));
    const appleFY2024 = parseFixture(loadFixture('10k-aapl-2024.html'));

    it('I-1: all standard items are matched between consecutive filings', () => {
      const result = alignSections(appleFY2023.sections, appleFY2024.sections);

      // Expect 100% alignment for Apple consecutive filings
      expect(result.matched.length).toBeGreaterThan(0);
      expect(result.matched.length).toBeGreaterThanOrEqual(
        Math.min(appleFY2023.sections.length, appleFY2024.sections.length),
      );
    });

    it('I-2: matched pairs have identical item numbers', () => {
      const result = alignSections(appleFY2023.sections, appleFY2024.sections);

      for (const match of result.matched) {
        // Extract item number from id (e.g., "item-1a" -> "1a")
        const oldItemNum = match.oldSection.id.replace('item-', '');
        const newItemNum = match.newSection.id.replace('item-', '');
        expect(oldItemNum).toBe(newItemNum);
      }
    });

    it('I-3: at least 90% match rate', () => {
      const result = alignSections(appleFY2023.sections, appleFY2024.sections);
      const totalSections = Math.max(appleFY2023.sections.length, appleFY2024.sections.length);
      const matchRate = result.matched.length / totalSections;

      expect(matchRate).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('Cross-company: Apple vs Microsoft', () => {
    it('I-4: detects structural differences between companies', () => {
      const aapl = parseFixture(loadFixture('10k-aapl-2024.html'));
      const msft = parseFixture(loadFixture('10k-msft-2024.html'));
      const result = alignSections(aapl.sections, msft.sections);

      // Cross-company should still have many standard items in common
      expect(result.matched.length).toBeGreaterThan(0);

      // But may have added/removed sections due to company-specific items
      // At least some sections should match (standard 10-K items)
      expect(result.matched.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Structural differences (I-5, I-6)', () => {
    const msft2023 = parseFixture(loadFixture('10k-msft-2023.html'));
    const msft2024 = parseFixture(loadFixture('10k-msft-2024.html'));

    it('I-5: filings with different section counts have correct added/removed', () => {
      const result = alignSections(msft2023.sections, msft2024.sections);

      // Every section should be accounted for
      const totalOld = msft2023.sections.length;
      const totalNew = msft2024.sections.length;
      expect(result.matched.length + result.removed.length).toBe(totalOld);
      expect(result.matched.length + result.added.length).toBe(totalNew);
    });

    it('I-6: summary counts are consistent with sectionDiffs array', () => {
      const result = diffFilings(msft2023, msft2024);

      const counts = { added: 0, removed: 0, modified: 0, unchanged: 0, reordered: 0 };
      for (const sd of result.sectionDiffs) {
        counts[sd.changeType]++;
      }

      expect(result.summary).toEqual(counts);
      expect(
        counts.added + counts.removed + counts.modified + counts.unchanged + counts.reordered,
      ).toBe(result.sectionDiffs.length);
    });
  });

  describe('Source mapping validation (I-7, I-8)', () => {
    const appleFY2023Html = loadFixture('10k-aapl-2023.html');
    const appleFY2024Html = loadFixture('10k-aapl-2024.html');
    const appleFY2023 = parseFixture(appleFY2023Html);
    const appleFY2024 = parseFixture(appleFY2024Html);
    const diffResult = diffFilings(appleFY2023, appleFY2024);

    it('I-7: matched sections have valid old and new source mappings', () => {
      for (const sd of diffResult.sectionDiffs) {
        if (['unchanged', 'modified', 'reordered'].includes(sd.changeType)) {
          expect(sd.sourceMapping.old).toBeDefined();
          expect(sd.sourceMapping.new).toBeDefined();
        }
      }
    });

    it('I-8: source offsets are valid ranges within original HTML', () => {
      for (const sd of diffResult.sectionDiffs) {
        if (sd.sourceMapping.old) {
          expect(sd.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
          expect(sd.sourceMapping.old.end).toBeLessThanOrEqual(appleFY2023Html.length);
          expect(sd.sourceMapping.old.start).toBeLessThan(sd.sourceMapping.old.end);
        }
        if (sd.sourceMapping.new) {
          expect(sd.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
          expect(sd.sourceMapping.new.end).toBeLessThanOrEqual(appleFY2024Html.length);
          expect(sd.sourceMapping.new.start).toBeLessThan(sd.sourceMapping.new.end);
        }
      }
    });
  });
});
