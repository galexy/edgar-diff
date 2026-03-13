import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Header } from './Header';

describe('Header', () => {
  it('renders within a <header> semantic element', () => {
    render(<Header />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('displays "Edgar-Differ" as the title', () => {
    render(<Header />);
    expect(screen.getByText('Edgar-Differ')).toBeInTheDocument();
  });
});
