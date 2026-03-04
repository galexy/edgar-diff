/**
 * Tests for the diff algorithm spike (Prototype B).
 * Covers TF-IDF, section extraction, alignment, and paragraph diff.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections, normalizeHeading } from '../section-extractor.js';
import {
  tokenize,
  computeTF,
  computeIDF,
  buildTfIdfVector,
  cosineSimilarity,
  levenshteinSimilarity,
  alignSections,
  alignSectionsHeadingOnly,
} from '../section-aligner.js';
import {
  diffParagraphsMyers,
  diffParagraphsPatience,
  diffAllSections,
} from '../paragraph-differ.js';
import type { Section } from '../section-extractor.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// Helper to check if fixtures exist
async function fixturesExist(): Promise<boolean> {
  try {
    await readFile(join(FIXTURES_DIR, 'apple-fy2024.html'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function makeSection(overrides: Partial<Section> & { heading: string }): Section {
  return {
    normalizedHeading: normalizeHeading(overrides.heading),
    paragraphs: overrides.paragraphs ?? ['Test paragraph.'],
    content: overrides.content ?? 'Test content.',
    startIndex: overrides.startIndex ?? 0,
    endIndex: overrides.endIndex ?? 100,
    ...overrides,
  };
}

// ─── TF-IDF Unit Tests ─────────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits on whitespace/punctuation', () => {
    const tokens = tokenize('Hello, World! This is a TEST.');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
  });

  it('removes stop words', () => {
    const tokens = tokenize('the quick brown fox is a very fast animal');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('very');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
  });

  it('removes single-character tokens', () => {
    const tokens = tokenize('I am a b c developer');
    expect(tokens).not.toContain('b');
    expect(tokens).not.toContain('c');
    expect(tokens).toContain('developer');
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('computeTF', () => {
  it('computes term frequencies', () => {
    const tf = computeTF(['apple', 'orange', 'apple', 'banana']);
    expect(tf.get('apple')).toBe(2 / 4);
    expect(tf.get('orange')).toBe(1 / 4);
    expect(tf.get('banana')).toBe(1 / 4);
  });

  it('handles single-token input', () => {
    const tf = computeTF(['hello']);
    expect(tf.get('hello')).toBe(1);
  });
});

describe('computeIDF', () => {
  it('computes inverse document frequencies', () => {
    const corpus = [
      ['apple', 'banana'],
      ['apple', 'cherry'],
      ['banana', 'cherry'],
    ];
    const idf = computeIDF(corpus);
    // apple appears in 2/3 docs
    // cherry appears in 2/3 docs
    // banana appears in 2/3 docs
    // All should have the same IDF
    expect(idf.get('apple')).toBeCloseTo(idf.get('banana')!);
    expect(idf.get('banana')).toBeCloseTo(idf.get('cherry')!);
  });

  it('gives higher IDF to rarer terms', () => {
    const corpus = [
      ['common', 'rare'],
      ['common', 'other'],
      ['common', 'another'],
    ];
    const idf = computeIDF(corpus);
    expect(idf.get('rare')!).toBeGreaterThan(idf.get('common')!);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const tf = computeTF(['apple', 'banana', 'apple']);
    const idf = computeIDF([['apple', 'banana', 'apple']]);
    const v = buildTfIdfVector(tf, idf);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for completely different vectors', () => {
    const idf = computeIDF([['apple', 'banana'], ['cherry', 'date']]);
    const v1 = buildTfIdfVector(computeTF(['apple', 'banana']), idf);
    const v2 = buildTfIdfVector(computeTF(['cherry', 'date']), idf);
    expect(cosineSimilarity(v1, v2)).toBe(0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const idf = computeIDF([['apple', 'banana', 'cherry'], ['apple', 'date', 'elderberry']]);
    const v1 = buildTfIdfVector(computeTF(['apple', 'banana', 'cherry']), idf);
    const v2 = buildTfIdfVector(computeTF(['apple', 'date', 'elderberry']), idf);
    const sim = cosineSimilarity(v1, v2);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('handles empty vectors', () => {
    const empty = buildTfIdfVector(new Map(), new Map());
    const tf = computeTF(['apple']);
    const idf = computeIDF([['apple']]);
    const v = buildTfIdfVector(tf, idf);
    expect(cosineSimilarity(empty, v)).toBe(0);
    expect(cosineSimilarity(v, empty)).toBe(0);
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(levenshteinSimilarity('abc', 'xyz')).toBeCloseTo(0);
  });

  it('returns partial similarity for similar strings', () => {
    const sim = levenshteinSimilarity('item 1a', 'item 1b');
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1);
    expect(levenshteinSimilarity('abc', '')).toBe(0);
    expect(levenshteinSimilarity('', 'abc')).toBe(0);
  });
});

// ─── Section Extraction Tests ────────────────────────────────────────────────

describe('normalizeHeading', () => {
  it('normalizes item headings', () => {
    expect(normalizeHeading('Item 1A')).toBe('item 1a');
    expect(normalizeHeading('ITEM  7A.')).toBe('item 7a');
  });

  it('strips special chars', () => {
    expect(normalizeHeading('item-1.a:')).toBe('item1a');
  });
});

describe('extractSections', () => {
  it('extracts sections from simple HTML', () => {
    const html = `
      <html><body>
        <div><b>Item 1. Business</b></div>
        <p>We are a company that does things.</p>
        <p>We sell products worldwide.</p>
        <div><b>Item 1A. Risk Factors</b></div>
        <p>There are many risks to our business.</p>
        <div><b>Item 2. Properties</b></div>
        <p>We have offices.</p>
      </body></html>
    `;
    const sections = extractSections(html);
    expect(sections.length).toBe(3);
    expect(sections[0].normalizedHeading).toBe('item 1');
    expect(sections[1].normalizedHeading).toBe('item 1a');
    expect(sections[2].normalizedHeading).toBe('item 2');
    expect(sections[0].paragraphs.length).toBeGreaterThan(0);
  });

  it('handles empty HTML', () => {
    expect(extractSections('')).toEqual([]);
    expect(extractSections('<html><body></body></html>')).toEqual([]);
  });

  it('handles sections with styled headings', () => {
    const html = `
      <div><span style="font-weight:bold;font-size:16pt">Item 7. Management's Discussion</span></div>
      <p>Discussion content here.</p>
      <div><span style="font-weight:700">Item 8. Financial Statements</span></div>
      <p>Financials here.</p>
    `;
    const sections = extractSections(html);
    expect(sections.length).toBe(2);
    expect(sections[0].normalizedHeading).toBe('item 7');
    expect(sections[1].normalizedHeading).toBe('item 8');
  });
});

// ─── Section Alignment Tests ─────────────────────────────────────────────────

describe('alignSections', () => {
  it('matches identical sections perfectly', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'We sell products and services.', paragraphs: ['We sell products and services.'] }),
      makeSection({ heading: 'Item 2. Properties', content: 'We have offices worldwide.', paragraphs: ['We have offices worldwide.'], startIndex: 200, endIndex: 400 }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 1. Business', content: 'We sell products and services.', paragraphs: ['We sell products and services.'] }),
      makeSection({ heading: 'Item 2. Properties', content: 'We have offices worldwide.', paragraphs: ['We have offices worldwide.'], startIndex: 200, endIndex: 400 }),
    ];

    const result = alignSections(oldSections, newSections);
    expect(result.matched.length).toBe(2);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('detects added sections', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business content.', paragraphs: ['Business content.'] }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business content.', paragraphs: ['Business content.'] }),
      makeSection({ heading: 'Item 1C. Cybersecurity', content: 'New cybersecurity section.', paragraphs: ['New cybersecurity section.'], startIndex: 200, endIndex: 400 }),
    ];

    const result = alignSections(oldSections, newSections);
    expect(result.matched.length).toBe(1);
    expect(result.added.length).toBe(1);
    expect(result.added[0].normalizedHeading).toContain('item 1c');
  });

  it('detects removed sections', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business content.', paragraphs: ['Business content.'] }),
      makeSection({ heading: 'Item 6. Selected Financial Data', content: 'Old financial data.', paragraphs: ['Old financial data.'], startIndex: 200, endIndex: 400 }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business content.', paragraphs: ['Business content.'] }),
    ];

    const result = alignSections(oldSections, newSections);
    expect(result.matched.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('handles content similarity for renamed sections', () => {
    const oldSections = [
      makeSection({
        heading: 'Item 1. Description of Business',
        content: 'We design manufacture and market smartphones personal computers tablets.',
        paragraphs: ['We design manufacture and market smartphones personal computers tablets.'],
      }),
    ];
    const newSections = [
      makeSection({
        heading: 'Item 1. Business Overview',
        content: 'We design manufacture and market smartphones personal computers tablets and accessories.',
        paragraphs: ['We design manufacture and market smartphones personal computers tablets and accessories.'],
      }),
    ];

    const result = alignSections(oldSections, newSections);
    expect(result.matched.length).toBe(1);
    expect(result.matched[0].contentSimilarity).toBeGreaterThan(0.5);
  });
});

// ─── Heading-Only Alignment Tests ────────────────────────────────────────────

describe('alignSectionsHeadingOnly', () => {
  it('matches sections with identical headings', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Old content about business.', paragraphs: ['Old content about business.'] }),
      makeSection({ heading: 'Item 2. Properties', content: 'Old properties info.', paragraphs: ['Old properties info.'], startIndex: 200, endIndex: 400 }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Completely different content.', paragraphs: ['Completely different content.'] }),
      makeSection({ heading: 'Item 2. Properties', content: 'Totally new properties.', paragraphs: ['Totally new properties.'], startIndex: 200, endIndex: 400 }),
    ];

    const result = alignSectionsHeadingOnly(oldSections, newSections);
    expect(result.matched.length).toBe(2);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
    // Should match by heading regardless of content
    expect(result.matched[0].headingSimilarity).toBe(1);
    expect(result.matched[1].headingSimilarity).toBe(1);
    // Content similarity is always 0 for heading-only
    expect(result.matched[0].contentSimilarity).toBe(0);
  });

  it('detects added and removed sections', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business.', paragraphs: ['Business.'] }),
      makeSection({ heading: 'Item 6. Reserved', content: 'Reserved.', paragraphs: ['Reserved.'], startIndex: 200, endIndex: 400 }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 1. Business', content: 'Business.', paragraphs: ['Business.'] }),
      makeSection({ heading: 'Item 1C. Cybersecurity', content: 'Cyber.', paragraphs: ['Cyber.'], startIndex: 200, endIndex: 400 }),
    ];

    const result = alignSectionsHeadingOnly(oldSections, newSections);
    expect(result.matched.length).toBe(1);
    expect(result.matched[0].oldSection.heading).toBe('Item 1. Business');
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('does not match sections below threshold', () => {
    const oldSections = [
      makeSection({ heading: 'Item 1. Business', content: 'x', paragraphs: ['x'] }),
    ];
    const newSections = [
      makeSection({ heading: 'Item 99. Appendix', content: 'y', paragraphs: ['y'] }),
    ];

    const result = alignSectionsHeadingOnly(oldSections, newSections, 0.5);
    expect(result.matched.length).toBe(0);
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });
});

// ─── Paragraph Diff Tests ────────────────────────────────────────────────────

describe('diffParagraphsMyers', () => {
  it('detects additions', () => {
    const oldSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'Paragraph B.'],
      content: 'Paragraph A. Paragraph B.',
    });
    const newSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'New paragraph.', 'Paragraph B.'],
      content: 'Paragraph A. New paragraph. Paragraph B.',
    });

    const diff = diffParagraphsMyers(oldSection, newSection, 0.95);
    expect(diff.stats.added).toBe(1);
    expect(diff.stats.unchanged).toBe(2);
  });

  it('detects removals', () => {
    const oldSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'Old paragraph.', 'Paragraph B.'],
      content: 'Paragraph A. Old paragraph. Paragraph B.',
    });
    const newSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'Paragraph B.'],
      content: 'Paragraph A. Paragraph B.',
    });

    const diff = diffParagraphsMyers(oldSection, newSection, 0.95);
    expect(diff.stats.removed).toBe(1);
    expect(diff.stats.unchanged).toBe(2);
  });

  it('detects modifications with word-level diff', () => {
    const oldSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['The company had revenue of $100 million.'],
      content: 'The company had revenue of $100 million.',
    });
    const newSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['The company had revenue of $150 million.'],
      content: 'The company had revenue of $150 million.',
    });

    const diff = diffParagraphsMyers(oldSection, newSection, 0.95);
    expect(diff.stats.modified).toBe(1);
    const modified = diff.changes.find((c) => c.type === 'modified');
    expect(modified?.wordChanges).toBeDefined();
    expect(modified?.wordChanges?.some((w) => w.type === 'removed' && w.value.includes('100'))).toBe(true);
    expect(modified?.wordChanges?.some((w) => w.type === 'added' && w.value.includes('150'))).toBe(true);
  });

  it('handles identical sections', () => {
    const section = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Same content.', 'Also same.'],
      content: 'Same content. Also same.',
    });

    const diff = diffParagraphsMyers(section, section, 1.0);
    expect(diff.stats.unchanged).toBe(2);
    expect(diff.stats.added).toBe(0);
    expect(diff.stats.removed).toBe(0);
    expect(diff.stats.modified).toBe(0);
  });
});

describe('diffParagraphsPatience', () => {
  it('produces valid output for same input as Myers', () => {
    const oldSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'Paragraph B.', 'Paragraph C.'],
      content: 'Paragraph A. Paragraph B. Paragraph C.',
    });
    const newSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['Paragraph A.', 'New paragraph.', 'Paragraph C.'],
      content: 'Paragraph A. New paragraph. Paragraph C.',
    });

    const diff = diffParagraphsPatience(oldSection, newSection, 0.95);
    // Should detect B removed and new paragraph added (or B→new as modified)
    expect(diff.stats.total).toBeGreaterThan(0);
    expect(diff.stats.unchanged).toBeGreaterThanOrEqual(1);
  });
});

describe('diffAllSections', () => {
  it('processes multiple section pairs', () => {
    const pairs = [
      {
        oldSection: makeSection({
          heading: 'Item 1. Business',
          paragraphs: ['Content A.'],
          content: 'Content A.',
        }),
        newSection: makeSection({
          heading: 'Item 1. Business',
          paragraphs: ['Content A.', 'Content B.'],
          content: 'Content A. Content B.',
        }),
        similarity: 0.9,
      },
    ];

    const diffs = diffAllSections(pairs, 'myers');
    expect(diffs.length).toBe(1);
    expect(diffs[0].stats.added).toBe(1);
  });
});

// ─── Integration Tests with Real Filings ─────────────────────────────────────

describe('integration with real filings', () => {
  let appleOld: string;
  let appleNew: string;
  let msftOld: string;
  let msftNew: string;
  let hasFixtures: boolean;

  beforeAll(async () => {
    hasFixtures = await fixturesExist();
    if (hasFixtures) {
      [appleOld, appleNew, msftOld, msftNew] = await Promise.all([
        readFile(join(FIXTURES_DIR, 'apple-fy2023.html'), 'utf-8'),
        readFile(join(FIXTURES_DIR, 'apple-fy2024.html'), 'utf-8'),
        readFile(join(FIXTURES_DIR, 'msft-fy2023.html'), 'utf-8'),
        readFile(join(FIXTURES_DIR, 'msft-fy2024.html'), 'utf-8'),
      ]);
    }
  });

  it('extracts known Apple 10-K sections', () => {
    if (!hasFixtures) return;

    const sections = extractSections(appleOld);
    const headings = sections.map((s) => s.normalizedHeading);

    // Apple 10-K should have standard items
    expect(headings).toContain('item 1');
    expect(headings).toContain('item 1a');
    expect(headings).toContain('item 7');
    expect(headings).toContain('item 8');
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  it('extracts known Microsoft 10-K sections', () => {
    if (!hasFixtures) return;

    const sections = extractSections(msftOld);
    const headings = sections.map((s) => s.normalizedHeading);

    expect(headings).toContain('item 1');
    expect(headings).toContain('item 1a');
    expect(headings).toContain('item 7');
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  it('correctly aligns Apple FY2023 and FY2024 sections with >90% accuracy', () => {
    if (!hasFixtures) return;

    const oldSections = extractSections(appleOld);
    const newSections = extractSections(appleNew);
    const result = alignSections(oldSections, newSections);

    // >90% section alignment accuracy
    const matchRate = result.matched.length / Math.max(oldSections.length, newSections.length);
    expect(matchRate).toBeGreaterThanOrEqual(0.9);

    // Check that matched sections have highly similar headings
    for (const m of result.matched) {
      expect(m.headingSimilarity).toBeGreaterThan(0.5);
    }
  });

  it('correctly aligns Microsoft FY2023 and FY2024 sections with >90% accuracy', () => {
    if (!hasFixtures) return;

    const oldSections = extractSections(msftOld);
    const newSections = extractSections(msftNew);
    const result = alignSections(oldSections, newSections);

    // >90% section alignment accuracy
    const matchRate = result.matched.length / Math.max(oldSections.length, newSections.length);
    expect(matchRate).toBeGreaterThanOrEqual(0.9);
  });

  it('completes Apple pipeline within 2s', () => {
    if (!hasFixtures) return;

    const start = performance.now();
    const oldSections = extractSections(appleOld);
    const newSections = extractSections(appleNew);
    const alignment = alignSections(oldSections, newSections);
    diffAllSections(alignment.matched, 'myers');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it('completes Microsoft pipeline within 2s', () => {
    if (!hasFixtures) return;

    const start = performance.now();
    const oldSections = extractSections(msftOld);
    const newSections = extractSections(msftNew);
    const alignment = alignSections(oldSections, newSections);
    diffAllSections(alignment.matched, 'myers');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty sections', () => {
    const result = alignSections([], []);
    expect(result.matched).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('handles sections with only tables (no paragraph text)', () => {
    const html = `
      <b>Item 1. Business</b>
      <table><tr><td>Data 1</td><td>Data 2</td></tr></table>
      <b>Item 2. Properties</b>
      <p>Some properties.</p>
    `;
    const sections = extractSections(html);
    expect(sections.length).toBe(2);
    // Table section may have few or no paragraphs
    expect(sections[0].paragraphs).toBeDefined();
  });

  it('handles section with renamed heading via content matching', () => {
    const oldSections = [
      makeSection({
        heading: 'Item 6. Reserved',
        content: 'This section has been reserved. No content to report. The registrant has elected not to include information under this item.',
        paragraphs: ['This section has been reserved.', 'No content to report.'],
        normalizedHeading: 'item 6',
      }),
    ];
    const newSections = [
      makeSection({
        heading: 'Item 6. [Reserved]',
        content: 'This section has been reserved. No content to report. The registrant has elected not to include information under this item.',
        paragraphs: ['This section has been reserved.', 'No content to report.'],
        normalizedHeading: 'item 6',
      }),
    ];

    const result = alignSections(oldSections, newSections);
    expect(result.matched.length).toBe(1);
    expect(result.matched[0].similarity).toBeGreaterThan(0.8);
  });

  it('diffParagraphs handles empty paragraph lists', () => {
    const oldSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: [],
      content: '',
    });
    const newSection = makeSection({
      heading: 'Item 1. Business',
      paragraphs: ['New content.'],
      content: 'New content.',
    });

    const diff = diffParagraphsMyers(oldSection, newSection, 0.95);
    expect(diff.stats.added).toBe(1);
  });
});
