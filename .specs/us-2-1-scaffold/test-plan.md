# US-2.1: React App Scaffold — Test Plan

## Overview

This story is a scaffold/tracer-bullet. Most acceptance criteria (build works, typecheck passes, lint passes, dev server starts) are verified by running the commands during development — they don't need dedicated test cases.

The only tests that need to be **written as code** prove two things that aren't obvious from just running commands:
1. The workspace dependency (`@edgar-diff/lib`) resolves correctly in the test environment
2. The app component renders the expected content

## Test Code to Write

### `apps/web/src/App.test.tsx` — Smoke test

A single test file with two tests. This is the minimum viable test for the scaffold.

```typescript
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
```

**Why these two tests:**
- The title test proves the component mounts without errors.
- The FormType test proves the `@edgar-diff/lib` workspace dependency resolves at test time (not just build time). This is the key integration point for the tracer-bullet — if Vitest can import from the workspace library and render its types, the monorepo wiring works.

### Test infrastructure

The test infrastructure itself is part of the scaffold deliverable:

- `apps/web/vitest.config.ts` — jsdom environment, `@vitejs/plugin-react`, co-located tests in `src/`
- `apps/web/src/test-setup.ts` — imports `@testing-library/jest-dom/vitest`
- devDeps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`

Run with: `pnpm nx run web:test`

## Chrome DevTools MCP Validation

After the dev server is running, the implementing agent should use MCP to visually confirm the page renders:

1. Navigate to `http://localhost:5173`
2. Take a screenshot
3. Verify the page shows "Edgar-Differ" title and FormType badges with Tailwind styling

This is an agent workflow step, not a test to write.
