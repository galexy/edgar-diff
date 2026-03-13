import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FilingPanel } from './FilingPanel';

describe('FilingPanel', () => {
  it('renders the provided heading', () => {
    render(<FilingPanel label="Filing A" />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
  });

  it('renders a disabled filing selector', () => {
    render(<FilingPanel label="Filing A" />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent(/select a filing/i);
  });

  it('renders Filing B with correct heading', () => {
    render(<FilingPanel label="Filing B" />);
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });
});
