/**
 * Shared utilities for example scripts.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import type { RawFiling } from '../libs/edgar-diff-lib/src/client/types.js';

/** Load a filing from any HTML file path, using reasonable defaults for metadata. */
export function loadFilingFromPath(filePath: string): RawFiling {
  const resolved = resolve(filePath);
  const html = readFileSync(resolved, 'utf-8');
  const filename = basename(resolved);
  return {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-01'),
    primaryDocumentFilename: filename,
    html,
    fetchedAt: Temporal.Now.instant(),
  };
}

const FIXTURES_DIR = 'libs/edgar-diff-lib/tests/integration/fixtures';

/** Resolve a fixture path relative to the repo root. */
export function fixturePath(filename: string): string {
  return `${FIXTURES_DIR}/${filename}`;
}

/**
 * Parse CLI args for old/new filing paths. Returns [oldPath, newPath].
 * Falls back to provided defaults if no args given.
 */
export function parseFilingArgs(
  defaultOld: string,
  defaultNew: string,
): [string, string] {
  const args = process.argv.slice(2);
  if (args.length >= 2) {
    return [args[0], args[1]];
  }
  if (args.length === 1) {
    console.error('Usage: npx tsx <script> <old.html> <new.html>');
    console.error('  Both file paths are required, or omit both for defaults.');
    process.exit(1);
  }
  return [defaultOld, defaultNew];
}
