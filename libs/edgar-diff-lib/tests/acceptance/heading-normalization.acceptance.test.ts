import { describe, it, expect } from 'vitest';
import {
  normalizeHeading,
  extractItemNumber,
} from '../../src/parser/section-extractor.js';

// ============================================================
// Property-based tests: heading normalization invariants
//
// Tests idempotency of normalizeHeading and dash-variant
// equivalence in extractItemNumber across random inputs.
// ============================================================

const TEST_COUNT = Number(process.env['HEADING_TEST_COUNT'] ?? 200);

// Character pools for generating realistic heading strings
const EDGE_PUNCT = ['.', ',', ':', ';', '\u2014', '\u2013', '\u2014', '\u2013', '-', ' '];
const DASH_VARIANTS = ['-', '\u2013', '\u2014']; // hyphen, en-dash, em-dash
const KNOWN_ITEMS = [
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8',
  '9', '9a', '9b', '9c', '10', '11', '12', '13', '14', '15', '16',
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomHeading(): string {
  const parts: string[] = [];

  // Optionally add leading edge punctuation
  if (Math.random() < 0.4) {
    const count = Math.floor(Math.random() * 4) + 1;
    for (let i = 0; i < count; i++) parts.push(randomChoice(EDGE_PUNCT));
  }

  // Core text: mix of words, spaces, nbsp, punctuation
  const wordCount = Math.floor(Math.random() * 8) + 1;
  for (let w = 0; w < wordCount; w++) {
    if (w > 0) {
      // Random separator: regular space, multiple spaces, or NBSP
      const sep = Math.random();
      if (sep < 0.5) parts.push(' ');
      else if (sep < 0.7) parts.push('  ');
      else if (sep < 0.85) parts.push('   ');
      else parts.push('\u00a0');
    }
    // Random word with mixed case
    const len = Math.floor(Math.random() * 8) + 1;
    let word = '';
    for (let c = 0; c < len; c++) {
      const code = 97 + Math.floor(Math.random() * 26);
      const ch = String.fromCharCode(code);
      word += Math.random() < 0.3 ? ch.toUpperCase() : ch;
    }
    parts.push(word);
  }

  // Optionally add trailing edge punctuation
  if (Math.random() < 0.4) {
    const count = Math.floor(Math.random() * 4) + 1;
    for (let i = 0; i < count; i++) parts.push(randomChoice(EDGE_PUNCT));
  }

  return parts.join('');
}

// --- Test cases ---

interface IdempotencyCase {
  label: string;
  heading: string;
}

const idempotencyCases: IdempotencyCase[] = Array.from({ length: TEST_COUNT }, (_, i) => {
  const heading = generateRandomHeading();
  const preview = heading.length > 40 ? heading.slice(0, 40) + '...' : heading;
  return { label: `#${i} "${preview}"`, heading };
});

describe('property: heading normalization idempotency', () => {
  it.each(idempotencyCases)(
    'case $label',
    ({ heading }) => {
      const once = normalizeHeading(heading);
      const twice = normalizeHeading(once);

      // P1: normalize(normalize(x)) === normalize(x)
      expect(twice).toBe(once);
    },
  );
});

// --- Dash-variant equivalence for extractItemNumber ---

interface DashVariantCase {
  label: string;
  item: string;
  prefix: string;
  suffix: string;
}

const dashVariantCases: DashVariantCase[] = Array.from({ length: TEST_COUNT }, (_, i) => {
  const item = randomChoice(KNOWN_ITEMS);
  const hasPartPrefix = Math.random() < 0.3;
  const prefix = hasPartPrefix
    ? `PART ${randomChoice(['I', 'II', 'III', 'IV'])} `
    : '';
  const suffix = Math.random() < 0.5
    ? ` ${randomChoice(['Risk Factors', 'Business', 'Financial Statements', 'MD&A'])}`
    : '';
  return { label: `#${i} Item ${item}`, item, prefix, suffix };
});

describe('property: dash variants collapse to same item number', () => {
  it.each(dashVariantCases)(
    'case $label',
    ({ item, prefix, suffix }) => {
      const results = DASH_VARIANTS.map(dash => {
        const heading = `${prefix}Item ${item}${dash}${suffix || ' Details'}`;
        return extractItemNumber(heading);
      });

      // P2: All dash variants yield the same non-null item number
      for (const result of results) {
        expect(result).toBe(item.toLowerCase());
      }
    },
  );
});
