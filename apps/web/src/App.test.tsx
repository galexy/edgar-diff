import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the title', () => {
    render(<App />);
    expect(screen.getByText('Edgar-Differ')).toBeDefined();
  });

  it('renders FormType values from the library', () => {
    render(<App />);
    expect(screen.getByText('10-K')).toBeDefined();
    expect(screen.getByText('10-Q')).toBeDefined();
  });
});
