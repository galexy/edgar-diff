import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CompanyMatch } from '../services/types';

// --- Mock the services ---
const mockSearchCompanies = vi.fn();
const mockFetchCompanySubmissions = vi.fn();

vi.mock('../services/company-resolver', () => ({
  searchCompanies: (...args: unknown[]) => mockSearchCompanies(...args),
  findByTicker: vi.fn(),
  findByCik: vi.fn(),
}));

vi.mock('../services/sec-submissions', () => ({
  fetchCompanySubmissions: (...args: unknown[]) => mockFetchCompanySubmissions(...args),
}));

import { useCompanySearch } from './useCompanySearch';

const appleMatch: CompanyMatch = {
  cik: '320193',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'Nasdaq',
};

const msftMatch: CompanyMatch = {
  cik: '789019',
  ticker: 'MSFT',
  name: 'Microsoft Corporation',
  exchange: 'Nasdaq',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockSearchCompanies.mockResolvedValue([]);
  mockFetchCompanySubmissions.mockResolvedValue({
    cik: '0000320193',
    name: 'Apple Inc.',
    ticker: 'AAPL',
    exchange: 'Nasdaq',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── State Shape & Transitions ────────────────────────────────────────────────

describe('useCompanySearch: State Transitions', () => {
  it('has correct initial state', () => {
    const { result } = renderHook(() => useCompanySearch());
    expect(result.current.query).toBe('');
    expect(result.current.matches).toEqual([]);
    expect(result.current.selectedCompany).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('short query (< 2 chars) stays idle', async () => {
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('A'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.matches).toEqual([]);
    expect(mockSearchCompanies).not.toHaveBeenCalled();
  });

  it('typing >= 2 chars triggers search and populates matches', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSearchCompanies).toHaveBeenCalledWith('AAPL');
    expect(result.current.matches).toEqual([appleMatch]);
  });

  it('no matches found — status returns to idle with empty matches', async () => {
    mockSearchCompanies.mockResolvedValue([]);
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('XYZFAKE'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.matches).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('selectMatch triggers API call and resolves company', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      result.current.selectMatch(appleMatch);
    });

    expect(mockFetchCompanySubmissions).toHaveBeenCalledWith('320193', expect.any(AbortSignal));
    expect(result.current.selectedCompany).toEqual({
      cik: '0000320193',
      name: 'Apple Inc.',
      ticker: 'AAPL',
      exchange: 'Nasdaq',
    });
    expect(result.current.status).toBe('resolved');
    expect(result.current.error).toBeNull();
  });

  it('API failure sets error state', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    mockFetchCompanySubmissions.mockRejectedValue(new Error('SEC service unavailable'));
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      result.current.selectMatch(appleMatch);
    });

    expect(result.current.selectedCompany).toBeNull();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('SEC service unavailable');
  });

  it('clear resets all state', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {
      result.current.selectMatch(appleMatch);
    });

    act(() => result.current.clear());

    expect(result.current.query).toBe('');
    expect(result.current.matches).toEqual([]);
    expect(result.current.selectedCompany).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('searchCompanies rejection sets error status with user-facing message', async () => {
    mockSearchCompanies.mockRejectedValue(new Error('Unable to load company data'));
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Unable to load company data');
    expect(result.current.matches).toEqual([]);
  });

  it('new query clears selected company', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {
      result.current.selectMatch(appleMatch);
    });

    expect(result.current.status).toBe('resolved');

    mockSearchCompanies.mockResolvedValue([msftMatch]);
    act(() => result.current.setQuery('MSFT'));

    expect(result.current.selectedCompany).toBeNull();
    expect(result.current.status).toBe('idle');
  });
});

// ─── Concurrency & Cleanup ────────────────────────────────────────────────────

describe('useCompanySearch: Concurrency', () => {
  it('abort in-flight on new selection', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch, msftMatch]);

    let firstCallResolve: ((v: unknown) => void) | undefined;
    const firstCallPromise = new Promise((resolve) => {
      firstCallResolve = resolve;
    });

    mockFetchCompanySubmissions
      .mockImplementationOnce(() => firstCallPromise)
      .mockResolvedValueOnce({
        cik: '0000789019',
        name: 'Microsoft Corporation',
        ticker: 'MSFT',
        exchange: 'Nasdaq',
      });

    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('test'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Select first (will be pending)
    act(() => {
      result.current.selectMatch(appleMatch);
    });

    // Select second (should abort first)
    await act(async () => {
      result.current.selectMatch(msftMatch);
    });

    expect(result.current.selectedCompany).toEqual(
      expect.objectContaining({ name: 'Microsoft Corporation' }),
    );

    // Resolve the first call — should not override
    firstCallResolve!({
      cik: '0000320193',
      name: 'Apple Inc.',
      ticker: 'AAPL',
      exchange: 'Nasdaq',
    });

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.selectedCompany).toEqual(
      expect.objectContaining({ name: 'Microsoft Corporation' }),
    );
  });

  it('abort in-flight on clear', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    mockFetchCompanySubmissions.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.selectMatch(appleMatch);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.selectedCompany).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('AbortError from API is silently ignored', async () => {
    mockSearchCompanies.mockResolvedValue([appleMatch]);
    mockFetchCompanySubmissions.mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const { result } = renderHook(() => useCompanySearch());

    act(() => result.current.setQuery('AAPL'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      result.current.selectMatch(appleMatch);
    });

    // AbortError should NOT set error state
    expect(result.current.error).toBeNull();
    expect(result.current.status).not.toBe('error');
  });
});
