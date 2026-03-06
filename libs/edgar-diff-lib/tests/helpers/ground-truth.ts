import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import type { RawFiling } from '../../src/client/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'integration', 'fixtures');

export interface ExpectedItem {
  id: string;
  heading: string;
  sourceOffset: number;
}

export interface FixtureMeta {
  ticker: string;
  year: number;
  filingDate: string;
  patternFamily: string;
  hasTOC: boolean;
  hasIXBRL: boolean;
  filingAgentHint: string;
  expectedItems: ExpectedItem[];
}

/** Valid 10-K item numbers. */
export const KNOWN_ITEMS = new Set([
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8',
  '9', '9a', '9b', '9c', '10', '11', '12', '13', '14', '15', '16',
]);

/** All fixture identifiers (ticker-year pairs that have both HTML and meta JSON). */
export const ALL_FIXTURES: Array<{ ticker: string; year: number }> = [
  { ticker: 'aapl', year: 2024 },
  { ticker: 'amzn', year: 2024 },
  { ticker: 'bac', year: 2024 },
  { ticker: 'brk-b', year: 2024 },
  { ticker: 'cvx', year: 2024 },
  { ticker: 'jnj', year: 2024 },
  { ticker: 'jpm', year: 2023 },
  { ticker: 'jpm', year: 2024 },
  { ticker: 'msft', year: 2023 },
  { ticker: 'msft', year: 2024 },
  { ticker: 'pg', year: 2024 },
  { ticker: 'unh', year: 2024 },
  { ticker: 'wmt', year: 2024 },
  { ticker: 'xom', year: 2012 },
  { ticker: 'xom', year: 2024 },
];

/** Load raw HTML fixture file. */
export function loadFixture(ticker: string, year: number): string {
  return readFileSync(join(FIXTURES_DIR, `10k-${ticker}-${year}.html`), 'utf-8');
}

/** Load ground truth meta JSON. */
export function loadGroundTruth(ticker: string, year: number): FixtureMeta {
  const raw = readFileSync(join(FIXTURES_DIR, `meta-10k-${ticker}-${year}.json`), 'utf-8');
  return JSON.parse(raw) as FixtureMeta;
}

/** Load all available fixture metas. */
export function loadAllFixtureMeta(): FixtureMeta[] {
  return ALL_FIXTURES.map(f => loadGroundTruth(f.ticker, f.year));
}

const VALID_ID_RE = /^item-(\d+[a-z]?)$/;

/** Filter ground truth to valid 10-K item IDs only. */
export function getExpectedIds(meta: FixtureMeta): string[] {
  return meta.expectedItems
    .filter(e => {
      const match = e.id.match(VALID_ID_RE);
      if (!match) return false;
      return KNOWN_ITEMS.has(match[1]);
    })
    .map(e => e.id);
}

/** Create a minimal RawFiling from HTML string. */
export function makeRawFiling(html: string, overrides?: Partial<RawFiling>): RawFiling {
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
