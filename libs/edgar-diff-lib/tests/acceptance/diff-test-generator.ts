import type { Paragraph, FilingSection, ContentBlock } from '../../src/types.js';
import { makeParagraph, makeSection, makeTable } from '../helpers/diff-fixtures.js';

const WORDS = [
  'Revenue', 'grew', 'declined', 'increased', 'decreased', 'stable',
  'the', 'company', 'reported', 'significant', 'growth', 'risk',
  'factors', 'include', 'competition', 'regulatory', 'changes',
  'fiscal', 'year', 'ended', 'operations', 'management', 'discussion',
  'financial', 'statements', 'consolidated', 'assets', 'liabilities',
  'equity', 'cash', 'flow', 'net', 'income', 'operating', 'total',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomWord(): string {
  return WORDS[randomInt(0, WORDS.length - 1)];
}

function randomSentence(wordCount?: number): string {
  const count = wordCount ?? randomInt(3, 12);
  const words = Array.from({ length: count }, () => randomWord());
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ') + '.';
}

function randomText(sentenceCount?: number): string {
  const count = sentenceCount ?? randomInt(1, 5);
  return Array.from({ length: count }, () => randomSentence()).join(' ');
}

export interface ParagraphPair {
  base: Paragraph[];
  target: Paragraph[];
}

/**
 * Generate a random pair of Paragraph arrays with controlled mutations.
 * Produces a base array and applies random additions, deletions,
 * modifications, and reorderings to create the target.
 */
export function generateParagraphPair(): ParagraphPair {
  const baseCount = randomInt(1, 15);
  let offset = 100;
  const base: Paragraph[] = [];
  for (let i = 0; i < baseCount; i++) {
    const text = randomText();
    base.push(makeParagraph(text, offset));
    offset += text.length + 20;
  }

  // Start target from a copy of base texts
  const targetTexts = base.map((p) => p.text);

  // Apply mutations
  const mutationCount = randomInt(0, Math.ceil(baseCount / 2));
  for (let m = 0; m < mutationCount; m++) {
    const action = randomInt(0, 3);
    switch (action) {
      case 0: {
        // Add a new paragraph
        const insertIdx = randomInt(0, targetTexts.length);
        targetTexts.splice(insertIdx, 0, randomText());
        break;
      }
      case 1: {
        // Delete a paragraph
        if (targetTexts.length > 0) {
          const delIdx = randomInt(0, targetTexts.length - 1);
          targetTexts.splice(delIdx, 1);
        }
        break;
      }
      case 2: {
        // Modify a paragraph (change some words)
        if (targetTexts.length > 0) {
          const modIdx = randomInt(0, targetTexts.length - 1);
          const words = targetTexts[modIdx].split(' ');
          const changeIdx = randomInt(0, Math.max(0, words.length - 1));
          words[changeIdx] = randomWord();
          targetTexts[modIdx] = words.join(' ');
        }
        break;
      }
      case 3: {
        // Swap two paragraphs (reorder)
        if (targetTexts.length >= 2) {
          const i1 = randomInt(0, targetTexts.length - 1);
          let i2 = randomInt(0, targetTexts.length - 1);
          while (i2 === i1) i2 = randomInt(0, targetTexts.length - 1);
          [targetTexts[i1], targetTexts[i2]] = [targetTexts[i2], targetTexts[i1]];
        }
        break;
      }
    }
  }

  // Build target Paragraph[] with fresh offsets
  let targetOffset = 100;
  const target: Paragraph[] = targetTexts.map((text) => {
    const p = makeParagraph(text, targetOffset);
    targetOffset += text.length + 20;
    return p;
  });

  return { base, target };
}

export interface SectionPair {
  base: FilingSection;
  target: FilingSection;
}

/**
 * Generate a random pair of FilingSections with controlled mutations.
 */
export function generateSectionPair(): SectionPair {
  const { base: baseParagraphs, target: targetParagraphs } = generateParagraphPair();

  // Optionally add tables
  const baseBlocks: ContentBlock[] = [...baseParagraphs];
  const targetBlocks: ContentBlock[] = [...targetParagraphs];

  if (Math.random() < 0.3 && baseBlocks.length > 0) {
    const lastEnd = baseBlocks[baseBlocks.length - 1].source.end;
    baseBlocks.push(makeTable([['Revenue', '$100M'], ['Expenses', '$80M']], lastEnd + 10));
  }
  if (Math.random() < 0.3 && targetBlocks.length > 0) {
    const lastEnd = targetBlocks[targetBlocks.length - 1].source.end;
    targetBlocks.push(makeTable([['Revenue', '$120M'], ['Expenses', '$90M']], lastEnd + 10));
  }

  const headingBase = `Item ${randomInt(1, 15)}. ${randomSentence(3)}`;
  // Target heading: sometimes identical, sometimes slightly different
  const headingTarget = Math.random() < 0.7
    ? headingBase
    : headingBase.replace(/\.$/, '') + ' Updated.';

  const sectionId = `item-${randomInt(1, 15)}`;

  return {
    base: makeSection(sectionId, headingBase, baseBlocks),
    target: makeSection(sectionId, headingTarget, targetBlocks),
  };
}
