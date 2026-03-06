import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { extractItemNumber, normalizeHeading } from '../../src/parser/section-extractor.js';
import type { RawFiling } from '../../src/client/types.js';

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

describe('extractItemNumber', () => {
  it('U1: standard mixed-case heading', () => {
    expect(extractItemNumber('Item 1A. Risk Factors')).toBe('1a');
  });

  it('U2: uppercase heading', () => {
    expect(extractItemNumber('ITEM 7. MANAGEMENT DISCUSSION')).toBe('7');
  });

  it('U3: bare item number', () => {
    expect(extractItemNumber('Item 1')).toBe('1');
  });

  it('U4: with PART prefix and em-dash', () => {
    expect(extractItemNumber('PART I \u2014 Item 1. Business')).toBe('1');
  });

  it('U5: non-item text returns null', () => {
    expect(extractItemNumber('The Company reported...')).toBeNull();
  });

  it('U6: cross-reference (not anchored to start) returns null', () => {
    expect(extractItemNumber('See Item 1A for details')).toBeNull();
  });

  it('U7: regulation reference (item 601) returns null', () => {
    expect(extractItemNumber('Item 601 of Regulation S-K')).toBeNull();
  });

  it('U32: KNOWN_ITEMS boundary -- Item 16 valid, Item 17 not', () => {
    expect(extractItemNumber('Item 16. Exhibits')).toBe('16');
    expect(extractItemNumber('Item 17. Financial Statements')).toBeNull();
  });

  it('U33: Item 9c (last valid lettered item)', () => {
    expect(extractItemNumber('Item 9C. Disclosure Regarding Foreign Jurisdictions')).toBe('9c');
  });

  it('U8: item with trailing period only', () => {
    expect(extractItemNumber('Item 1B.')).toBe('1b');
  });

  it('U9: unicode en-dash separator', () => {
    expect(extractItemNumber('Item 7A \u2013 Market Risk')).toBe('7a');
  });

  it('U28: non-breaking space between ITEM and number (WMT pattern)', () => {
    expect(extractItemNumber('ITEM\u00a01. BUSINESS')).toBe('1');
  });

  it('U29: non-breaking space in simple form', () => {
    expect(extractItemNumber('ITEM\u00a01A.')).toBe('1a');
  });
});

describe('normalizeHeading', () => {
  it('U10: collapse whitespace and trim', () => {
    expect(normalizeHeading('  Item  1A.   Risk  Factors  ')).toBe('item 1a. risk factors');
  });

  it('U11: strip leading/trailing punctuation', () => {
    expect(normalizeHeading('---Item 1.---')).toBe('item 1');
  });

  it('U12: lowercase', () => {
    expect(normalizeHeading('ITEM 7A. QUANTITATIVE DISCLOSURES')).toBe('item 7a. quantitative disclosures');
  });
});
