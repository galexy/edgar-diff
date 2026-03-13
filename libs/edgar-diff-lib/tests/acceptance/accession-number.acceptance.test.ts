import { describe, it, expect } from 'vitest';
import { parseAccessionNumber } from '../../src/client/accession-number.js';

// ============================================================
// Property-based tests: accession number round-trip invariants
//
// Each iteration generates a random valid accession number and
// verifies round-trip and structural properties.
// ============================================================

const TEST_COUNT = Number(process.env['ACCESSION_TEST_COUNT'] ?? 200);

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += Math.floor(Math.random() * 10).toString();
  }
  return s;
}

interface AccessionTestCase {
  label: string;
  input: string;
}

const testCases: AccessionTestCase[] = Array.from({ length: TEST_COUNT }, (_, i) => {
  const cik = randomDigits(10);
  const year = randomDigits(2);
  const seq = randomDigits(6);
  const input = `${cik}-${year}-${seq}`;
  return { label: `#${i} ${input}`, input };
});

describe('property: accession number round-trip invariants', () => {
  it.each(testCases)(
    'case $label',
    ({ input }) => {
      const parsed = parseAccessionNumber(input);

      // P1: raw round-trips exactly
      expect(parsed.raw).toBe(input);

      // P2: noDashes equals input with dashes removed
      expect(parsed.noDashes).toBe(input.replace(/-/g, ''));

      // P3: noDashes is always exactly 18 digits
      expect(parsed.noDashes).toHaveLength(18);
      expect(parsed.noDashes).toMatch(/^\d{18}$/);

      // P4: submitterCik is first 10 characters
      expect(parsed.submitterCik).toBe(input.substring(0, 10));
      expect(parsed.submitterCik).toMatch(/^\d{10}$/);
    },
  );
});
