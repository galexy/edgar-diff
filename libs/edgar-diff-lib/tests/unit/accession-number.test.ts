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
    it.each([
      ['empty string', ''],
      ['whitespace-only', '   '],
      ['missing dashes', '000032019323000106'],
      ['too few segments', '0000320193-23'],
      ['too many segments', '0000320193-23-000106-extra'],
      ['non-numeric CIK', 'abcdefghij-23-000106'],
      ['non-numeric year', '0000320193-XX-000106'],
      ['non-numeric sequence', '0000320193-23-ABCDEF'],
      ['very long string', '0'.repeat(1000)],
      ['special characters', '0000320193-23-00010<script>'],
      ['unicode characters', '0000320193-23-00010\u00e9'],
      ['null bytes', '0000320193-23-\x00000106'],
      ['path traversal', '../../etc/passwd'],
      ['newlines', '0000320193\n-23-000106'],
      ['leading/trailing dashes', '-0000320193-23-000106-'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ['null', null as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ['undefined', undefined as any],
    ])('should throw on %s', (_label, input) => {
      expect(() => parseAccessionNumber(input)).toThrow();
    });
  });
});
