/**
 * TF-IDF based section aligner.
 * Aligns sections between two 10-K filings using a hybrid score of
 * heading similarity and content similarity (TF-IDF cosine).
 */
import type { Section } from './section-extractor.js';

// ─── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'were',
  'are', 'been', 'has', 'had', 'have', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'this',
  'that', 'these', 'those', 'not', 'no', 'nor', 'so', 'if', 'then',
  'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
  'all', 'also', 'am', 'any', 'because', 'before', 'between', 'both',
  'each', 'few', 'further', 'here', 'how', 'into', 'its', 'more',
  'most', 'my', 'only', 'other', 'our', 'out', 'over', 'own', 'same',
  'she', 'he', 'some', 'such', 'there', 'their', 'them', 'through',
  'under', 'until', 'up', 'we', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'you', 'your',
]);

// ─── Tokenization ─────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

// ─── TF-IDF ───────────────────────────────────────────────────────────────────

export interface TfIdfVector {
  terms: Map<string, number>;
  magnitude: number;
}

/** Compute term frequency: count of each term / total terms */
export function computeTF(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const total = tokens.length;
  const tf = new Map<string, number>();
  for (const [term, count] of counts) {
    tf.set(term, count / total);
  }
  return tf;
}

/** Compute IDF across a corpus of documents (each doc is a token array) */
export function computeIDF(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const docFreq = new Map<string, number>();

  for (const doc of corpus) {
    const seen = new Set(doc);
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    // Standard IDF with smoothing: log((N + 1) / (df + 1)) + 1
    idf.set(term, Math.log((docCount + 1) / (df + 1)) + 1);
  }
  return idf;
}

/** Build a TF-IDF vector for a single document */
export function buildTfIdfVector(tf: Map<string, number>, idf: Map<string, number>): TfIdfVector {
  const terms = new Map<string, number>();
  let magnitudeSq = 0;

  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) || 0;
    const weight = tfVal * idfVal;
    if (weight > 0) {
      terms.set(term, weight);
      magnitudeSq += weight * weight;
    }
  }

  return { terms, magnitude: Math.sqrt(magnitudeSq) };
}

/** Cosine similarity between two TF-IDF vectors */
export function cosineSimilarity(a: TfIdfVector, b: TfIdfVector): number {
  if (a.magnitude === 0 || b.magnitude === 0) return 0;

  let dotProduct = 0;
  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = a.terms.size <= b.terms.size ? [a, b] : [b, a];
  for (const [term, weight] of smaller.terms) {
    const otherWeight = larger.terms.get(term);
    if (otherWeight !== undefined) {
      dotProduct += weight * otherWeight;
    }
  }

  return dotProduct / (a.magnitude * b.magnitude);
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

/** Normalized Levenshtein similarity: 1 - (editDistance / maxLength) */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const m = a.length;
  const n = b.length;

  // Use single-row optimization
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  const distance = prev[n];
  return 1 - distance / Math.max(m, n);
}

// ─── Section Alignment ───────────────────────────────────────────────────────

export interface AlignmentResult {
  matched: Array<{
    oldSection: Section;
    newSection: Section;
    similarity: number;
    headingSimilarity: number;
    contentSimilarity: number;
  }>;
  added: Section[];
  removed: Section[];
}

export interface AlignmentConfig {
  headingWeight: number;
  contentWeight: number;
  threshold: number;
}

export const DEFAULT_CONFIG: AlignmentConfig = {
  headingWeight: 0.4,
  contentWeight: 0.6,
  threshold: 0.3,
};

/**
 * Pre-computed similarity matrices for section alignment.
 * Allows running alignment with different weight configs without recomputing TF-IDF.
 */
export interface PrecomputedSimilarities {
  oldSections: Section[];
  newSections: Section[];
  headSimMatrix: number[][];
  contentSimMatrix: number[][];
}

/**
 * Pre-compute heading and content similarity matrices (expensive TF-IDF step).
 * Call this once, then use alignSectionsWithPrecomputed for different weight configs.
 */
export function precomputeSimilarities(
  oldSections: Section[],
  newSections: Section[],
): PrecomputedSimilarities {
  // Tokenize once and reuse for both IDF corpus and TF-IDF vectors
  const oldTokens = oldSections.map((s) => tokenize(s.content));
  const newTokens = newSections.map((s) => tokenize(s.content));
  const idf = computeIDF([...oldTokens, ...newTokens]);

  // Build vectors reusing cached tokens
  const oldVectors = oldTokens.map((tokens) => buildTfIdfVector(computeTF(tokens), idf));
  const newVectors = newTokens.map((tokens) => buildTfIdfVector(computeTF(tokens), idf));

  const headSimMatrix: number[][] = [];
  const contentSimMatrix: number[][] = [];

  for (let i = 0; i < oldSections.length; i++) {
    headSimMatrix[i] = [];
    contentSimMatrix[i] = [];
    for (let j = 0; j < newSections.length; j++) {
      headSimMatrix[i][j] = levenshteinSimilarity(
        oldSections[i].normalizedHeading,
        newSections[j].normalizedHeading,
      );
      contentSimMatrix[i][j] = cosineSimilarity(oldVectors[i], newVectors[j]);
    }
  }

  return { oldSections, newSections, headSimMatrix, contentSimMatrix };
}

/**
 * Run alignment using pre-computed similarity matrices and a given config.
 */
export function alignSectionsWithPrecomputed(
  pre: PrecomputedSimilarities,
  config: AlignmentConfig = DEFAULT_CONFIG,
): AlignmentResult {
  const { oldSections, newSections, headSimMatrix, contentSimMatrix } = pre;

  // Greedy best-match alignment
  const matched: AlignmentResult['matched'] = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  // Collect all pairs with hybrid scores and sort descending
  const pairs: Array<{ i: number; j: number; sim: number }> = [];
  for (let i = 0; i < oldSections.length; i++) {
    for (let j = 0; j < newSections.length; j++) {
      const hybrid = config.headingWeight * headSimMatrix[i][j] + config.contentWeight * contentSimMatrix[i][j];
      pairs.push({ i, j, sim: hybrid });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  for (const { i, j, sim } of pairs) {
    if (usedOld.has(i) || usedNew.has(j)) continue;
    if (sim < config.threshold) break;

    matched.push({
      oldSection: oldSections[i],
      newSection: newSections[j],
      similarity: sim,
      headingSimilarity: headSimMatrix[i][j],
      contentSimilarity: contentSimMatrix[i][j],
    });
    usedOld.add(i);
    usedNew.add(j);
  }

  // Sort matched by position in old filing
  matched.sort((a, b) => a.oldSection.startIndex - b.oldSection.startIndex);

  const added = newSections.filter((_, j) => !usedNew.has(j));
  const removed = oldSections.filter((_, i) => !usedOld.has(i));

  return { matched, added, removed };
}

/**
 * Align sections between old and new filings using hybrid heading + TF-IDF scoring.
 */
export function alignSections(
  oldSections: Section[],
  newSections: Section[],
  config: AlignmentConfig = DEFAULT_CONFIG,
): AlignmentResult {
  const pre = precomputeSimilarities(oldSections, newSections);
  return alignSectionsWithPrecomputed(pre, config);
}

/**
 * Heading-only alignment for comparison (no TF-IDF, just Levenshtein on headings).
 */
export function alignSectionsHeadingOnly(
  oldSections: Section[],
  newSections: Section[],
  threshold = 0.5,
): AlignmentResult {
  const matched: AlignmentResult['matched'] = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  const pairs: Array<{ i: number; j: number; sim: number }> = [];
  for (let i = 0; i < oldSections.length; i++) {
    for (let j = 0; j < newSections.length; j++) {
      const sim = levenshteinSimilarity(
        oldSections[i].normalizedHeading,
        newSections[j].normalizedHeading,
      );
      pairs.push({ i, j, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  for (const { i, j, sim } of pairs) {
    if (usedOld.has(i) || usedNew.has(j)) continue;
    if (sim < threshold) break;

    matched.push({
      oldSection: oldSections[i],
      newSection: newSections[j],
      similarity: sim,
      headingSimilarity: sim,
      contentSimilarity: 0,
    });
    usedOld.add(i);
    usedNew.add(j);
  }

  matched.sort((a, b) => a.oldSection.startIndex - b.oldSection.startIndex);

  const added = newSections.filter((_, j) => !usedNew.has(j));
  const removed = oldSections.filter((_, i) => !usedOld.has(i));

  return { matched, added, removed };
}
