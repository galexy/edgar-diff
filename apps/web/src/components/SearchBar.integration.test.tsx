/**
 * SearchBar Integration Tests (Section 3.1 of test plan)
 *
 * Render SearchBar with real hooks wired up; only mock `globalThis.fetch`
 * for the Worker tickers endpoint and Worker submissions proxy.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchBar } from './SearchBar';
import {
  MOCK_COMPANY_TICKERS,
  MOCK_AAPL_SUBMISSIONS,
  MOCK_MSFT_SUBMISSIONS,
  mockTickersResponse,
  mockResponse,
} from '../test-fixtures/company-search-fixtures';
import { _resetCache } from '../services/company-resolver';

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  _resetCache();

  // Default mock: tickers + AAPL submissions
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/api/tickers')) {
        return Promise.resolve(mockTickersResponse());
      }
      if (url.includes('/api/sec/submissions/CIK0000320193')) {
        return Promise.resolve(
          mockResponse(200, MOCK_AAPL_SUBMISSIONS),
        );
      }
      if (url.includes('/api/sec/submissions/CIK0000789019')) {
        return Promise.resolve(
          mockResponse(200, MOCK_MSFT_SUBMISSIONS),
        );
      }
      return Promise.reject(new Error(`Unmocked URL: ${url}`));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function typeAndWaitForDropdown(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByRole('combobox');
  await user.clear(input);
  await user.type(input, text);

  // Advance past debounce
  await vi.advanceTimersByTimeAsync(350);
}

// ─── Integration Tests ──────────────────────────────────────────────────────

describe('SearchBar Integration: Full Flow', () => {
  it('type → debounce → local matches → select → API → display company', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCompanySelect = vi.fn();
    render(<SearchBar onCompanySelect={onCompanySelect} />);

    await typeAndWaitForDropdown(user, 'AAPL');

    // Dropdown should show Apple
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Apple Inc/)).toBeInTheDocument();

    // Click the match
    await user.click(options[0]);

    // Wait for API resolution
    await waitFor(() => {
      expect(screen.getByText(/Apple Inc/)).toBeInTheDocument();
      expect(screen.getByText(/0000320193/)).toBeInTheDocument();
    });

    expect(onCompanySelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Apple Inc.', cik: '0000320193' }),
    );
  });

  it('type → debounce → local matches → select → API error → display error', async () => {
    // Override fetch to fail on submissions
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/tickers')) {
          return Promise.resolve(mockTickersResponse());
        }
        if (url.includes('/api/sec/submissions/')) {
          return Promise.resolve(mockResponse(500, { error: 'Internal Server Error' }));
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      }),
    );
    _resetCache();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    await typeAndWaitForDropdown(user, 'AAPL');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    const option = screen.getAllByRole('option')[0];
    await user.click(option);

    // Wait for error
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('type → no local matches → no dropdown', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    await typeAndWaitForDropdown(user, 'XYZNOTREAL');

    // Give it time to settle
    await vi.advanceTimersByTimeAsync(100);

    // No listbox should appear
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('rapid typing → single search after debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.clear(input);

    // Type characters rapidly
    await user.type(input, 'A');
    await vi.advanceTimersByTimeAsync(50);
    await user.type(input, 'A');
    await vi.advanceTimersByTimeAsync(50);
    await user.type(input, 'P');
    await vi.advanceTimersByTimeAsync(50);
    await user.type(input, 'L');

    // Not enough time for debounce yet
    await vi.advanceTimersByTimeAsync(100);

    // Fetch should not have been called for tickers yet (or at most once for the final value)
    const fetchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes('/api/tickers'),
    );
    expect(fetchCalls.length).toBeLessThanOrEqual(1);

    // Now advance past debounce
    await vi.advanceTimersByTimeAsync(300);

    // Should show matches for "AAPL"
    await waitFor(() => {
      expect(screen.getByText(/Apple Inc/)).toBeInTheDocument();
    });
  });

  it('type → select → type new query → clears previous result', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCompanySelect = vi.fn();
    render(<SearchBar onCompanySelect={onCompanySelect} />);

    // First search: AAPL
    await typeAndWaitForDropdown(user, 'AAPL');
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    await user.click(screen.getAllByRole('option')[0]);
    await waitFor(() => {
      expect(screen.getByText(/0000320193/)).toBeInTheDocument();
    });

    // Start new search: clear and type MSFT
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'MSFT');
    await vi.advanceTimersByTimeAsync(350);

    // Previous Apple result should be gone
    expect(screen.queryByText(/0000320193/)).not.toBeInTheDocument();

    // MSFT matches should appear
    await waitFor(() => {
      expect(screen.getByText(/Microsoft/)).toBeInTheDocument();
    });
  });

  it('keyboard flow: type → ArrowDown → Enter → resolve', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCompanySelect = vi.fn();
    render(<SearchBar onCompanySelect={onCompanySelect} />);

    await typeAndWaitForDropdown(user, 'AAPL');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    // Keyboard navigate and select
    await user.keyboard('{ArrowDown}{Enter}');

    // Wait for resolution
    await waitFor(() => {
      expect(screen.getByText(/Apple Inc/)).toBeInTheDocument();
      expect(screen.getByText(/0000320193/)).toBeInTheDocument();
    });

    expect(onCompanySelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Apple Inc.' }),
    );
  });
});
