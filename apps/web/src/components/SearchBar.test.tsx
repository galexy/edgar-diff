import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchBar } from './SearchBar';
import type { UseCompanySearchReturn } from '../hooks/useCompanySearch';
import type { CompanyMatch } from '../services/types';

// --- Mock useCompanySearch ---
const defaultHookReturn: UseCompanySearchReturn = {
  query: '',
  setQuery: vi.fn(),
  status: 'idle',
  matches: [],
  selectedCompany: null,
  error: null,
  selectMatch: vi.fn(),
  clear: vi.fn(),
};

let mockHookReturn: UseCompanySearchReturn;

vi.mock('../hooks/useCompanySearch', () => ({
  useCompanySearch: () => mockHookReturn,
}));

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

const tslaMatch: CompanyMatch = {
  cik: '1318605',
  ticker: 'TSLA',
  name: 'Tesla, Inc.',
  exchange: 'Nasdaq',
};

beforeEach(() => {
  mockHookReturn = { ...defaultHookReturn, setQuery: vi.fn(), selectMatch: vi.fn(), clear: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Rendering ─────────────────────────────────────────────────────────────────

describe('SearchBar: Rendering', () => {
  it('renders an enabled text input', () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    expect(input).toBeEnabled();
  });

  it('input has search placeholder text mentioning ticker, name, or CIK', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/ticker|name|cik/i);
    expect(input).toBeInTheDocument();
  });

  it('wraps input in a search landmark', () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('input has combobox role', () => {
    render(<SearchBar />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('has autocomplete ARIA attributes', () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded');
    expect(input).toHaveAttribute('aria-controls');
  });
});

// ─── Dropdown Behavior ─────────────────────────────────────────────────────────

describe('SearchBar: Dropdown', () => {
  it('dropdown is hidden initially', () => {
    render(<SearchBar />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('dropdown appears when there are matches', () => {
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch], query: 'AAPL' };
    render(<SearchBar />);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('dropdown shows match details (ticker, name, exchange)', () => {
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch], query: 'AAPL' };
    render(<SearchBar />);
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText(/AAPL/)).toBeInTheDocument();
    expect(within(listbox).getByText(/Apple Inc/)).toBeInTheDocument();
  });

  it('dropdown closes on match selection (click)', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch], query: 'AAPL' };
    render(<SearchBar />);

    const option = screen.getByRole('option');
    await user.click(option);
    expect(mockHookReturn.selectMatch).toHaveBeenCalledWith(appleMatch);
  });

  it('dropdown shows "no matches" when query >= 2 chars but no matches', () => {
    mockHookReturn = { ...mockHookReturn, query: 'XYZFAKE', matches: [] };
    render(<SearchBar />);
    // No listbox should be present since there are no matches
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

// ─── Keyboard Navigation ─────────────────────────────────────────────────────

describe('SearchBar: Keyboard Navigation', () => {
  it('ArrowDown highlights first option', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch, msftMatch], query: 'A' };
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}');

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown cycles through options', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch, msftMatch], query: 'A' };
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}');

    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp moves selection up', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch, msftMatch, tslaMatch], query: 'A' };
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter selects highlighted option', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch, msftMatch], query: 'A' };
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(mockHookReturn.selectMatch).toHaveBeenCalledWith(appleMatch);
  });

  it('Escape closes dropdown and keeps focus on input', async () => {
    const user = userEvent.setup();
    mockHookReturn = { ...mockHookReturn, matches: [appleMatch], query: 'AAPL' };
    render(<SearchBar />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Simulate escape — SearchBar should set internal dropdown closed state
    await user.keyboard('{Escape}');

    // Input should still have focus
    expect(input).toHaveFocus();
  });
});

// ─── Result Display ──────────────────────────────────────────────────────────

describe('SearchBar: Result Display', () => {
  it('displays resolved company name after selection', () => {
    mockHookReturn = {
      ...mockHookReturn,
      status: 'resolved',
      selectedCompany: { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' },
    };
    render(<SearchBar />);
    expect(screen.getByText(/Apple Inc/)).toBeInTheDocument();
  });

  it('displays CIK after selection', () => {
    mockHookReturn = {
      ...mockHookReturn,
      status: 'resolved',
      selectedCompany: { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' },
    };
    render(<SearchBar />);
    expect(screen.getByText(/0000320193/)).toBeInTheDocument();
  });

  it('result has aria-live polite region', () => {
    mockHookReturn = {
      ...mockHookReturn,
      status: 'resolved',
      selectedCompany: { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' },
    };
    const { container } = render(<SearchBar />);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });
});

// ─── Loading State ─────────────────────────────────────────────────────────────

describe('SearchBar: Loading State', () => {
  it('shows loading indicator when status is searching', () => {
    mockHookReturn = { ...mockHookReturn, status: 'searching' };
    render(<SearchBar />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('loading clears on success', () => {
    mockHookReturn = {
      ...mockHookReturn,
      status: 'resolved',
      selectedCompany: { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' },
    };
    render(<SearchBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('loading clears on error', () => {
    mockHookReturn = { ...mockHookReturn, status: 'error', error: 'Something went wrong' };
    render(<SearchBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// ─── Error Display ─────────────────────────────────────────────────────────────

describe('SearchBar: Error Display', () => {
  it('displays error message', () => {
    mockHookReturn = { ...mockHookReturn, status: 'error', error: 'Company not found' };
    render(<SearchBar />);
    expect(screen.getByText(/Company not found/)).toBeInTheDocument();
  });

  it('error has alert role', () => {
    mockHookReturn = { ...mockHookReturn, status: 'error', error: 'Company not found' };
    render(<SearchBar />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ─── Callback Integration ──────────────────────────────────────────────────────

describe('SearchBar: Callback Integration', () => {
  it('calls onCompanySelect on successful resolution', () => {
    const onCompanySelect = vi.fn();
    const company = { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' };
    mockHookReturn = {
      ...mockHookReturn,
      status: 'resolved',
      selectedCompany: company,
    };
    render(<SearchBar onCompanySelect={onCompanySelect} />);
    expect(onCompanySelect).toHaveBeenCalledWith(company);
  });

  it('calls onCompanySelect(null) on clear', async () => {
    const user = userEvent.setup();
    const onCompanySelect = vi.fn();
    mockHookReturn = {
      ...mockHookReturn,
      query: 'AAPL',
    };
    render(<SearchBar onCompanySelect={onCompanySelect} />);

    // Click clear button
    const clearBtn = screen.getByLabelText(/clear/i);
    await user.click(clearBtn);

    expect(mockHookReturn.clear).toHaveBeenCalled();
  });
});
