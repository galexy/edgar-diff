import { describe, it, expect } from 'vitest';
import { createEdgarClient } from '../../src/client/index.js';
import { parseFiling } from '../../src/parser/index.js';
import type { FilingSection } from '../../src/types.js';

// Apple FY2024 10-K — a well-known Workiva-filed document (Pattern Family A)
const APPLE_ACCESSION = '0000320193-24-000123';

// Expected Items in an Apple 10-K (standard 10-K structure)
const EXPECTED_ITEM_IDS = [
  'item-1', 'item-1a', 'item-1b', 'item-1c',
  'item-2', 'item-3', 'item-4',
  'item-5', 'item-6', 'item-7', 'item-7a', 'item-8',
  'item-9', 'item-9a', 'item-9b', 'item-9c',
  'item-10', 'item-11', 'item-12', 'item-13', 'item-14',
  'item-15', 'item-16',
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#160;/g, ' ')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('live EDGAR: fetch + parse Apple 10-K', () => {
  let sections: FilingSection[];
  let html: string;
  let parseWarnings: string[];
  let parseMs: number;

  // Fetch once, reuse across tests
  it('fetches and parses a real filing from EDGAR', async () => {
    const client = createEdgarClient({
      userAgent: 'edgar-diff-lib-test test@example.com',
    });

    try {
      const raw = await client.fetchFiling(APPLE_ACCESSION);

      expect(raw.cik).toBe('0000320193');
      expect(raw.formType).toBe('10-K');
      expect(raw.html.length).toBeGreaterThan(100_000);

      html = raw.html;

      const t0 = performance.now();
      const doc = parseFiling(raw);
      parseMs = performance.now() - t0;

      sections = doc.sections;
      parseWarnings = doc.parseWarnings;

      expect(sections.length).toBeGreaterThan(0);
    } finally {
      client.dispose();
    }
  }, 30_000);

  it('detects all standard 10-K Item sections', () => {
    const detectedIds = sections.map(s => s.id);
    for (const expectedId of EXPECTED_ITEM_IDS) {
      expect(detectedIds, `missing ${expectedId}`).toContain(expectedId);
    }
  });

  it('detects no duplicate section IDs', () => {
    const ids = sections.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sections are in document order', () => {
    for (let i = 1; i < sections.length; i++) {
      expect(
        sections[i].source.start,
        `${sections[i].id} should start after ${sections[i - 1].id}`,
      ).toBeGreaterThanOrEqual(sections[i - 1].source.end);
    }
  });

  it('source offsets are valid and non-overlapping', () => {
    for (const section of sections) {
      expect(section.source.start).toBeGreaterThanOrEqual(0);
      expect(section.source.end).toBeGreaterThan(section.source.start);
      expect(section.source.end).toBeLessThanOrEqual(html.length);
    }

    for (let i = 1; i < sections.length; i++) {
      expect(
        sections[i].source.start,
        `overlap: ${sections[i - 1].id} [${sections[i - 1].source.end}] vs ${sections[i].id} [${sections[i].source.start}]`,
      ).toBeGreaterThanOrEqual(sections[i - 1].source.end);
    }
  });

  it('source mapping round-trip: sliced HTML contains heading text', () => {
    for (const section of sections) {
      const slice = html.slice(section.source.start, section.source.end);
      const sliceText = stripHtml(slice);
      // Normalize both sides for comparison (curly quotes, whitespace)
      const normalize = (s: string) => s.replace(/[\u2018\u2019\u2032']/g, "'").replace(/\s+/g, ' ');
      const headingWords = normalize(section.heading).split(' ').slice(0, 4).join(' ');
      expect(
        normalize(sliceText),
        `${section.id}: slice should contain "${headingWords}"`,
      ).toContain(headingWords);
    }
  });

  it('content blocks are within section bounds', () => {
    for (const section of sections) {
      for (const block of section.blocks) {
        expect(
          block.source.start,
          `block in ${section.id} starts before section`,
        ).toBeGreaterThanOrEqual(section.source.start);
        expect(
          block.source.end,
          `block in ${section.id} ends after section`,
        ).toBeLessThanOrEqual(section.source.end);
      }
    }
  });

  it('paragraphs have non-empty text', () => {
    for (const section of sections) {
      for (const block of section.blocks) {
        if (block.type === 'paragraph') {
          expect(block.text.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('key sections have expected content', () => {
    const item1 = sections.find(s => s.id === 'item-1')!;
    expect(item1).toBeDefined();
    expect(item1.blocks.length).toBeGreaterThan(5);
    const firstPara = item1.blocks.find(b => b.type === 'paragraph');
    expect(firstPara).toBeDefined();

    const item8 = sections.find(s => s.id === 'item-8')!;
    expect(item8).toBeDefined();
    // Item 8 (Financial Statements) should have tables
    const tables = item8.blocks.filter(b => b.type === 'table');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('parses within 500ms', () => {
    expect(parseMs).toBeLessThan(500);
  });
});
