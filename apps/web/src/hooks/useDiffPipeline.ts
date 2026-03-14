import { useState, useEffect, useRef } from 'react';
import { parseFiling, diffFilings, EdgarNetworkError } from '@edgar-diff/lib';
import type { RawFiling, StructuredDocument, StructuredDiff } from '@edgar-diff/lib';
import { createProxiedEdgarClient } from '../services/edgar-client-factory';
import type { PipelineStatus } from '../services/types';

type CacheKey = `${string}:${string}`;

function makeCacheKey(a: string, b: string): CacheKey {
  return `${a}:${b}`;
}

interface DiffCacheEntry {
  oldDocument: StructuredDocument;
  newDocument: StructuredDocument;
  diff: StructuredDiff;
}

export interface UseDiffPipelineReturn {
  status: PipelineStatus;
  error: string | null;
  oldDocument: StructuredDocument | null;
  newDocument: StructuredDocument | null;
  diff: StructuredDiff | null;
}

export function useDiffPipeline(
  filingA: string | null,
  filingB: string | null,
): UseDiffPipelineReturn {
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [oldDocument, setOldDocument] = useState<StructuredDocument | null>(null);
  const [newDocument, setNewDocument] = useState<StructuredDocument | null>(null);
  const [diff, setDiff] = useState<StructuredDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Caches persist across renders (but not across unmounts)
  const filingCache = useRef(new Map<string, RawFiling>());
  const documentCache = useRef(new Map<string, StructuredDocument>());
  const diffCache = useRef(new Map<CacheKey, DiffCacheEntry>());

  // Stable client reference (create once, reuse)
  const clientRef = useRef(createProxiedEdgarClient());

  useEffect(() => {
    // Reset if either filing is deselected
    if (!filingA || !filingB) {
      setStatus('idle');
      setOldDocument(null);
      setNewDocument(null);
      setDiff(null);
      setError(null);
      return;
    }

    const cacheKey = makeCacheKey(filingA, filingB);

    // Check diff cache first
    const cached = diffCache.current.get(cacheKey);
    if (cached) {
      setOldDocument(cached.oldDocument);
      setNewDocument(cached.newDocument);
      setDiff(cached.diff);
      setStatus('done');
      setError(null);
      return;
    }

    // Abort any in-flight pipeline
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Run pipeline
    const runPipeline = async () => {
      const signal = controller.signal;
      const client = clientRef.current;

      // === FETCH STAGE ===
      setStatus('fetching');
      setError(null);
      setOldDocument(null);
      setNewDocument(null);
      setDiff(null);

      let rawA: RawFiling, rawB: RawFiling;
      try {
        const fetchOne = async (acc: string): Promise<RawFiling> => {
          const c = filingCache.current.get(acc);
          if (c) return c;
          const raw = await client.fetchFiling(acc);
          if (!signal.aborted) filingCache.current.set(acc, raw);
          return raw;
        };

        [rawA, rawB] = await Promise.all([fetchOne(filingA), fetchOne(filingB)]);
      } catch (err: unknown) {
        if (signal.aborted) return;
        setStatus('error');
        setError(classifyFetchError(err));
        return;
      }
      if (signal.aborted) return;

      // === PARSE STAGE ===
      setStatus('parsing');

      let docA: StructuredDocument, docB: StructuredDocument;
      try {
        const parseOne = (raw: RawFiling): StructuredDocument => {
          const c = documentCache.current.get(raw.accessionNumber);
          if (c) return c;
          const doc = parseFiling(raw);
          documentCache.current.set(raw.accessionNumber, doc);
          return doc;
        };

        docA = parseOne(rawA);
        docB = parseOne(rawB);
      } catch {
        if (signal.aborted) return;
        setStatus('error');
        setError('Unable to parse filing');
        return;
      }
      if (signal.aborted) return;

      // === DIFF STAGE ===
      setStatus('diffing');

      let diffResult: StructuredDiff;
      try {
        diffResult = diffFilings(docA, docB);
      } catch {
        if (signal.aborted) return;
        setStatus('error');
        setError('Unable to compute diff');
        return;
      }
      if (signal.aborted) return;

      // === DONE ===
      const entry: DiffCacheEntry = {
        oldDocument: docA,
        newDocument: docB,
        diff: diffResult,
      };
      diffCache.current.set(cacheKey, entry);
      setOldDocument(docA);
      setNewDocument(docB);
      setDiff(diffResult);
      setStatus('done');
    };

    runPipeline();

    return () => {
      controller.abort();
    };
  }, [filingA, filingB]);

  // Cleanup client on unmount
  useEffect(() => {
    return () => {
      clientRef.current.dispose();
    };
  }, []);

  return { status, error, oldDocument, newDocument, diff };
}

/**
 * Map fetch errors to user-friendly messages.
 * Uses instanceof EdgarNetworkError for reliable status code detection.
 */
export function classifyFetchError(err: unknown): string {
  if (err instanceof EdgarNetworkError) {
    if (err.statusCode === 404) return 'Filing not available';
    if (err.statusCode === 429) return 'SEC rate limit exceeded. Please wait and try again.';
    return 'SEC service temporarily unavailable';
  }

  if (err instanceof TypeError) {
    return 'Unable to fetch filing. Check your connection.';
  }

  return 'Unable to fetch filing';
}
