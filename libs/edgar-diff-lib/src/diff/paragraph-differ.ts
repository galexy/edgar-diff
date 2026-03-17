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
const SENTENCE_MATCH_THRESHOLD = 0.7;
const QUALITY_GATE_THRESHOLD = 0.70;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Sentence-level helpers (two-pass diffing) ───────────────────────

interface Sentence {
  text: string;   // trimmed sentence text
  start: number;  // offset of text within the parent string
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr',
  'inc', 'corp', 'ltd', 'co', 'llc',
  'vs', 'etc', 'no', 'vol', 'dept', 'est', 'approx',
  'govt', 'st', 'ave', 'blvd', 'rd',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'gen', 'gov', 'rep', 'sen',
]);

/** Split text into sentences with their character offsets in the original string. */
function splitSentences(text: string): Sentence[] {
  if (text.trim().length === 0) return [];

  const boundaries: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Must be followed by whitespace or end of string
    if (i < text.length - 1 && !/\s/.test(text[i + 1])) continue;

    if (ch === '.') {
      // Find the alphabetic word immediately before the dot
      let wordStart = i - 1;
      while (wordStart >= 0 && /[a-zA-Z]/.test(text[wordStart])) wordStart--;
      wordStart++;

      if (wordStart < i) {
        const word = text.slice(wordStart, i).toLowerCase();
        // Single letter abbreviation (e.g., "U." in "U.S.")
        if (word.length === 1) continue;
        // Known abbreviation
        if (ABBREVIATIONS.has(word)) continue;
      }
    }

    boundaries.push(i);
  }

  if (boundaries.length === 0) {
    const trimmed = text.trim();
    const leadingWs = text.length - text.trimStart().length;
    return [{ text: trimmed, start: leadingWs }];
  }

  const sentences: Sentence[] = [];
  let segStart = 0;

  for (const bPos of boundaries) {
    const raw = text.slice(segStart, bPos + 1);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingWs = raw.length - raw.trimStart().length;
      sentences.push({ text: trimmed, start: segStart + leadingWs });
    }
    // Next segment starts after the punctuation + any whitespace
    let next = bPos + 1;
    while (next < text.length && /\s/.test(text[next])) next++;
    segStart = next;
  }

  // Remaining text after last boundary
  if (segStart < text.length) {
    const raw = text.slice(segStart);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingWs = raw.length - raw.trimStart().length;
      sentences.push({ text: trimmed, start: segStart + leadingWs });
    }
  }

  return sentences;
}

interface SentenceMatchResult {
  matched: Array<{ oldSent: Sentence; newSent: Sentence }>;
  unmatchedOld: Sentence[];
  unmatchedNew: Sentence[];
}

/** Greedy-match old and new sentences by Jaro-Winkler similarity. */
function matchSentences(oldSentences: Sentence[], newSentences: Sentence[]): SentenceMatchResult {
  const pairs: Array<{ oi: number; ni: number; sim: number }> = [];

  for (let oi = 0; oi < oldSentences.length; oi++) {
    for (let ni = 0; ni < newSentences.length; ni++) {
      const sim = jaroWinkler(oldSentences[oi].text, newSentences[ni].text);
      if (sim >= SENTENCE_MATCH_THRESHOLD) {
        pairs.push({ oi, ni, sim });
      }
    }
  }

  pairs.sort((a, b) => b.sim - a.sim);

  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const matched: Array<{ oldSent: Sentence; newSent: Sentence }> = [];

  for (const { oi, ni } of pairs) {
    if (usedOld.has(oi) || usedNew.has(ni)) continue;
    usedOld.add(oi);
    usedNew.add(ni);
    matched.push({ oldSent: oldSentences[oi], newSent: newSentences[ni] });
  }

  const unmatchedOld = oldSentences.filter((_, i) => !usedOld.has(i));
  const unmatchedNew = newSentences.filter((_, i) => !usedNew.has(i));

  return { matched, unmatchedOld, unmatchedNew };
}

// ── Word-change computation ─────────────────────────────────────────

interface DiffResult {
  changes: WordChange[];
  removedChars: number;
}

/** Build word changes using direct single-pass diffWords (no quality gate). */
function buildDirectResult(oldText: string, newText: string): DiffResult {
  const raw = diffWords(oldText, newText);
  const changes: WordChange[] = [];
  let oldPos = 0;
  let newPos = 0;
  let removedChars = 0;

  for (const c of raw) {
    const len = c.value.length;
    if (c.added) {
      changes.push({ type: 'added', start: newPos, end: newPos + len });
      newPos += len;
    } else if (c.removed) {
      changes.push({ type: 'removed', start: oldPos, end: oldPos + len });
      oldPos += len;
      removedChars += len;
    } else {
      oldPos += len;
      newPos += len;
    }
  }

  return { changes, removedChars };
}

/** Build word changes using two-pass sentence-then-word approach (no quality gate). */
function buildTwoPassResult(oldSentences: Sentence[], newSentences: Sentence[]): DiffResult {
  const { matched, unmatchedOld, unmatchedNew } = matchSentences(oldSentences, newSentences);
  const changes: WordChange[] = [];
  let removedChars = 0;

  // Unmatched old sentences → fully removed
  for (const sent of unmatchedOld) {
    const len = sent.text.length;
    changes.push({ type: 'removed', start: sent.start, end: sent.start + len });
    removedChars += len;
  }

  // Unmatched new sentences → fully added
  for (const sent of unmatchedNew) {
    changes.push({ type: 'added', start: sent.start, end: sent.start + sent.text.length });
  }

  // Matched sentence pairs → word-level diff within each pair
  for (const { oldSent, newSent } of matched) {
    const raw = diffWords(oldSent.text, newSent.text);
    let oldPos = 0;
    let newPos = 0;

    for (const c of raw) {
      const len = c.value.length;
      if (c.added) {
        changes.push({
          type: 'added',
          start: newSent.start + newPos,
          end: newSent.start + newPos + len,
        });
        newPos += len;
      } else if (c.removed) {
        changes.push({
          type: 'removed',
          start: oldSent.start + oldPos,
          end: oldSent.start + oldPos + len,
        });
        oldPos += len;
        removedChars += len;
      } else {
        oldPos += len;
        newPos += len;
      }
    }
  }

  return { changes, removedChars };
}

/**
 * Two-pass sentence-then-word diffing with best-of-both fallback.
 *
 * Pass 1: Split into sentences and match by Jaro-Winkler similarity.
 * Pass 2: Run diffWords within each matched sentence pair.
 *
 * Compares the two-pass result against direct diffWords and picks whichever
 * has lower removedCoverage. This ensures the two-pass approach never
 * produces worse results than the baseline.
 *
 * Quality gate still applies as a safety net.
 */
function computeWordChanges(oldText: string, newText: string): WordChange[] {
  const oldSentences = splitSentences(oldText);
  const newSentences = splitSentences(newText);

  // Single-sentence (or no-sentence) on both sides → direct diffWords only
  if (oldSentences.length <= 1 && newSentences.length <= 1) {
    const { changes, removedChars } = buildDirectResult(oldText, newText);
    if (oldText.length > 0 && removedChars / oldText.length > QUALITY_GATE_THRESHOLD) {
      return [];
    }
    return changes;
  }

  // Try both approaches, pick the one with lower removedCoverage
  const direct = buildDirectResult(oldText, newText);
  const twoPass = buildTwoPassResult(oldSentences, newSentences);
  const best = twoPass.removedChars <= direct.removedChars ? twoPass : direct;

  // Quality gate safety net
  if (oldText.length > 0 && best.removedChars / oldText.length > QUALITY_GATE_THRESHOLD) {
    return [];
  }

  return best.changes;
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
