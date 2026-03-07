import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { tryParseNumeric } from '../../src/parser/table-extractor.js';
import { parseFiling } from '../../src/parser/parser.js';
import type { RawFiling } from '../../src/client/types.js';
import type { Table } from '../../src/types.js';

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

describe('tryParseNumeric', () => {
  it('T9: currency values parsed to numericValue', () => {
    expect(tryParseNumeric('$1,234.56')).toBe(1234.56);
    expect(tryParseNumeric('$100')).toBe(100);
    expect(tryParseNumeric('$ 42.00')).toBe(42);
  });

  it('T10: percentage values parsed to numericValue', () => {
    expect(tryParseNumeric('12.5%')).toBe(12.5);
    expect(tryParseNumeric('100%')).toBe(100);
    expect(tryParseNumeric('0.5 %')).toBe(0.5);
  });

  it('T11: parenthetical negatives parsed as negative numbers', () => {
    expect(tryParseNumeric('(1,234)')).toBe(-1234);
    expect(tryParseNumeric('(42)')).toBe(-42);
    expect(tryParseNumeric('$(500.50)')).toBe(-500.50);
  });

  it('T12: plain numbers parsed correctly', () => {
    expect(tryParseNumeric('42')).toBe(42);
    expect(tryParseNumeric('1,000')).toBe(1000);
    expect(tryParseNumeric('3.14')).toBe(3.14);
  });

  it('T13: non-numeric text returns undefined', () => {
    expect(tryParseNumeric('Revenue')).toBeUndefined();
    expect(tryParseNumeric('Total operating expenses')).toBeUndefined();
    expect(tryParseNumeric('N/A')).toBeUndefined();
  });

  it('T14: mixed text with number returns undefined', () => {
    expect(tryParseNumeric('$1,234 million')).toBeUndefined();
    expect(tryParseNumeric('approximately 500')).toBeUndefined();
  });

  it('T25: dash patterns as zero', () => {
    expect(tryParseNumeric('\u2014')).toBe(0);  // em-dash
    expect(tryParseNumeric('\u2013')).toBe(0);  // en-dash
    expect(tryParseNumeric('--')).toBe(0);
    expect(tryParseNumeric('---')).toBe(0);
  });

  it('T26: negative numbers with dash prefix', () => {
    expect(tryParseNumeric('-1,234')).toBe(-1234);
    expect(tryParseNumeric('- 500')).toBe(-500);
    expect(tryParseNumeric('-42.5')).toBe(-42.5);
  });

  it('empty/whitespace returns undefined', () => {
    expect(tryParseNumeric('')).toBeUndefined();
    expect(tryParseNumeric('   ')).toBeUndefined();
  });
});
