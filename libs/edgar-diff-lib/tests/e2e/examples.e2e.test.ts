import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

// tests/e2e/ → tests/ → edgar-diff-lib/ → libs/ → root
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const EXAMPLES_DIR = join(ROOT, 'examples');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

function runExample(scriptName: string): string {
  const scriptPath = join(EXAMPLES_DIR, scriptName);
  return execFileSync(TSX, [scriptPath], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: ROOT,
    maxBuffer: 100 * 1024 * 1024, // 100MB for large JSON output
  });
}

describe('example scripts smoke tests', () => {
  it('EX-1: diff-simple.ts runs without errors and produces output', () => {
    const stdout = runExample('diff-simple.ts');

    expect(stdout).toContain('diff-simple');
    expect(stdout).toContain('Summary:');
    expect(stdout).toContain('modified');
    expect(stdout).toContain('unchanged');
    expect(stdout).toContain('Sections:');
  }, 60_000);

  it('EX-2: diff-with-tables.ts runs without errors', () => {
    const stdout = runExample('diff-with-tables.ts');

    expect(stdout).toContain('diff-with-tables');
    expect(stdout).toContain('Table diffs:');
    expect(stdout).toContain('Cells changed:');
  }, 60_000);

  it('EX-3: diff-structural.ts runs without errors', () => {
    const stdout = runExample('diff-structural.ts');

    expect(stdout).toContain('diff-structural');
    expect(stdout).toContain('added');
    expect(stdout).toContain('removed');
    expect(stdout).toContain('Document structure:');
    expect(stdout).toContain('Section-by-section breakdown:');
  }, 60_000);

  it('EX-4: diff-to-json.ts produces valid JSON', () => {
    // diff-to-json writes status to stderr, JSON to stdout
    // Output can be ~50MB+ so we use spawnSync with large maxBuffer
    const result = spawnSync(TSX, [join(EXAMPLES_DIR, 'diff-to-json.ts')], {
      encoding: 'utf-8',
      timeout: 60_000,
      cwd: ROOT,
      maxBuffer: 100 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBeTruthy();

    // stdout should be valid JSON
    const parsed = JSON.parse(result.stdout);

    expect(parsed).toHaveProperty('sectionDiffs');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('generatedAt');
    expect(Array.isArray(parsed.sectionDiffs)).toBe(true);
    expect(typeof parsed.generatedAt).toBe('string');
  }, 60_000);
});
