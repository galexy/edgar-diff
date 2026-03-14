import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MOCK_AAPL_SUBMISSIONS } from '../test-fixtures/company-search-fixtures';
import { fetchCompanySubmissions } from './sec-submissions';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchCompanySubmissions', () => {
  it('fetches correct URL with CIK padded to 10 digits', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_AAPL_SUBMISSIONS), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await fetchCompanySubmissions('320193');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sec/submissions/CIK0000320193.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('pads short CIK to 10 digits', async () => {
    const mockFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_AAPL_SUBMISSIONS), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    await fetchCompanySubmissions('320193');
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('CIK0000320193');
  });

  it('extracts company data from response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(MOCK_AAPL_SUBMISSIONS), { status: 200 })),
      ),
    );

    const company = await fetchCompanySubmissions('320193');
    expect(company).toEqual({
      cik: '0000320193',
      name: 'Apple Inc.',
      ticker: 'AAPL',
      exchange: 'Nasdaq',
    });
  });

  it('handles 404 — throws "Company not found"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );

    await expect(fetchCompanySubmissions('9999999')).rejects.toThrow(/not found/i);
  });

  it('handles 429 — throws rate limit error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 429 }))),
    );

    await expect(fetchCompanySubmissions('320193')).rejects.toThrow(/rate limit/i);
  });

  it('handles 500 — throws server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    );

    await expect(fetchCompanySubmissions('320193')).rejects.toThrow(/unavailable/i);
  });

  it('handles malformed JSON — throws parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not json', { status: 200 }))),
    );

    await expect(fetchCompanySubmissions('320193')).rejects.toThrow(/unexpected response/i);
  });

  it('handles network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(fetchCompanySubmissions('320193')).rejects.toThrow(/network|fetch/i);
  });

  it('handles AbortError gracefully — does not throw user-facing error', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abortError)),
    );

    const err = await fetchCompanySubmissions('320193').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('accepts and forwards AbortSignal', async () => {
    const mockFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_AAPL_SUBMISSIONS), { status: 200 })),
    );
    vi.stubGlobal('fetch', mockFetch);

    const controller = new AbortController();
    await fetchCompanySubmissions('320193', controller.signal);
    expect(mockFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
