import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders a text input with search placeholder', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('input is disabled (non-functional placeholder)', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toBeDisabled();
  });

  it('wraps input in a search landmark', () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('input has aria-label for accessibility', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/company name, ticker, or cik/i);
    expect(input).toHaveAttribute('aria-label');
  });
});
