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
  MOCK_RAW_FILING_A,
  MOCK_RAW_FILING_B,
  MOCK_STRUCTURED_DOC_A,
  MOCK_STRUCTURED_DOC_B,
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
});
