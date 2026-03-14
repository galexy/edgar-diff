import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { AvailableFiling } from '../services/types';
import { FilingSelector } from './FilingSelector';

const SAMPLE_FILINGS: AvailableFiling[] = [
  { accessionNumber: 'acc-001', formType: '10-K', filingDate: '2023-11-03' },
  { accessionNumber: 'acc-002', formType: '10-Q', filingDate: '2023-08-04' },
  { accessionNumber: 'acc-003', formType: '10-K/A', filingDate: '2023-05-05' },
];

describe('FilingSelector', () => {
  it('renders a <select> element', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('disabled when no filings', () => {
    render(
      <FilingSelector
        filings={[]}
        selectedAccession={null}
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('disabled when disabled prop is true', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={vi.fn()}
        disabled
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows placeholder "Select a filing..."', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByText('Select a filing...')).toBeInTheDocument();
  });

  it('renders options with "formType | filingDate" text', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByText('10-K | 2023-11-03')).toBeInTheDocument();
    expect(screen.getByText('10-Q | 2023-08-04')).toBeInTheDocument();
    expect(screen.getByText('10-K/A | 2023-05-05')).toBeInTheDocument();
  });

  it('calls onSelect with filing data on change', () => {
    const onSelect = vi.fn();
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={onSelect}
        aria-label="Select Filing A"
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'acc-002' },
    });

    expect(onSelect).toHaveBeenCalledWith(SAMPLE_FILINGS[1]);
  });

  it('does NOT call onSelect for placeholder selection', () => {
    const onSelect = vi.fn();
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={'acc-001'}
        onSelect={onSelect}
        aria-label="Select Filing A"
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '' },
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has aria-label attribute', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession={null}
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-label', 'Select Filing A');
  });

  it('reflects selectedAccession in value', () => {
    render(
      <FilingSelector
        filings={SAMPLE_FILINGS}
        selectedAccession="acc-002"
        onSelect={vi.fn()}
        aria-label="Select Filing A"
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('acc-002');
  });
});
