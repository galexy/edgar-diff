import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
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

  // SS-H1: Renders sync toggle button when props provided
  it('renders sync toggle button with aria-pressed=true when syncEnabled', () => {
    render(<Header syncEnabled={true} onSyncToggle={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  // SS-H2: Toggle button shows aria-pressed=false when sync disabled
  it('renders toggle with aria-pressed=false when syncEnabled is false', () => {
    render(<Header syncEnabled={false} onSyncToggle={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  // SS-H3: Click calls onSyncToggle
  it('calls onSyncToggle when toggle button is clicked', async () => {
    const onToggle = vi.fn();
    render(<Header syncEnabled={true} onSyncToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /sync scroll/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // SS-H4: Does not render toggle when props omitted (backward compat)
  it('does not render toggle button when onSyncToggle is not provided', () => {
    render(<Header />);
    expect(screen.queryByRole('button', { name: /sync scroll/i })).not.toBeInTheDocument();
  });
});
