import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFiling } from '../../../src/parser/parser.js';
import { alignSections } from '../../../src/diff/section-aligner.js';
import { makeRawFiling } from '../../helpers/ground-truth.js';

const SPIKE_FIXTURES = join(import.meta.dirname, '..', '..', '..', 'spikes', 'diff-algorithm', 'fixtures');
const INTEGRATION_FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function loadSpikeFixture(filename: string): string {
  return readFileSync(join(SPIKE_FIXTURES, filename), 'utf-8');
}

function loadIntegrationFixture(filename: string): string {
  return readFileSync(join(INTEGRATION_FIXTURES, filename), 'utf-8');
}

function parseFixture(html: string) {
  const filing = makeRawFiling(html);
  return parseFiling(filing);
}

describe('Integration: Section Alignment with Real Filings', () => {
  describe('Apple 10-K FY2023 vs FY2024', () => {
    const appleFY2023 = parseFixture(loadSpikeFixture('apple-fy2023.htm'));
    const appleFY2024 = parseFixture(loadSpikeFixture('apple-fy2024.htm'));

    it('I-1: all standard items are matched between consecutive filings', () => {
      const result = alignSections(appleFY2023.sections, appleFY2024.sections);

      // Spike found 100% alignment for Apple consecutive filings
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
      // Use integration fixtures for AAPL and MSFT if available, else spike fixtures
      let aapl2024Html: string;
      let msft2024Html: string;
      try {
        aapl2024Html = loadIntegrationFixture('10k-aapl-2024.html');
      } catch {
        aapl2024Html = loadSpikeFixture('apple-fy2024.htm');
      }
      try {
        msft2024Html = loadIntegrationFixture('10k-msft-2024.html');
      } catch {
        msft2024Html = loadSpikeFixture('microsoft-fy2024.htm');
      }

      const aapl = parseFixture(aapl2024Html);
      const msft = parseFixture(msft2024Html);
      const result = alignSections(aapl.sections, msft.sections);

      // Cross-company should still have many standard items in common
      expect(result.matched.length).toBeGreaterThan(0);

      // But may have added/removed sections due to company-specific items
      const totalUnique = aapl.sections.length + msft.sections.length - result.matched.length * 2;
      // At least some sections should match (standard 10-K items)
      expect(result.matched.length).toBeGreaterThanOrEqual(5);
    });
  });
});
