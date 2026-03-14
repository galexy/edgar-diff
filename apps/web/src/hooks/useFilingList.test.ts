import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Company, AvailableFiling } from '../services/types';

// Mock the filing-list service module
vi.mock('../services/filing-list', () => ({
  fetchFilingList: vi.fn(),
}));

import { useFilingList } from './useFilingList';
import { fetchFilingList } from '../services/filing-list';

const mockFetchFilingList = vi.mocked(fetchFilingList);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AAPL: Company = { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' };
const MSFT: Company = { cik: '0000789019', name: 'Microsoft Corporation', ticker: 'MSFT', exchange: 'Nasdaq' };

const SAMPLE_FILINGS: AvailableFiling[] = [
  { accessionNumber: '0000320193-23-000106', formType: '10-K', filingDate: '2023-11-03' },
  { accessionNumber: '0000320193-23-000077', formType: '10-Q', filingDate: '2023-08-04' },
];

beforeEach(() => {
  mockFetchFilingList.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useFilingList', () => {
  it('initial state (no company): idle with empty filings', () => {
    const { result } = renderHook(() => useFilingList(null));

    expect(result.current.filings).toEqual([]);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('company set → loading → loaded with filings', async () => {
    mockFetchFilingList.mockResolvedValue(SAMPLE_FILINGS);

    const { result } = renderHook(() => useFilingList(AAPL));

    // Should be loading initially
    expect(result.current.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.status).toBe('loaded');
    });

    expect(result.current.filings).toEqual(SAMPLE_FILINGS);
    expect(result.current.error).toBeNull();
  });

  it('fetch failure → error state', async () => {
    mockFetchFilingList.mockRejectedValue(new Error('Unable to load filings. Try again shortly.'));

    const { result } = renderHook(() => useFilingList(AAPL));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.filings).toEqual([]);
    expect(result.current.error).toBe('Unable to load filings. Try again shortly.');
  });

  it('company cleared → reset to idle', async () => {
    mockFetchFilingList.mockResolvedValue(SAMPLE_FILINGS);

    const { result, rerender } = renderHook(
      ({ company }) => useFilingList(company),
      { initialProps: { company: AAPL as Company | null } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('loaded');
    });

    // Clear company
    rerender({ company: null });

    expect(result.current.status).toBe('idle');
    expect(result.current.filings).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('company change → abort + reload', async () => {
    const aaplFilings = [SAMPLE_FILINGS[0]];
    const msftFilings = [{ accessionNumber: 'msft-001', formType: '10-K', filingDate: '2023-07-27' }];

    let resolveAapl: (value: AvailableFiling[]) => void;
    const aaplPromise = new Promise<AvailableFiling[]>((resolve) => { resolveAapl = resolve; });

    mockFetchFilingList
      .mockReturnValueOnce(aaplPromise)
      .mockResolvedValueOnce(msftFilings);

    const { result, rerender } = renderHook(
      ({ company }) => useFilingList(company),
      { initialProps: { company: AAPL as Company | null } },
    );

    expect(result.current.status).toBe('loading');

    // Change company before AAPL resolves
    rerender({ company: MSFT });

    // MSFT fetch should be called
    expect(mockFetchFilingList).toHaveBeenCalledTimes(2);

    // Resolve AAPL late — should be ignored
    resolveAapl!(aaplFilings);

    await waitFor(() => {
      expect(result.current.status).toBe('loaded');
    });

    expect(result.current.filings).toEqual(msftFilings);
  });

  it('AbortError silently ignored', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mockFetchFilingList.mockRejectedValue(abortError);

    const { result } = renderHook(() => useFilingList(AAPL));

    // Wait a tick for the rejection to be handled
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should still be loading (AbortError doesn't transition to error)
    // The status won't change to 'error' because AbortError is silently ignored
    expect(result.current.status).not.toBe('error');
    expect(result.current.error).toBeNull();
  });

  it('passes signal to fetchFilingList', async () => {
    mockFetchFilingList.mockResolvedValue([]);

    renderHook(() => useFilingList(AAPL));

    expect(mockFetchFilingList).toHaveBeenCalledWith(
      '0000320193',
      expect.any(AbortSignal),
    );
  });

  it('unmount during fetch does not cause state-update warnings', async () => {
    // Create a promise we control so the fetch is still in-flight at unmount
    let resolveFetch: (value: AvailableFiling[]) => void;
    const pendingFetch = new Promise<AvailableFiling[]>((resolve) => {
      resolveFetch = resolve;
    });
    mockFetchFilingList.mockReturnValue(pendingFetch);

    const consoleSpy = vi.spyOn(console, 'error');

    const { unmount } = renderHook(() => useFilingList(AAPL));

    // Unmount while fetch is still in-flight
    unmount();

    // Resolve the fetch after unmount — should not trigger state update warning
    resolveFetch!(SAMPLE_FILINGS);

    // Wait a tick for the promise resolution to propagate
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // No "Can't perform a React state update on an unmounted component" warnings
    const stateUpdateWarnings = consoleSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unmounted'),
    );
    expect(stateUpdateWarnings).toHaveLength(0);
  });
});
