import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SectionNav } from './SectionNav';

describe('SectionNav', () => {
  it('renders within a <nav> semantic element', () => {
    render(<SectionNav />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('displays placeholder section items', () => {
    render(<SectionNav />);
    expect(screen.getByText('Item 1. Business')).toBeInTheDocument();
    expect(screen.getByText('Item 1A. Risk Factors')).toBeInTheDocument();
  });

  it('renders section items as buttons in a list', () => {
    render(<SectionNav />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
  });
});
