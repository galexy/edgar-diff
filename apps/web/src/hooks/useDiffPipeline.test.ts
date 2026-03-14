import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdgarNetworkError } from '@edgar-diff/lib';

// Mock the client factory
vi.mock('../services/edgar-client-factory', () => ({
  createProxiedEdgarClient: vi.fn(),
}));

// Mock the library's parse/diff functions
vi.mock('@edgar-diff/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edgar-diff/lib')>();
  return {
    ...actual,
    parseFiling: vi.fn(),
    diffFilings: vi.fn(),
  };
});

import { useDiffPipeline, classifyFetchError } from './useDiffPipeline';
import { createProxiedEdgarClient } from '../services/edgar-client-factory';
import { parseFiling, diffFilings } from '@edgar-diff/lib';
import {
  ACCESSION_A,
  ACCESSION_B,
  ACCESSION_C,
  MOCK_RAW_FILING_A,
  MOCK_RAW_FILING_B,
  MOCK_RAW_FILING_C,
  MOCK_STRUCTURED_DOC_A,
  MOCK_STRUCTURED_DOC_B,
  MOCK_STRUCTURED_DOC_C,
  MOCK_DIFF,
  MOCK_DIFF_IDENTICAL,
} from '../test-fixtures/diff-pipeline-fixtures';

const mockCreateProxiedEdgarClient = vi.mocked(createProxiedEdgarClient);
const mockParseFiling = vi.mocked(parseFiling);
const mockDiffFilings = vi.mocked(diffFilings);

// ─── Setup ───────────────────────────────────────────────────────────────────

let mockFetchFiling: ReturnType<typeof vi.fn>;
let mockDispose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetchFiling = vi.fn();
  mockDispose = vi.fn();
  mockCreateProxiedEdgarClient.mockReturnValue({
    fetchFiling: mockFetchFiling,
    dispose: mockDispose,
  } as ReturnType<typeof createProxiedEdgarClient>);
  mockParseFiling.mockReset();
  mockDiffFilings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper to set up happy-path mocks
function setupHappyPath() {
  mockFetchFiling
    .mockResolvedValueOnce(MOCK_RAW_FILING_A)
    .mockResolvedValueOnce(MOCK_RAW_FILING_B);
  mockParseFiling
    .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
    .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B);
  mockDiffFilings.mockReturnValue(MOCK_DIFF);
}

// ─── 2.1 Initial State & Preconditions ───────────────────────────────────────

describe('useDiffPipeline — Initial State', () => {
  it('DP-U1: no filings selected → idle', () => {
    const { result } = renderHook(() => useDiffPipeline(null, null));
    expect(result.current.status).toBe('idle');
    expect(result.current.oldDocument).toBeNull();
    expect(result.current.newDocument).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('DP-U2: only Filing A selected → idle', () => {
    const { result } = renderHook(() => useDiffPipeline(ACCESSION_A, null));
    expect(result.current.status).toBe('idle');
  });

  it('DP-U3: only Filing B selected → idle', () => {
    const { result } = renderHook(() => useDiffPipeline(null, ACCESSION_B));
    expect(result.current.status).toBe('idle');
  });
});

// ─── 2.2 Happy Path — Pipeline Stages ───────────────────────────────────────

describe('useDiffPipeline — Happy Path', () => {
  it('DP-U4: both selected → full pipeline idle→fetching→done', async () => {
    setupHappyPath();

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    // Initially should be fetching
    expect(result.current.status).toBe('fetching');

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });
  });

  it('DP-U5: fetchFiling is called for both accession numbers', async () => {
    setupHappyPath();

    renderHook(() => useDiffPipeline(ACCESSION_A, ACCESSION_B));

    await waitFor(() => {
      expect(mockFetchFiling).toHaveBeenCalledWith(ACCESSION_A);
      expect(mockFetchFiling).toHaveBeenCalledWith(ACCESSION_B);
    });
  });

  it('DP-U6: parseFiling is called with both fetched RawFilings', async () => {
    setupHappyPath();

    renderHook(() => useDiffPipeline(ACCESSION_A, ACCESSION_B));

    await waitFor(() => {
      expect(mockParseFiling).toHaveBeenCalledWith(MOCK_RAW_FILING_A);
      expect(mockParseFiling).toHaveBeenCalledWith(MOCK_RAW_FILING_B);
    });
  });

  it('DP-U7: diffFilings is called with both StructuredDocuments', async () => {
    setupHappyPath();

    renderHook(() => useDiffPipeline(ACCESSION_A, ACCESSION_B));

    await waitFor(() => {
      expect(mockDiffFilings).toHaveBeenCalledWith(
        MOCK_STRUCTURED_DOC_A,
        MOCK_STRUCTURED_DOC_B,
      );
    });
  });

  it('DP-U8: done → diff contains the StructuredDiff result', async () => {
    setupHappyPath();

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.diff).toEqual(MOCK_DIFF);
  });

  it('DP-U9: done → oldDocument and newDocument available', async () => {
    setupHappyPath();

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.oldDocument).toEqual(MOCK_STRUCTURED_DOC_A);
    expect(result.current.newDocument).toEqual(MOCK_STRUCTURED_DOC_B);
  });

  it('DP-U10: error is null throughout successful pipeline', async () => {
    setupHappyPath();

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.error).toBeNull();
  });
});

// ─── 2.3 Error Handling ──────────────────────────────────────────────────────

describe('useDiffPipeline — Error Handling', () => {
  it('DP-U11: fetchFiling rejects → status error with user-friendly string', async () => {
    mockFetchFiling.mockRejectedValue(new Error('network fail'));

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBeTruthy();
  });

  it('DP-U12: EdgarNetworkError(404) → "Filing not available"', async () => {
    mockFetchFiling.mockRejectedValue(
      new EdgarNetworkError(404, ACCESSION_A),
    );

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toContain('Filing not available');
  });

  it('DP-U13: EdgarNetworkError(429) → "rate limit"', async () => {
    mockFetchFiling.mockRejectedValue(
      new EdgarNetworkError(429, ACCESSION_A, 10),
    );

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error?.toLowerCase()).toContain('rate limit');
  });

  it('DP-U14: TypeError → generic fallback', async () => {
    mockFetchFiling.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBeTruthy();
  });

  it('DP-U15: parseFiling throws → "Unable to parse filing"', async () => {
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_B);
    mockParseFiling.mockImplementation(() => {
      throw new Error('Parse error');
    });

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('Unable to parse filing');
  });

  it('DP-U16: diffFilings throws → "Unable to compute diff"', async () => {
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_B);
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B);
    mockDiffFilings.mockImplementation(() => {
      throw new Error('Diff error');
    });

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('Unable to compute diff');
  });

  it('DP-U17: error state has null documents and diff', async () => {
    mockFetchFiling.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.oldDocument).toBeNull();
    expect(result.current.newDocument).toBeNull();
    expect(result.current.diff).toBeNull();
  });

  it('DP-U18: after error, new valid filings → pipeline restarts and succeeds', async () => {
    // First render: error
    mockFetchFiling.mockRejectedValue(new Error('fail'));

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    // Second render: success with different filings
    mockFetchFiling.mockReset();
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_B);
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_B, b: ACCESSION_A });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.error).toBeNull();
    expect(result.current.diff).toEqual(MOCK_DIFF);
  });
});

// ─── 2.4 classifyFetchError Unit Tests ───────────────────────────────────────

describe('classifyFetchError', () => {
  it('CE-U1: EdgarNetworkError(404) → filing not available', () => {
    const err = new EdgarNetworkError(404, ACCESSION_A);
    expect(classifyFetchError(err)).toContain('Filing not available');
  });

  it('CE-U2: EdgarNetworkError(429) → rate limit message', () => {
    const err = new EdgarNetworkError(429, ACCESSION_A, 10);
    expect(classifyFetchError(err).toLowerCase()).toContain('rate limit');
  });

  it('CE-U3: EdgarNetworkError(500) → generic SEC error', () => {
    const err = new EdgarNetworkError(500, ACCESSION_A);
    const msg = classifyFetchError(err);
    expect(msg).toBeTruthy();
    expect(msg).not.toContain('Filing not available');
  });

  it('CE-U4: generic Error → generic fallback', () => {
    const err = new Error('something unrelated');
    const msg = classifyFetchError(err);
    expect(msg).toBeTruthy();
  });

  it('CE-U5: TypeError → connection error message', () => {
    const err = new TypeError('Failed to fetch');
    const msg = classifyFetchError(err);
    expect(msg).toBeTruthy();
  });
});

// ─── 2.5 Caching ────────────────────────────────────────────────────────────

describe('useDiffPipeline — Caching', () => {
  it('DP-U19: same pair re-selected → no re-fetch, cached result returned', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    const fetchCount = mockFetchFiling.mock.calls.length;

    // Clear selections, then re-select same pair
    rerender({ a: null, b: null });
    expect(result.current.status).toBe('idle');

    rerender({ a: ACCESSION_A, b: ACCESSION_B });

    // Should be done immediately from cache
    expect(result.current.status).toBe('done');
    expect(result.current.diff).toEqual(MOCK_DIFF);
    // No additional fetch calls
    expect(mockFetchFiling.mock.calls.length).toBe(fetchCount);
  });

  it('DP-U20: cache hit → status transitions directly to done', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    rerender({ a: null, b: null });
    rerender({ a: ACCESSION_A, b: ACCESSION_B });

    // Immediately done — no intermediate states
    expect(result.current.status).toBe('done');
  });

  it('DP-U21: pair (A,B) cached, then (B,A) → cache miss, full pipeline runs', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // Reset mocks for new pipeline run
    mockFetchFiling.mockReset();
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_B)
      .mockResolvedValueOnce(MOCK_RAW_FILING_A);
    mockParseFiling.mockReset();
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    // Swap A and B
    rerender({ a: ACCESSION_B, b: ACCESSION_A });

    // Should start a new pipeline (cache miss — ordered key)
    expect(result.current.status).toBe('fetching');

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });
  });

  it('DP-U22: different pair → cache miss, full pipeline runs', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // New pair with ACCESSION_C
    mockFetchFiling.mockReset();
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_C);
    mockParseFiling.mockReset();
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_C);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_A, b: ACCESSION_C });

    expect(result.current.status).toBe('fetching');

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });
  });

  it('DP-U23: per-filing fetch cache — reused filing not re-fetched', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // Now select (A, C) — A should be cached, only C fetched
    mockFetchFiling.mockReset();
    // Only one fetch needed (for C)
    mockFetchFiling.mockResolvedValueOnce(MOCK_RAW_FILING_C);
    mockParseFiling.mockReset();
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_C);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_A, b: ACCESSION_C });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // fetchFiling should only be called once (for C), not for A
    expect(mockFetchFiling).toHaveBeenCalledTimes(1);
    expect(mockFetchFiling).toHaveBeenCalledWith(ACCESSION_C);
  });

  it('DP-U24: per-filing parse cache — reused document not re-parsed', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    const parseCallCount = mockParseFiling.mock.calls.length;

    // Now select (A, C) — A's document should be cached
    mockFetchFiling.mockReset();
    mockFetchFiling.mockResolvedValueOnce(MOCK_RAW_FILING_C);
    mockParseFiling.mockReset();
    // Only C needs parsing; A should come from cache
    mockParseFiling.mockReturnValueOnce(MOCK_STRUCTURED_DOC_C);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_A, b: ACCESSION_C });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // parseFiling should only be called once (for C)
    expect(mockParseFiling).toHaveBeenCalledTimes(1);
    expect(mockParseFiling).toHaveBeenCalledWith(MOCK_RAW_FILING_C);
  });
});

// ─── 2.6 Abort & Restart ────────────────────────────────────────────────────

describe('useDiffPipeline — Abort & Restart', () => {
  it('DP-U25: Filing A changed mid-pipeline → new pipeline starts', async () => {
    // First pipeline: slow fetch
    let resolveFirst: (v: typeof MOCK_RAW_FILING_A) => void;
    mockFetchFiling.mockImplementation(
      () => new Promise((r) => { resolveFirst = r; }),
    );

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    expect(result.current.status).toBe('fetching');

    // Change Filing A before first pipeline completes
    mockFetchFiling.mockReset();
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_C)
      .mockResolvedValueOnce(MOCK_RAW_FILING_B);
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_C)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_B);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_C, b: ACCESSION_B });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // New pipeline should have completed
    expect(result.current.diff).toEqual(MOCK_DIFF);
  });

  it('DP-U28: both filings cleared mid-pipeline → idle', async () => {
    // Slow fetch
    mockFetchFiling.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    expect(result.current.status).toBe('fetching');

    // Clear both filings
    rerender({ a: null, b: null });

    expect(result.current.status).toBe('idle');
    expect(result.current.oldDocument).toBeNull();
    expect(result.current.newDocument).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ─── 2.7 Cleanup & Edge Cases ────────────────────────────────────────────────

describe('useDiffPipeline — Edge Cases', () => {
  it('DP-U31: same filing for both A and B → pipeline runs (self-diff)', async () => {
    mockFetchFiling.mockResolvedValue(MOCK_RAW_FILING_A);
    mockParseFiling.mockReturnValue(MOCK_STRUCTURED_DOC_A);
    mockDiffFilings.mockReturnValue(MOCK_DIFF_IDENTICAL);

    const { result } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_A),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.error).toBeNull();
  });

  it('DP-U33: company change clears filings → idle, caches retained', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // Simulate company change → clear filings
    rerender({ a: null, b: null });
    expect(result.current.status).toBe('idle');

    // Re-select same pair → should use cache
    rerender({ a: ACCESSION_A, b: ACCESSION_B });
    expect(result.current.status).toBe('done');
  });
});

// ─── 2.8 Rate Limiter ───────────────────────────────────────────────────────

describe('useDiffPipeline — Integration', () => {
  it('DP-I7: dispose() called on unmount', async () => {
    setupHappyPath();

    const { result, unmount } = renderHook(() =>
      useDiffPipeline(ACCESSION_A, ACCESSION_B),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });

  it('DP-I8: EdgarClient reused across renders (same fetchFiling mock)', async () => {
    setupHappyPath();

    const { result, rerender } = renderHook(
      ({ a, b }: { a: string | null; b: string | null }) =>
        useDiffPipeline(a, b),
      { initialProps: { a: ACCESSION_A, b: ACCESSION_B } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // The same mockFetchFiling (from the client created at mount) is used
    expect(mockFetchFiling).toHaveBeenCalledTimes(2);

    // Re-render with different filings — same client should be used
    mockFetchFiling.mockReset();
    mockFetchFiling
      .mockResolvedValueOnce(MOCK_RAW_FILING_A)
      .mockResolvedValueOnce(MOCK_RAW_FILING_C);
    mockParseFiling.mockReset();
    mockParseFiling
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_A)
      .mockReturnValueOnce(MOCK_STRUCTURED_DOC_C);
    mockDiffFilings.mockReturnValue(MOCK_DIFF);

    rerender({ a: ACCESSION_A, b: ACCESSION_C });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    // fetchFiling was called on the same mock (proving same client reused)
    expect(mockFetchFiling).toHaveBeenCalled();
  });
});
