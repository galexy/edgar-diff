import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockResponse } from '../test-fixtures/company-search-fixtures';
import {
  MOCK_MIXED_FILINGS_SUBMISSIONS,
  MOCK_ALL_SUPPORTED_SUBMISSIONS,
  MOCK_EMPTY_FILINGS_SUBMISSIONS,
  createLargeFilingsSubmissions,
} from '../test-fixtures/filing-list-fixtures';
import { fetchFilingList, SUPPORTED_FORM_TYPES } from './filing-list';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function submissionsResponse(recent: {
  accessionNumber: string[];
  filingDate: string[];
  form: string[];
}) {
  return mockResponse(200, {
    cik: '320193',
    name: 'Apple Inc.',
    tickers: ['AAPL'],
    exchanges: ['Nasdaq'],
    filings: { recent },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SUPPORTED_FORM_TYPES', () => {
  it('includes 10-K, 10-K/A, 10-Q, 10-Q/A', () => {
    expect(SUPPORTED_FORM_TYPES).toContain('10-K');
    expect(SUPPORTED_FORM_TYPES).toContain('10-K/A');
    expect(SUPPORTED_FORM_TYPES).toContain('10-Q');
    expect(SUPPORTED_FORM_TYPES).toContain('10-Q/A');
  });
});

describe('fetchFilingList', () => {
  it('parses parallel arrays into AvailableFiling objects', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['0000320193-23-000106'],
        filingDate: ['2023-11-03'],
        form: ['10-K'],
      }),
    );

    const filings = await fetchFilingList('320193');

    expect(filings).toEqual([
      {
        accessionNumber: '0000320193-23-000106',
        formType: '10-K',
        filingDate: '2023-11-03',
      },
    ]);
  });

  it('filters: keeps 10-K, 10-K/A, 10-Q, 10-Q/A; removes 8-K, S-1, DEF 14A', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
        filingDate: [
          '2023-11-03',
          '2023-08-04',
          '2023-05-05',
          '2023-02-03',
          '2023-09-15',
          '2023-07-01',
          '2023-06-01',
        ],
        form: ['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', 'S-1', 'DEF 14A'],
      }),
    );

    const filings = await fetchFilingList('320193');
    const formTypes = filings.map((f) => f.formType);

    expect(formTypes).toContain('10-K');
    expect(formTypes).toContain('10-K/A');
    expect(formTypes).toContain('10-Q');
    expect(formTypes).toContain('10-Q/A');
    expect(formTypes).not.toContain('8-K');
    expect(formTypes).not.toContain('S-1');
    expect(formTypes).not.toContain('DEF 14A');
    expect(filings).toHaveLength(4);
  });

  it('sorts by date descending', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['a1', 'a2', 'a3'],
        filingDate: ['2022-01-01', '2023-06-15', '2021-12-31'],
        form: ['10-K', '10-Q', '10-K'],
      }),
    );

    const filings = await fetchFilingList('320193');
    const dates = filings.map((f) => f.filingDate);

    expect(dates).toEqual(['2023-06-15', '2022-01-01', '2021-12-31']);
  });

  it('returns empty array for empty parallel arrays', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: [],
        filingDate: [],
        form: [],
      }),
    );

    const filings = await fetchFilingList('320193');
    expect(filings).toEqual([]);
  });

  it('returns empty array when all filings are unsupported', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['a1', 'a2'],
        filingDate: ['2023-01-01', '2023-02-01'],
        form: ['8-K', 'DEF 14A'],
      }),
    );

    const filings = await fetchFilingList('320193');
    expect(filings).toEqual([]);
  });

  it('handles mismatched array lengths by using minimum length', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['a1', 'a2', 'a3'],
        filingDate: ['2023-11-03', '2023-08-04'],
        form: ['10-K', '10-Q', '10-K'],
      }),
    );

    const filings = await fetchFilingList('320193');
    // Only 2 entries because filingDate has length 2
    expect(filings).toHaveLength(2);
  });

  it('returns empty array when filings.recent is missing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, {
        cik: '320193',
        name: 'Apple Inc.',
        filings: {},
      }),
    );

    const filings = await fetchFilingList('320193');
    expect(filings).toEqual([]);
  });

  it('pads CIK to 10 digits in the URL', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: [],
        filingDate: [],
        form: [],
      }),
    );

    await fetchFilingList('320193');

    expect(fetch).toHaveBeenCalledWith(
      '/api/sec/submissions/CIK0000320193.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('passes abort signal to fetch', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: [],
        filingDate: [],
        form: [],
      }),
    );

    const controller = new AbortController();
    await fetchFilingList('320193', controller.signal);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(500));

    await expect(fetchFilingList('320193')).rejects.toThrow(
      /unable to load filings/i,
    );
  });

  it('throws specific message on 404 response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(404));

    await expect(fetchFilingList('320193')).rejects.toThrow(
      'Company not found. Check the CIK and try again.',
    );
  });

  it('throws specific message on 429 response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(429));

    await expect(fetchFilingList('320193')).rejects.toThrow(
      'SEC rate limit reached. Please wait a moment and try again.',
    );
  });

  it('throws on malformed JSON response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    await expect(fetchFilingList('320193')).rejects.toThrow(
      'Unexpected response from SEC. Try again shortly.',
    );
  });

  it('handles large input (50+ filings)', async () => {
    const largeSubmissions = createLargeFilingsSubmissions(60);
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, largeSubmissions));

    const filings = await fetchFilingList('555555');

    // All 60 filings are supported types (10-K and 10-Q)
    expect(filings.length).toBe(60);
    // Should be sorted by date descending
    for (let i = 1; i < filings.length; i++) {
      expect(filings[i - 1].filingDate >= filings[i].filingDate).toBe(true);
    }
  });

  it('mixed fixture: keeps only supported types from mixed submissions', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, MOCK_MIXED_FILINGS_SUBMISSIONS));

    const filings = await fetchFilingList('888888');
    const formTypes = filings.map((f) => f.formType);

    // MOCK_MIXED has: 10-K, 8-K, 10-Q, S-1, 10-K/A → keep 10-K, 10-Q, 10-K/A
    expect(filings).toHaveLength(3);
    expect(formTypes).toContain('10-K');
    expect(formTypes).toContain('10-Q');
    expect(formTypes).toContain('10-K/A');
    expect(formTypes).not.toContain('8-K');
    expect(formTypes).not.toContain('S-1');
  });

  it('all-supported fixture: keeps all 4 supported form types', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, MOCK_ALL_SUPPORTED_SUBMISSIONS));

    const filings = await fetchFilingList('777777');

    expect(filings).toHaveLength(4);
    const formTypes = filings.map((f) => f.formType);
    expect(formTypes).toEqual(['10-K', '10-K/A', '10-Q', '10-Q/A']);
  });

  it('empty fixture: returns empty array for company with no filings', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, MOCK_EMPTY_FILINGS_SUBMISSIONS));

    const filings = await fetchFilingList('666666');

    expect(filings).toEqual([]);
  });

  it('preserves stable order for filings with same date', async () => {
    vi.mocked(fetch).mockResolvedValue(
      submissionsResponse({
        accessionNumber: ['first', 'second'],
        filingDate: ['2023-11-03', '2023-11-03'],
        form: ['10-K', '10-Q'],
      }),
    );

    const filings = await fetchFilingList('320193');

    expect(filings).toHaveLength(2);
    expect(filings[0].accessionNumber).toBe('first');
    expect(filings[1].accessionNumber).toBe('second');
  });
});
