import { useState, useCallback, useEffect, useRef } from 'react';
import type { Company, CompanyMatch, SearchStatus } from '../services/types';
import { searchCompanies } from '../services/company-resolver';
import { fetchCompanySubmissions } from '../services/sec-submissions';
import { useDebouncedValue } from './use-debounced-value';

export interface UseCompanySearchReturn {
  query: string;
  setQuery: (q: string) => void;
  status: SearchStatus;
  matches: CompanyMatch[];
  selectedCompany: Company | null;
  error: string | null;
  selectMatch: (match: CompanyMatch) => void;
  clear: () => void;
}

export function useCompanySearch(): UseCompanySearchReturn {
  const [query, setQueryRaw] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [matches, setMatches] = useState<CompanyMatch[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebouncedValue(query, 300);
  const abortRef = useRef<AbortController | null>(null);
  const selectVersionRef = useRef(0);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setSelectedCompany(null);
    setError(null);
    setStatus('idle');
  }, []);

  // Search effect — fires when debounced query changes
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      return;
    }

    let cancelled = false;
    setStatus('searching');

    searchCompanies(trimmed).then(
      (results) => {
        if (!cancelled) {
          setMatches(results);
          setStatus('idle');
        }
      },
      () => {
        if (!cancelled) {
          setMatches([]);
          setStatus('idle');
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const selectMatch = useCallback((match: CompanyMatch) => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const version = ++selectVersionRef.current;
    setStatus('searching');
    setError(null);

    fetchCompanySubmissions(match.cik, controller.signal).then(
      (company) => {
        if (selectVersionRef.current === version) {
          setSelectedCompany(company);
          setStatus('resolved');
          setMatches([]);
        }
      },
      (err: unknown) => {
        // Silently ignore AbortError
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (selectVersionRef.current === version) {
          setSelectedCompany(null);
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Unexpected error');
        }
      },
    );
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    selectVersionRef.current++;
    setQueryRaw('');
    setMatches([]);
    setSelectedCompany(null);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    query,
    setQuery,
    status,
    matches,
    selectedCompany,
    error,
    selectMatch,
    clear,
  };
}
