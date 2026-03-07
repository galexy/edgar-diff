import { diffArrays, diffWords } from 'diff';
import jaroWinkler from 'jaro-winkler';
import type { ContentBlock, Paragraph } from '../types.js';
import type { SectionMatch } from './section-aligner.js';
import type { ParagraphDiff, WordChange } from './types.js';

const MOVE_THRESHOLD = 0.9;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function computeWordChanges(oldText: string, newText: string): WordChange[] {
  const changes = diffWords(oldText, newText);
  return changes.map(c => ({
    type: c.added ? 'added' : c.removed ? 'removed' : 'unchanged',
    value: c.value,
  }));
}

function extractParagraphs(blocks: ContentBlock[]): Paragraph[] {
  return blocks.filter((b): b is Paragraph => b.type === 'paragraph');
}

function diffParagraphPair(
  oldParagraphs: Paragraph[],
  newParagraphs: Paragraph[],
): ParagraphDiff[] {
  if (oldParagraphs.length === 0 && newParagraphs.length === 0) return [];

  const oldNormalized = oldParagraphs.map(p => normalizeText(p.text));
  const newNormalized = newParagraphs.map(p => normalizeText(p.text));

  const result = diffArrays(oldNormalized, newNormalized);

  const changes: ParagraphDiff[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (const hunk of result) {
    const count = hunk.count ?? 0;
    if (!hunk.added && !hunk.removed) {
      for (let i = 0; i < count; i++) {
        changes.push({
          changeType: 'unchanged',
          oldParagraph: oldParagraphs[oldIdx],
          newParagraph: newParagraphs[newIdx],
          sourceMapping: {
            old: oldParagraphs[oldIdx].source,
            new: newParagraphs[newIdx].source,
          },
        });
        oldIdx++;
        newIdx++;
      }
    } else if (hunk.removed && !hunk.added) {
      for (let i = 0; i < count; i++) {
        changes.push({
          changeType: 'removed',
          oldParagraph: oldParagraphs[oldIdx],
          sourceMapping: { old: oldParagraphs[oldIdx].source },
        });
        oldIdx++;
      }
    } else if (hunk.added && !hunk.removed) {
      for (let i = 0; i < count; i++) {
        changes.push({
          changeType: 'added',
          newParagraph: newParagraphs[newIdx],
          sourceMapping: { new: newParagraphs[newIdx].source },
        });
        newIdx++;
      }
    }
  }

  const paired = pairRemovedAdded(changes);
  return detectMoves(paired);
}

function pairRemovedAdded(changes: ParagraphDiff[]): ParagraphDiff[] {
  const result: ParagraphDiff[] = [];
  let i = 0;
  while (i < changes.length) {
    if (
      changes[i].changeType === 'removed' &&
      i + 1 < changes.length &&
      changes[i + 1].changeType === 'added'
    ) {
      const oldPara = changes[i].oldParagraph;
      const newPara = changes[i + 1].newParagraph;
      if (!oldPara || !newPara) { i++; continue; }
      const oldText = oldPara.text;
      const newText = newPara.text;
      result.push({
        changeType: 'modified',
        oldParagraph: changes[i].oldParagraph,
        newParagraph: changes[i + 1].newParagraph,
        wordChanges: computeWordChanges(oldText, newText),
        sourceMapping: {
          old: changes[i].sourceMapping.old,
          new: changes[i + 1].sourceMapping.new,
        },
      });
      i += 2;
    } else {
      result.push(changes[i]);
      i++;
    }
  }
  return result;
}

function detectMoves(changes: ParagraphDiff[]): ParagraphDiff[] {
  const removedIndices: number[] = [];
  const addedIndices: number[] = [];

  for (let i = 0; i < changes.length; i++) {
    if (changes[i].changeType === 'removed') removedIndices.push(i);
    else if (changes[i].changeType === 'added') addedIndices.push(i);
  }

  if (removedIndices.length === 0 || addedIndices.length === 0) return changes;

  const pairs: { removedIdx: number; addedIdx: number; similarity: number }[] = [];
  for (const ri of removedIndices) {
    const oldP = changes[ri].oldParagraph;
    if (!oldP) continue;
    const rNorm = normalizeText(oldP.text);
    for (const ai of addedIndices) {
      const newP = changes[ai].newParagraph;
      if (!newP) continue;
      const aNorm = normalizeText(newP.text);
      const sim = rNorm === aNorm ? 1.0 : jaroWinkler(rNorm, aNorm);
      if (sim >= MOVE_THRESHOLD) {
        pairs.push({ removedIdx: ri, addedIdx: ai, similarity: sim });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);
  const usedRemoved = new Set<number>();
  const usedAdded = new Set<number>();
  const result = [...changes];

  for (const pair of pairs) {
    if (usedRemoved.has(pair.removedIdx) || usedAdded.has(pair.addedIdx)) continue;
    usedRemoved.add(pair.removedIdx);
    usedAdded.add(pair.addedIdx);

    const oldPara = changes[pair.removedIdx].oldParagraph;
    const newPara = changes[pair.addedIdx].newParagraph;
    if (!oldPara || !newPara) continue;
    const isExact = normalizeText(oldPara.text) === normalizeText(newPara.text);

    const movedEntry: ParagraphDiff = {
      changeType: 'moved',
      oldParagraph: oldPara,
      newParagraph: newPara,
      sourceMapping: { old: oldPara.source, new: newPara.source },
    };
    if (!isExact) {
      movedEntry.wordChanges = computeWordChanges(oldPara.text, newPara.text);
    }

    result[pair.removedIdx] = movedEntry;
    result[pair.addedIdx] = movedEntry;
  }

  // Filter out added entries that were paired into moved entries above.
  // Each moved entry already carries both old and new source locations.
  return result.filter((_, i) => !usedAdded.has(i));
}

/** Compute paragraph-level diffs for a matched section pair. */
export function diffParagraphs(match: SectionMatch): ParagraphDiff[] {
  const oldParagraphs = extractParagraphs(match.oldSection.blocks);
  const newParagraphs = extractParagraphs(match.newSection.blocks);
  return diffParagraphPair(oldParagraphs, newParagraphs);
}
