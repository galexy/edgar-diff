import type { ParsedAccession } from './types.js';

const ACCESSION_REGEX = /^\d{10}-\d{2}-\d{6}$/;

export function parseAccessionNumber(input: string): ParsedAccession {
  if (input == null) {
    throw new Error('Invalid accession number: input is null or undefined');
  }

  const trimmed = String(input).trim();

  if (!ACCESSION_REGEX.test(trimmed)) {
    throw new Error(`Invalid accession number: "${trimmed}"`);
  }

  return {
    raw: trimmed,
    noDashes: trimmed.replace(/-/g, ''),
    submitterCik: trimmed.substring(0, 10),
  };
}
