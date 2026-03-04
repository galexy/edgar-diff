/**
 * Spike A1 — Task 2: Parse and validate htmlparser2 source mapping offsets.
 *
 * Usage: npx tsx spikes/source-mapping/parse-validate.ts
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'htmlparser2';
import type { Document, Element, ChildNode } from 'domhandler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// Section headings we're looking for in a 10-K
const SECTION_PATTERNS = [
  { label: 'Item 1 ', pattern: /\bItem\s+1[\.\s]/i },
  { label: 'Item 1A', pattern: /\bItem\s+1A\b/i },
  { label: 'Item 7 ', pattern: /\bItem\s+7[\.\s]/i },
  { label: 'Item 7A', pattern: /\bItem\s+7A\b/i },
  { label: 'Item 8 ', pattern: /\bItem\s+8[\.\s]/i },
];

interface SectionHit {
  label: string;
  tag: string;
  startIndex: number;
  endIndex: number;
  expectedSnippet: string;
  actualSlice: string;
  pass: boolean;
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function getTextContent(node: ChildNode): string {
  if (node.type === 'text') return node.data;
  if (isElement(node)) return node.children.map(getTextContent).join('');
  return '';
}

/**
 * Walk DOM tree depth-first, find heading-like elements matching section patterns.
 */
function findSectionBoundaries(doc: Document, html: string): SectionHit[] {
  const hits: SectionHit[] = [];
  const foundLabels = new Set<string>();

  const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'span', 'p', 'div', 'a']);

  function walk(node: ChildNode): void {
    if (isElement(node) && headingTags.has(node.tagName.toLowerCase())) {
      const text = getTextContent(node).trim();
      for (const sec of SECTION_PATTERNS) {
        if (foundLabels.has(sec.label)) continue;
        if (sec.pattern.test(text)) {
          const si = node.startIndex ?? -1;
          const ei = node.endIndex ?? -1;

          // htmlparser2 endIndex points directly after the last character
          // so slice(startIndex, endIndex + 1) captures the full element
          const actualSlice = si >= 0 && ei >= 0 ? html.slice(si, ei + 1) : '<no indices>';

          // Check that the slice contains the expected text
          const pass = actualSlice.includes(text.slice(0, 20));

          hits.push({
            label: sec.label,
            tag: node.tagName,
            startIndex: si,
            endIndex: ei,
            expectedSnippet: text.slice(0, 60),
            actualSlice: actualSlice.slice(0, 120),
            pass,
          });
          foundLabels.add(sec.label);
          break;
        }
      }
    }

    if (isElement(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const child of doc.children) {
    walk(child);
  }

  return hits;
}

/**
 * Validate that all nodes in the tree have valid startIndex/endIndex.
 */
function validateAllIndices(doc: Document, htmlLength: number): { total: number; valid: number; invalid: number; missing: number } {
  let total = 0;
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  function walk(node: ChildNode): void {
    total++;
    const si = node.startIndex;
    const ei = node.endIndex;
    if (si == null || ei == null || si === -1 || ei === -1) {
      missing++;
    } else if (si < 0 || ei < 0 || si > htmlLength || ei > htmlLength) {
      invalid++;
    } else {
      valid++;
    }
    if (isElement(node)) {
      for (const child of node.children) walk(child);
    }
  }

  for (const child of doc.children) walk(child);
  return { total, valid, invalid, missing };
}

async function parseAndValidate(filePath: string, label: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Parsing: ${label}`);
  console.log('='.repeat(60));

  const html = await readFile(filePath, 'utf-8');
  console.log(`File size: ${html.length} chars (${(Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1)} KB bytes)`);

  const t0 = performance.now();
  const doc = parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
  });
  const parseMs = performance.now() - t0;
  console.log(`Parse time: ${parseMs.toFixed(2)} ms`);

  // Validate all indices
  const stats = validateAllIndices(doc, html.length);
  console.log(`\nIndex validation: ${stats.total} nodes total, ${stats.valid} valid, ${stats.invalid} invalid, ${stats.missing} missing`);

  // Find section boundaries (only for 10-K)
  if (label.includes('10-K')) {
    const hits = findSectionBoundaries(doc, html);
    console.log(`\nSection boundaries found: ${hits.length}/${SECTION_PATTERNS.length}`);
    for (const hit of hits) {
      const status = hit.pass ? '✓ PASS' : '✗ FAIL';
      console.log(`\n  ${status} — ${hit.label}`);
      console.log(`    Tag: <${hit.tag}>`);
      console.log(`    Indices: [${hit.startIndex}, ${hit.endIndex}]`);
      console.log(`    Expected text: "${hit.expectedSnippet}"`);
      console.log(`    Actual slice:  "${hit.actualSlice}"`);
    }
  }

  // Verify endIndex behavior: does slice(start, end) or slice(start, end+1) work?
  console.log('\n--- endIndex behavior test ---');
  // Find the first element node
  function findFirstElement(node: ChildNode): Element | null {
    if (isElement(node)) return node;
    return null;
  }
  for (const child of doc.children) {
    const el = findFirstElement(child);
    if (el && el.startIndex != null && el.endIndex != null) {
      const withoutPlus1 = html.slice(el.startIndex, el.endIndex);
      const withPlus1 = html.slice(el.startIndex, el.endIndex + 1);
      console.log(`  First element: <${el.tagName}>`);
      console.log(`  slice(start, end):   ends with "${withoutPlus1.slice(-20)}"`);
      console.log(`  slice(start, end+1): ends with "${withPlus1.slice(-20)}"`);
      // Check which one ends with the closing tag
      const closingTag = `</${el.tagName}>`;
      if (withoutPlus1.endsWith(closingTag)) {
        console.log(`  → slice(start, end) captures full element (endIndex is exclusive-ish)`);
      } else if (withPlus1.endsWith(closingTag)) {
        console.log(`  → slice(start, end+1) captures full element (endIndex is inclusive)`);
      } else {
        console.log(`  → Neither captures full closing tag cleanly`);
        console.log(`    withoutPlus1 last 40: "${withoutPlus1.slice(-40)}"`);
        console.log(`    withPlus1 last 40:    "${withPlus1.slice(-40)}"`);
      }
      break;
    }
  }

  // Character vs byte index test for multibyte
  if (label.includes('multibyte')) {
    console.log('\n--- Character vs byte index verification ---');
    function findNodeWithText(node: ChildNode, search: string): ChildNode | null {
      if (node.type === 'text' && node.data.includes(search)) return node;
      if (isElement(node)) {
        for (const child of node.children) {
          const found = findNodeWithText(child, search);
          if (found) return found;
        }
      }
      return null;
    }

    const rocketNode = findNodeWithText(doc.children[0]!, '🚀');
    if (rocketNode && rocketNode.startIndex != null && rocketNode.endIndex != null) {
      const slice = html.slice(rocketNode.startIndex, rocketNode.endIndex + 1);
      const charIdx = html.indexOf('🚀');
      const byteIdx = Buffer.byteLength(html.slice(0, charIdx), 'utf-8');
      console.log(`  '🚀' found at char index ${charIdx}, byte index ${byteIdx}`);
      console.log(`  Node startIndex: ${rocketNode.startIndex} (${rocketNode.startIndex === charIdx ? 'matches char index' : 'differs from char index'})`);
      console.log(`  Slice text: "${slice.slice(0, 60)}"`);
      console.log(`  → Indices are JS string (UTF-16 code unit) indices: ${rocketNode.startIndex <= charIdx + 5 ? 'CONFIRMED' : 'NEEDS INVESTIGATION'}`);
    }
  }
}

async function main(): Promise<void> {
  const appleFile = join(FIXTURES_DIR, 'apple-10k.html');
  const multibyteFile = join(FIXTURES_DIR, 'multibyte.html');

  await parseAndValidate(appleFile, 'Apple 10-K Filing');
  await parseAndValidate(multibyteFile, 'multibyte fixture');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
