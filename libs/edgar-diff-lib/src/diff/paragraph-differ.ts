import { diffArrays, diffWords } from 'diff';
import jaroWinkler from 'jaro-winkler';
import type { ContentBlock, Paragraph } from '../types.js';
import type { SectionMatch } from './section-aligner.js';
import type { ParagraphDiff, WordChange } from './types.js';

/** Internal type that carries paragraph references through the pipeline. Stripped at the boundary. */
interface InternalParagraphDiff extends ParagraphDiff {
  _oldParagraph?: Paragraph;
  _newParagraph?: Paragraph;
}

const MOVE_THRESHOLD = 0.9;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function computeWordChanges(oldText: string, newText: string): WordChange[] {
  const changes = diffWords(oldText, newText);
  const result: WordChange[] = [];
  let oldPos = 0;
  let newPos = 0;

  for (const c of changes) {
    const len = c.value.length;
    if (c.added) {
      result.push({ type: 'added', start: newPos, end: newPos + len });
      newPos += len;
    } else if (c.removed) {
      result.push({ type: 'removed', start: oldPos, end: oldPos + len });
      oldPos += len;
    } else {
      oldPos += len;
      newPos += len;
    }
  }

  return result;
}

function extractParagraphs(blocks: ContentBlock[]): Paragraph[] {
  return blocks.filter((b): b is Paragraph => b.type === 'paragraph');
}

function diffParagraphPair(
  oldParagraphs: Paragraph[],
  newParagraphs: Paragraph[],
): InternalParagraphDiff[] {
  if (oldParagraphs.length === 0 && newParagraphs.length === 0) return [];

  const oldNormalized = oldParagraphs.map(p => normalizeText(p.text));
  const newNormalized = newParagraphs.map(p => normalizeText(p.text));

  const result = diffArrays(oldNormalized, newNormalized);

  const changes: InternalParagraphDiff[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (const hunk of result) {
    const count = hunk.count ?? 0;
    if (!hunk.added && !hunk.removed) {
      for (let i = 0; i < count; i++) {
        changes.push({
          changeType: 'unchanged',
          _oldParagraph: oldParagraphs[oldIdx],
          _newParagraph: newParagraphs[newIdx],
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
          _oldParagraph: oldParagraphs[oldIdx],
          sourceMapping: { old: oldParagraphs[oldIdx].source },
        });
        oldIdx++;
      }
    } else if (hunk.added && !hunk.removed) {
      for (let i = 0; i < count; i++) {
        changes.push({
          changeType: 'added',
          _newParagraph: newParagraphs[newIdx],
          sourceMapping: { new: newParagraphs[newIdx].source },
        });
        newIdx++;
      }
    }
  }

  const paired = pairRemovedAdded(changes);
  return detectMoves(paired);
}

function pairRemovedAdded(changes: InternalParagraphDiff[]): InternalParagraphDiff[] {
  const result: InternalParagraphDiff[] = [];
  let i = 0;
  while (i < changes.length) {
    if (
      changes[i].changeType === 'removed' &&
      i + 1 < changes.length &&
      changes[i + 1].changeType === 'added'
    ) {
      const oldPara = changes[i]._oldParagraph;
      const newPara = changes[i + 1]._newParagraph;
      if (!oldPara || !newPara) { i++; continue; }
      const oldText = oldPara.text;
      const newText = newPara.text;
      result.push({
        changeType: 'modified',
        _oldParagraph: oldPara,
        _newParagraph: newPara,
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

function detectMoves(changes: InternalParagraphDiff[]): InternalParagraphDiff[] {
  const removedIndices: number[] = [];
  const addedIndices: number[] = [];

  for (let i = 0; i < changes.length; i++) {
    if (changes[i].changeType === 'removed') removedIndices.push(i);
    else if (changes[i].changeType === 'added') addedIndices.push(i);
  }

  if (removedIndices.length === 0 || addedIndices.length === 0) return changes;

  // Pre-compute normalized text for all candidates (avoids redundant normalizeText calls)
  const removedNorms = new Map<number, string>();
  for (const ri of removedIndices) {
    const p = changes[ri]._oldParagraph;
    if (p) removedNorms.set(ri, normalizeText(p.text));
  }
  const addedNorms = new Map<number, string>();
  for (const ai of addedIndices) {
    const p = changes[ai]._newParagraph;
    if (p) addedNorms.set(ai, normalizeText(p.text));
  }

  const usedRemoved = new Set<number>();
  const usedAdded = new Set<number>();
  const result = [...changes];

  // Phase 1: Exact-match hash pass — O(n) instead of O(n²)
  const addedByText = new Map<string, number[]>();
  for (const [ai, norm] of addedNorms) {
    const list = addedByText.get(norm);
    if (list) list.push(ai);
    else addedByText.set(norm, [ai]);
  }
  for (const ri of removedIndices) {
    const rNorm = removedNorms.get(ri);
    if (!rNorm) continue;
    const candidates = addedByText.get(rNorm);
    if (!candidates) continue;
    for (const ai of candidates) {
      if (usedAdded.has(ai)) continue;
      usedRemoved.add(ri);
      usedAdded.add(ai);
      const oldPara = changes[ri]._oldParagraph!;
      const newPara = changes[ai]._newParagraph!;
      const movedEntry: InternalParagraphDiff = {
        changeType: 'moved',
        _oldParagraph: oldPara,
        _newParagraph: newPara,
        sourceMapping: { old: oldPara.source, new: newPara.source },
      };
      result[ri] = movedEntry;
      result[ai] = movedEntry;
      break;
    }
  }

  // Phase 2: Jaro-Winkler fuzzy matching on remaining unmatched items
  const remainingRemoved = removedIndices.filter(ri => !usedRemoved.has(ri) && removedNorms.has(ri));
  const remainingAdded = addedIndices.filter(ai => !usedAdded.has(ai) && addedNorms.has(ai));

  if (remainingRemoved.length > 0 && remainingAdded.length > 0) {
    // Pre-compute word sets for cheap overlap pre-filter on long texts
    const WORD_FILTER_MIN_LEN = 100;
    const removedWordSets = new Map<number, Set<string>>();
    const addedWordSets = new Map<number, Set<string>>();
    for (const ri of remainingRemoved) {
      const norm = removedNorms.get(ri)!;
      if (norm.length >= WORD_FILTER_MIN_LEN) {
        removedWordSets.set(ri, new Set(norm.split(' ')));
      }
    }
    for (const ai of remainingAdded) {
      const norm = addedNorms.get(ai)!;
      if (norm.length >= WORD_FILTER_MIN_LEN) {
        addedWordSets.set(ai, new Set(norm.split(' ')));
      }
    }

    const pairs: { removedIdx: number; addedIdx: number; similarity: number }[] = [];

    for (const ri of remainingRemoved) {
      const rNorm = removedNorms.get(ri)!;
      const rLen = rNorm.length;
      const rWords = removedWordSets.get(ri);
      for (const ai of remainingAdded) {
        const aNorm = addedNorms.get(ai)!;
        const aLen = aNorm.length;
        // Length-ratio filter
        const shorter = rLen < aLen ? rLen : aLen;
        const longer = rLen < aLen ? aLen : rLen;
        if (shorter < longer * MOVE_THRESHOLD) continue;

        // Word-overlap pre-filter for longer texts: if less than 50% of words
        // overlap, JW similarity can't reach 0.9
        if (rWords) {
          const aWords = addedWordSets.get(ai);
          if (aWords) {
            const smaller = rWords.size < aWords.size ? rWords : aWords;
            const larger = rWords.size < aWords.size ? aWords : rWords;
            let overlap = 0;
            for (const w of smaller) {
              if (larger.has(w)) overlap++;
            }
            if (overlap < smaller.size * 0.5) continue;
          }
        }

        const sim = jaroWinkler(rNorm, aNorm);
        if (sim >= MOVE_THRESHOLD) {
          pairs.push({ removedIdx: ri, addedIdx: ai, similarity: sim });
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);

    for (const pair of pairs) {
      if (usedRemoved.has(pair.removedIdx) || usedAdded.has(pair.addedIdx)) continue;
      usedRemoved.add(pair.removedIdx);
      usedAdded.add(pair.addedIdx);

      const oldPara = changes[pair.removedIdx]._oldParagraph!;
      const newPara = changes[pair.addedIdx]._newParagraph!;
      const rNorm = removedNorms.get(pair.removedIdx)!;
      const aNorm = addedNorms.get(pair.addedIdx)!;

      const movedEntry: InternalParagraphDiff = {
        changeType: 'moved',
        _oldParagraph: oldPara,
        _newParagraph: newPara,
        sourceMapping: { old: oldPara.source, new: newPara.source },
      };
      if (rNorm !== aNorm) {
        movedEntry.wordChanges = computeWordChanges(oldPara.text, newPara.text);
      }

      result[pair.removedIdx] = movedEntry;
      result[pair.addedIdx] = movedEntry;
    }
  }

  // Filter out added entries that were paired into moved entries above.
  // Each moved entry already carries both old and new source locations.
  return result.filter((_, i) => !usedAdded.has(i));
}

/** Compute paragraph-level diffs for a matched section pair. */
export function diffParagraphs(match: SectionMatch): ParagraphDiff[] {
  const oldParagraphs = extractParagraphs(match.oldSection.blocks);
  const newParagraphs = extractParagraphs(match.newSection.blocks);
  const internal = diffParagraphPair(oldParagraphs, newParagraphs);
  // Strip internal fields (BQ6: computeWordChanges already omits unchanged spans)
  return internal.map(({ _oldParagraph, _newParagraph, ...diff }) => diff);
}
