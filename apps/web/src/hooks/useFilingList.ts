import { useState, useEffect, useRef } from 'react';
import type { Company, AvailableFiling, FilingListStatus } from '../services/types';
import { fetchFilingList } from '../services/filing-list';

export interface UseFilingListReturn {
  filings: AvailableFiling[];
  status: FilingListStatus;
  error: string | null;
}

export function useFilingList(company: Company | null): UseFilingListReturn {
  const [filings, setFilings] = useState<AvailableFiling[]>([]);
  const [status, setStatus] = useState<FilingListStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setFilings([]);
    setError(null);

    if (!company) {
      setStatus('idle');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');

    fetchFilingList(company.cik, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setFilings(result);
          setStatus('loaded');
        }
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Failed to load filings');
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [company]);

  return { filings, status, error };
}
