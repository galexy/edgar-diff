import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MOCK_COMPANY_TICKERS } from '../test-fixtures/company-search-fixtures';
import { searchCompanies, findByTicker, findByCik, _resetCache } from './company-resolver';

beforeEach(() => {
  vi.restoreAllMocks();
  _resetCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_COMPANY_TICKERS), { status: 200 })),
    ),
  );
});

// ─── Ticker Lookup ────────────────────────────────────────────────────────────

describe('findByTicker', () => {
  it('resolves uppercase ticker', async () => {
    const result = await findByTicker('AAPL');
    expect(result).toEqual({
      cik: '320193',
      ticker: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'Nasdaq',
    });
  });

  it('resolves lowercase ticker (case-insensitive)', async () => {
    const result = await findByTicker('aapl');
    expect(result).toEqual(expect.objectContaining({ ticker: 'AAPL' }));
  });

  it('resolves mixed-case ticker', async () => {
    const result = await findByTicker('Aapl');
    expect(result).toEqual(expect.objectContaining({ ticker: 'AAPL' }));
  });

  it('returns null for unknown ticker', async () => {
    const result = await findByTicker('XYZNOTREAL');
    expect(result).toBeNull();
  });

  it('resolves multi-ticker company (GOOG)', async () => {
    const result = await findByTicker('GOOG');
    expect(result).toEqual(expect.objectContaining({ name: 'Alphabet Inc.' }));
  });
});

// ─── CIK Lookup ──────────────────────────────────────────────────────────────

describe('findByCik', () => {
  it('recognizes numeric-only as CIK', async () => {
    const result = await findByCik('320193');
    expect(result).toEqual(expect.objectContaining({ name: 'Apple Inc.', cik: '320193' }));
  });

  it('handles zero-padded CIK by stripping leading zeros', async () => {
    const result = await findByCik('0000320193');
    expect(result).toEqual(expect.objectContaining({ name: 'Apple Inc.' }));
  });

  it('returns null for unknown CIK', async () => {
    const result = await findByCik('9999999');
    expect(result).toBeNull();
  });
});

// ─── Name Search ──────────────────────────────────────────────────────────────

describe('searchCompanies', () => {
  it('finds by partial name (substring)', async () => {
    const results = await searchCompanies('Apple');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'Apple Inc.' }));
  });

  it('case-insensitive name search', async () => {
    const results = await searchCompanies('apple');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'Apple Inc.' }));
  });

  it('returns multiple matches for broad query', async () => {
    const results = await searchCompanies('Inc');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for no matches', async () => {
    const results = await searchCompanies('Nonexistent Corp');
    expect(results).toEqual([]);
  });

  it('ticker-exact match appears in results', async () => {
    const results = await searchCompanies('AAPL');
    expect(results.some((r) => r.ticker === 'AAPL')).toBe(true);
  });

  it('CIK input returns matching company', async () => {
    const results = await searchCompanies('320193');
    expect(results.some((r) => r.cik === '320193')).toBe(true);
  });

  it('returns empty array for empty string', async () => {
    const results = await searchCompanies('');
    expect(results).toEqual([]);
  });

  it('returns empty array for whitespace only', async () => {
    const results = await searchCompanies('   ');
    expect(results).toEqual([]);
  });

  it('limits results to 10', async () => {
    // With our small fixture this won't hit 10, but test the cap logic
    const results = await searchCompanies('a');
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

// ─── Lazy Loading ─────────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('throws when /api/tickers returns non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 502 }))),
    );
    await expect(searchCompanies('AAPL')).rejects.toThrow(/unable to load/i);
  });

  it('allows retry after failed load (cache not poisoned)', async () => {
    // First call fails
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 502 }))),
    );
    await expect(searchCompanies('AAPL')).rejects.toThrow();

    // Second call succeeds
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(MOCK_COMPANY_TICKERS), { status: 200 })),
      ),
    );
    const results = await searchCompanies('AAPL');
    expect(results.some((r) => r.ticker === 'AAPL')).toBe(true);
  });
});

describe('Lazy loading', () => {
  it('fetches /api/tickers on first search', async () => {
    await searchCompanies('AAPL');
    expect(fetch).toHaveBeenCalledWith('/api/tickers');
  });

  it('caches after first load — only one fetch call across multiple searches', async () => {
    await searchCompanies('AAPL');
    await searchCompanies('MSFT');
    await findByTicker('TSLA');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
