import { describe, it, expect } from 'vitest';
import { parseAccessionNumber } from '../../src/client/accession-number.js';

describe('parseAccessionNumber', () => {
  describe('valid inputs', () => {
    it('should parse standard Apple accession number', () => {
      const result = parseAccessionNumber('0000320193-23-000106');
      expect(result).toEqual({
        raw: '0000320193-23-000106',
        noDashes: '000032019323000106',
        submitterCik: '0000320193',
      });
    });

    it('should parse Tesla accession number', () => {
      const result = parseAccessionNumber('0001318605-24-000046');
      expect(result).toEqual({
        raw: '0001318605-24-000046',
        noDashes: '000131860524000046',
        submitterCik: '0001318605',
      });
    });

    it('should parse filing-agent accession number', () => {
      const result = parseAccessionNumber('0000950170-23-035122');
      expect(result.raw).toBe('0000950170-23-035122');
      expect(result.submitterCik).toBe('0000950170');
    });

    it('should trim whitespace-padded input', () => {
      const result = parseAccessionNumber('  0000320193-23-000106  ');
      expect(result.raw).toBe('0000320193-23-000106');
    });

    it('should accept smallest valid CIK', () => {
      const result = parseAccessionNumber('0000000001-24-000001');
      expect(result.raw).toBe('0000000001-24-000001');
    });

    it('should accept maximum values', () => {
      const result = parseAccessionNumber('9999999999-99-999999');
      expect(result.raw).toBe('9999999999-99-999999');
    });
  });

  describe('invalid inputs', () => {
    it('should throw on empty string', () => {
      expect(() => parseAccessionNumber('')).toThrow();
    });

    it('should throw on whitespace-only', () => {
      expect(() => parseAccessionNumber('   ')).toThrow();
    });

    it('should throw on missing dashes', () => {
      expect(() => parseAccessionNumber('000032019323000106')).toThrow();
    });

    it('should throw on too few segments', () => {
      expect(() => parseAccessionNumber('0000320193-23')).toThrow();
    });

    it('should throw on too many segments', () => {
      expect(() => parseAccessionNumber('0000320193-23-000106-extra')).toThrow();
    });

    it('should throw on non-numeric CIK', () => {
      expect(() => parseAccessionNumber('abcdefghij-23-000106')).toThrow();
    });

    it('should throw on non-numeric year', () => {
      expect(() => parseAccessionNumber('0000320193-XX-000106')).toThrow();
    });

    it('should throw on non-numeric sequence', () => {
      expect(() => parseAccessionNumber('0000320193-23-ABCDEF')).toThrow();
    });

    it('should throw on very long string', () => {
      expect(() => parseAccessionNumber('0'.repeat(1000))).toThrow();
    });

    it('should throw on special characters', () => {
      expect(() => parseAccessionNumber('0000320193-23-00010<script>')).toThrow();
    });

    it('should throw on unicode characters', () => {
      expect(() => parseAccessionNumber('0000320193-23-00010\u00e9')).toThrow();
    });

    it('should throw on null bytes', () => {
      expect(() => parseAccessionNumber('0000320193-23-\x00000106')).toThrow();
    });

    it('should throw on path traversal', () => {
      expect(() => parseAccessionNumber('../../etc/passwd')).toThrow();
    });

    it('should throw on newlines', () => {
      expect(() => parseAccessionNumber('0000320193\n-23-000106')).toThrow();
    });

    it('should throw on leading/trailing dashes', () => {
      expect(() => parseAccessionNumber('-0000320193-23-000106-')).toThrow();
    });

    it('should throw on null', () => {
      expect(() => parseAccessionNumber(null as any)).toThrow();
    });

    it('should throw on undefined', () => {
      expect(() => parseAccessionNumber(undefined as any)).toThrow();
    });
  });
});
