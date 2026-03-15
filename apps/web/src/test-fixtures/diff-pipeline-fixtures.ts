/**
 * Test fixtures for US-2.10 Live Diff Pipeline.
 * Mock RawFiling, StructuredDocument, StructuredDiff, and error fixtures.
 */
import { vi } from 'vitest';
import type { RawFiling, StructuredDocument, StructuredDiff, SectionDiff } from '@edgar-diff/lib';

// ─── Accession Number Constants ──────────────────────────────────────────────

export const ACCESSION_A = '0000320193-23-000106';
export const ACCESSION_B = '0000320193-23-000077';
export const ACCESSION_C = '0000320193-22-000108';

// ─── Mock RawFiling Fixtures ─────────────────────────────────────────────────

export const MOCK_RAW_FILING_A = {
  accessionNumber: ACCESSION_A,
  cik: '0000320193',
  formType: '10-K' as const,
  filingDate: { toString: () => '2023-11-03' },
  primaryDocumentFilename: 'filing-a.htm',
  html: '<h2>Item 1. Business</h2><p>Content A</p><h2>Item 1A. Risk Factors</h2><p>Risk A</p>',
  fetchedAt: { toString: () => '2024-01-01T00:00:00Z' },
} as unknown as RawFiling;

export const MOCK_RAW_FILING_B = {
  accessionNumber: ACCESSION_B,
  cik: '0000320193',
  formType: '10-Q' as const,
  filingDate: { toString: () => '2023-08-04' },
  primaryDocumentFilename: 'filing-b.htm',
  html: '<h2>Item 1. Business</h2><p>Content B modified</p><h2>Item 1A. Risk Factors</h2><p>Risk B</p>',
  fetchedAt: { toString: () => '2024-01-02T00:00:00Z' },
} as unknown as RawFiling;

export const MOCK_RAW_FILING_C = {
  accessionNumber: ACCESSION_C,
  cik: '0000320193',
  formType: '10-K' as const,
  filingDate: { toString: () => '2022-10-28' },
  primaryDocumentFilename: 'filing-c.htm',
  html: '<h2>Item 1. Business</h2><p>Content C</p>',
  fetchedAt: { toString: () => '2024-01-03T00:00:00Z' },
} as unknown as RawFiling;

// ─── Mock StructuredDocument Fixtures ────────────────────────────────────────

const SECTIONS_A = [
  {
    id: 'item-1',
    heading: 'Item 1. Business',
    level: 1,
    blocks: [{ type: 'paragraph' as const, text: 'Content A', source: { start: 0, end: 30 } }],
    subsections: [],
    source: { start: 0, end: 30 },
  },
  {
    id: 'item-1a',
    heading: 'Item 1A. Risk Factors',
    level: 1,
    blocks: [{ type: 'paragraph' as const, text: 'Risk A', source: { start: 30, end: 60 } }],
    subsections: [],
    source: { start: 30, end: 60 },
  },
];

const SECTIONS_B = [
  {
    id: 'item-1',
    heading: 'Item 1. Business',
    level: 1,
    blocks: [{ type: 'paragraph' as const, text: 'Content B modified', source: { start: 0, end: 35 } }],
    subsections: [],
    source: { start: 0, end: 35 },
  },
  {
    id: 'item-1a',
    heading: 'Item 1A. Risk Factors',
    level: 1,
    blocks: [{ type: 'paragraph' as const, text: 'Risk B', source: { start: 35, end: 65 } }],
    subsections: [],
    source: { start: 35, end: 65 },
  },
];

export const MOCK_STRUCTURED_DOC_A = {
  filing: MOCK_RAW_FILING_A,
  sections: SECTIONS_A,
  parseWarnings: [],
} as unknown as StructuredDocument;

export const MOCK_STRUCTURED_DOC_B = {
  filing: MOCK_RAW_FILING_B,
  sections: SECTIONS_B,
  parseWarnings: [],
} as unknown as StructuredDocument;

export const MOCK_STRUCTURED_DOC_C = {
  filing: MOCK_RAW_FILING_C,
  sections: [SECTIONS_A[0]],
  parseWarnings: [],
} as unknown as StructuredDocument;

// ─── Mock StructuredDiff Fixtures ────────────────────────────────────────────

const MOCK_SECTION_DIFFS: SectionDiff[] = [
  {
    id: 'item-1',
    heading: 'Item 1. Business',
    changeType: 'modified',
    paragraphDiffs: [
      { changeType: 'modified', sourceMapping: { old: { start: 0, end: 30 }, new: { start: 0, end: 35 } } },
    ],
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping: { old: { start: 0, end: 30 }, new: { start: 0, end: 35 } },
  },
  {
    id: 'item-1a',
    heading: 'Item 1A. Risk Factors',
    changeType: 'unchanged',
    paragraphDiffs: [
      { changeType: 'unchanged', sourceMapping: { old: { start: 30, end: 60 }, new: { start: 35, end: 65 } } },
    ],
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping: { old: { start: 30, end: 60 }, new: { start: 35, end: 65 } },
  },
];

export const MOCK_DIFF: StructuredDiff = {
  oldFiling: {
    accessionNumber: ACCESSION_A,
    cik: '0000320193',
    formType: '10-K',
    filingDate: { toString: () => '2023-11-03' },
  },
  newFiling: {
    accessionNumber: ACCESSION_B,
    cik: '0000320193',
    formType: '10-Q',
    filingDate: { toString: () => '2023-08-04' },
  },
  sectionDiffs: MOCK_SECTION_DIFFS,
  summary: { added: 0, removed: 0, modified: 1, unchanged: 1, reordered: 0 },
  generatedAt: { toString: () => '2024-01-01T00:00:00Z' },
} as unknown as StructuredDiff;

export const MOCK_DIFF_IDENTICAL: StructuredDiff = {
  oldFiling: {
    accessionNumber: ACCESSION_A,
    cik: '0000320193',
    formType: '10-K',
    filingDate: { toString: () => '2023-11-03' },
  },
  newFiling: {
    accessionNumber: ACCESSION_A,
    cik: '0000320193',
    formType: '10-K',
    filingDate: { toString: () => '2023-11-03' },
  },
  sectionDiffs: MOCK_SECTION_DIFFS.map((sd) => ({
    ...sd,
    changeType: 'unchanged' as const,
    paragraphDiffs: sd.paragraphDiffs.map((p) => ({ ...p, changeType: 'unchanged' as const })),
  })),
  summary: { added: 0, removed: 0, modified: 0, unchanged: 2, reordered: 0 },
  generatedAt: { toString: () => '2024-01-01T00:00:00Z' },
} as unknown as StructuredDiff;

export const MOCK_DIFF_EMPTY: StructuredDiff = {
  oldFiling: {
    accessionNumber: ACCESSION_A,
    cik: '0000320193',
    formType: '10-K',
    filingDate: { toString: () => '2023-11-03' },
  },
  newFiling: {
    accessionNumber: ACCESSION_B,
    cik: '0000320193',
    formType: '10-Q',
    filingDate: { toString: () => '2023-08-04' },
  },
  sectionDiffs: [],
  summary: { added: 0, removed: 0, modified: 0, unchanged: 0, reordered: 0 },
  generatedAt: { toString: () => '2024-01-01T00:00:00Z' },
} as unknown as StructuredDiff;

// ─── EdgarClient Mock Helper ─────────────────────────────────────────────────

export function createMockEdgarClient(overrides?: {
  fetchFiling?: (accession: string) => Promise<RawFiling>;
  dispose?: () => void;
}): { fetchFiling: (accession: string) => Promise<RawFiling>; dispose: () => void } {
  return {
    fetchFiling: overrides?.fetchFiling ?? vi.fn(),
    dispose: overrides?.dispose ?? vi.fn(),
  };
}
