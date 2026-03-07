/**
 * Tests for the diff algorithm spike.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections, normalizeHeading, type Section } from '../section-extractor.js';
import { assertDefined } from '../../../tests/helpers/assert-defined.js';
import {
  alignSections,
  jaroWinklerSimilarity,
  experimentThresholds,
} from '../section-aligner.js';
import { diffParagraphs } from '../paragraph-differ.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}. Run fetch-filings.ts first.`);
  }
  return readFileSync(path, 'utf-8');
}

// ── Jaro-Winkler Similarity ──────────────────────────────────────────

describe('Jaro-Winkler similarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinklerSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns high similarity for close matches', () => {
    const sim = jaroWinklerSimilarity(
      'risk factors',
      'risk factor',
    );
    expect(sim).toBeGreaterThan(0.9);
  });

  it('returns low similarity for unrelated strings', () => {
    const sim = jaroWinklerSimilarity(
      'risk factors',
      'financial statements',
    );
    expect(sim).toBeLessThan(0.6);
  });

  it('handles empty strings', () => {
    // jaro-winkler library returns 0 for empty strings
    expect(jaroWinklerSimilarity('', '')).toBe(0);
    expect(jaroWinklerSimilarity('hello', '')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'properties';
    const b = 'property';
    expect(jaroWinklerSimilarity(a, b)).toBeCloseTo(jaroWinklerSimilarity(b, a), 5);
  });
});

// ── Heading Normalization ────────────────────────────────────────────

describe('normalizeHeading', () => {
  it('lowercases and trims', () => {
    expect(normalizeHeading('  Item 1A. Risk Factors  ')).toBe('item 1a. risk factors');
  });

  it('collapses whitespace', () => {
    expect(normalizeHeading('Item   7A.   Quantitative')).toBe('item 7a. quantitative');
  });

  it('strips leading/trailing punctuation', () => {
    expect(normalizeHeading('--Item 1--')).toBe('item 1');
  });
});

// ── Section Extraction ───────────────────────────────────────────────

describe('section extraction', () => {
  let appleSections: Section[];

  beforeAll(() => {
    const html = loadFixture('apple-fy2024.htm');
    appleSections = extractSections(html);
  });

  it('finds multiple sections in Apple 10-K', () => {
    expect(appleSections.length).toBeGreaterThanOrEqual(10);
  });

  it('finds Item 1 (Business)', () => {
    const item1 = appleSections.find((s) => /item\s+1\b/i.test(s.heading) && !/item\s+1[a-z]/i.test(s.heading));
    assertDefined(item1);
    expect(item1.paragraphs.length).toBeGreaterThan(0);
  });

  it('finds Item 1A (Risk Factors)', () => {
    const item1a = appleSections.find((s) => /item\s+1a/i.test(s.heading));
    assertDefined(item1a);
    expect(item1a.paragraphs.length).toBeGreaterThan(5); // Risk factors has many paragraphs
  });

  it('finds Item 7 (MD&A)', () => {
    const item7 = appleSections.find((s) => /item\s+7\b/i.test(s.heading) && !/item\s+7a/i.test(s.heading));
    expect(item7).toBeDefined();
  });

  it('finds Item 8 (Financial Statements)', () => {
    const item8 = appleSections.find((s) => /item\s+8\b/i.test(s.heading));
    expect(item8).toBeDefined();
  });

  it('sections have valid start/end indices', () => {
    for (const s of appleSections) {
      expect(s.startIndex).toBeGreaterThanOrEqual(0);
      expect(s.endIndex).toBeGreaterThan(s.startIndex);
    }
  });

  it('sections are in document order', () => {
    for (let i = 1; i < appleSections.length; i++) {
      expect(appleSections[i].startIndex).toBeGreaterThan(appleSections[i - 1].startIndex);
    }
  });
});

// ── Section Alignment ────────────────────────────────────────────────

describe('section alignment', () => {
  let appleFy23Sections: Section[];
  let appleFy24Sections: Section[];

  beforeAll(() => {
    appleFy23Sections = extractSections(loadFixture('apple-fy2023.htm'));
    appleFy24Sections = extractSections(loadFixture('apple-fy2024.htm'));
  });

  it('matches all standard items between consecutive Apple filings', () => {
    const alignment = alignSections(appleFy23Sections, appleFy24Sections, 0.75);

    // At minimum, the standard items present in both should match
    const matchedItems = alignment.matched.map((m) => {
      const oldItem = m.oldSection.heading.match(/item\s+(\d+[a-z]?)/i);
      const newItem = m.newSection.heading.match(/item\s+(\d+[a-z]?)/i);
      return { old: oldItem?.[1]?.toLowerCase(), new: newItem?.[1]?.toLowerCase() };
    });

    // Each matched pair should have the same item number
    for (const pair of matchedItems) {
      expect(pair.old).toBe(pair.new);
    }
  });

  it('achieves at least 90% match rate', () => {
    const alignment = alignSections(appleFy23Sections, appleFy24Sections, 0.75);
    const maxPossible = Math.min(appleFy23Sections.length, appleFy24Sections.length);
    const matchRate = alignment.matched.length / maxPossible;
    expect(matchRate).toBeGreaterThanOrEqual(0.9);
  });

  it('all matched pairs have similarity >= threshold', () => {
    const threshold = 0.75;
    const alignment = alignSections(appleFy23Sections, appleFy24Sections, threshold);
    for (const m of alignment.matched) {
      expect(m.similarity).toBeGreaterThanOrEqual(threshold);
    }
  });

  it('threshold experiment returns results for all thresholds', () => {
    const results = experimentThresholds(appleFy23Sections, appleFy24Sections);
    expect(results).toHaveLength(6); // default 6 thresholds
    // Lower threshold should match >= higher threshold
    expect(results[0].matched).toBeGreaterThanOrEqual(results[results.length - 1].matched);
  });
});

// ── Paragraph Diff ───────────────────────────────────────────────────

describe('paragraph diff', () => {
  let alignment: ReturnType<typeof alignSections>;

  beforeAll(() => {
    const oldSections = extractSections(loadFixture('apple-fy2023.htm'));
    const newSections = extractSections(loadFixture('apple-fy2024.htm'));
    alignment = alignSections(oldSections, newSections, 0.75);
  });

  it('produces diffs for all matched sections', () => {
    const result = diffParagraphs(alignment.matched, 'patience');
    expect(result.sectionDiffs.length).toBe(alignment.matched.length);
  });

  it('detects at least some changes between FY2023 and FY2024', () => {
    const result = diffParagraphs(alignment.matched, 'patience');
    const totalChanges =
      result.totalStats.totalAdded +
      result.totalStats.totalRemoved +
      result.totalStats.totalModified;
    expect(totalChanges).toBeGreaterThan(0);
  });

  it('detects unchanged paragraphs', () => {
    const result = diffParagraphs(alignment.matched, 'patience');
    expect(result.totalStats.totalUnchanged).toBeGreaterThan(0);
  });

  it('modified paragraphs include word diffs', () => {
    const result = diffParagraphs(alignment.matched, 'patience');
    const modified = result.sectionDiffs
      .flatMap((sd) => sd.changes)
      .filter((c) => c.type === 'modified');

    if (modified.length > 0) {
      for (const m of modified.slice(0, 5)) {
        assertDefined(m.wordDiff);
        expect(m.wordDiff.length).toBeGreaterThan(0);
      }
    }
  });

  it('Myers and patience produce results (may differ)', () => {
    const patience = diffParagraphs(alignment.matched, 'patience');
    const myers = diffParagraphs(alignment.matched, 'myers');

    // Both should produce some results
    expect(patience.sectionDiffs.length).toBeGreaterThan(0);
    expect(myers.sectionDiffs.length).toBeGreaterThan(0);

    // Both should agree on total sections compared
    expect(patience.totalStats.sectionsCompared).toBe(myers.totalStats.sectionsCompared);
  });
});

// ── Performance ──────────────────────────────────────────────────────

describe('performance', () => {
  it('entire pipeline completes in <2s per filing pair', () => {
    const oldHtml = loadFixture('apple-fy2023.htm');
    const newHtml = loadFixture('apple-fy2024.htm');

    const start = performance.now();

    const oldSections = extractSections(oldHtml);
    const newSections = extractSections(newHtml);
    const alignment = alignSections(oldSections, newSections, 0.75);
    diffParagraphs(alignment.matched, 'patience');
    diffParagraphs(alignment.matched, 'myers');

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty section list alignment', () => {
    const result = alignSections([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('diffParagraphs handles empty match array', () => {
    const result = diffParagraphs([], 'patience');
    expect(result.sectionDiffs).toHaveLength(0);
    expect(result.totalStats.sectionsCompared).toBe(0);
    expect(result.totalStats.totalAdded).toBe(0);
    expect(result.totalStats.totalRemoved).toBe(0);
    expect(result.totalStats.totalModified).toBe(0);
    expect(result.totalStats.totalUnchanged).toBe(0);
  });

  it('handles one-sided alignment (all added)', () => {
    const sections = extractSections(loadFixture('apple-fy2024.htm'));
    const result = alignSections([], sections, 0.75);
    expect(result.matched).toHaveLength(0);
    expect(result.added.length).toBe(sections.length);
  });

  it('handles one-sided alignment (all removed)', () => {
    const sections = extractSections(loadFixture('apple-fy2024.htm'));
    const result = alignSections(sections, [], 0.75);
    expect(result.matched).toHaveLength(0);
    expect(result.removed.length).toBe(sections.length);
  });

  it('diffParagraphs handles sections with no paragraphs', () => {
    const emptyMatch = [
      {
        oldSection: { heading: 'Empty', normalizedHeading: 'empty', paragraphs: [], startIndex: 0, endIndex: 0 },
        newSection: { heading: 'Empty', normalizedHeading: 'empty', paragraphs: [], startIndex: 0, endIndex: 0 },
        similarity: 1.0,
      },
    ];
    const result = diffParagraphs(emptyMatch, 'patience');
    expect(result.sectionDiffs).toHaveLength(1);
    expect(result.sectionDiffs[0].stats.unchanged).toBe(0);
  });

  it('handles sections with identical paragraphs', () => {
    const paras = ['Paragraph one.', 'Paragraph two.', 'Paragraph three.'];
    const match = [
      {
        oldSection: { heading: 'Test', normalizedHeading: 'test', paragraphs: paras, startIndex: 0, endIndex: 100 },
        newSection: { heading: 'Test', normalizedHeading: 'test', paragraphs: [...paras], startIndex: 0, endIndex: 100 },
        similarity: 1.0,
      },
    ];
    const result = diffParagraphs(match, 'patience');
    expect(result.totalStats.totalUnchanged).toBe(3);
    expect(result.totalStats.totalModified).toBe(0);
    expect(result.totalStats.totalAdded).toBe(0);
    expect(result.totalStats.totalRemoved).toBe(0);
  });
});
