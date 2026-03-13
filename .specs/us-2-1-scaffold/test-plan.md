# US-2.1: React App Scaffold — Test Plan

## Overview

This test plan validates the React app scaffold (tracer bullet) for Epic 2. The scaffold must produce a working React 19 + TypeScript + Vite 6 app at `apps/web`, integrated into the Nx monorepo with inferred targets, a proven workspace dependency on `@edgar-diff/lib`, Tailwind CSS v4 (CSS-first via `@tailwindcss/vite`), and Chrome DevTools MCP for visual validation.

**Key implementation details (from design doc):**
- No `@nx/react` plugin — uses existing inferred targets (`typecheck`, `lint`, `test`) + explicit `dev`/`build` in `project.json`
- Tests are co-located with source in `src/` (pattern: `src/**/*.{test,spec}.{ts,tsx}`)
- Vitest config uses `@vitejs/plugin-react` (not `vite-tsconfig-paths`)
- Setup file at `src/test-setup.ts` imports `@testing-library/jest-dom/vitest`
- Dev and build targets have `dependsOn: ["^build"]` to ensure library is built first

---

## BDD Acceptance Criteria

### AC-1: Scaffold exists and builds

```gherkin
Given the monorepo contains an app at apps/web
When I run `pnpm nx run web:build`
Then the command exits with code 0
And a production bundle is produced in apps/web/dist/
```

### AC-2: Dev server starts and renders

```gherkin
Given the app is scaffolded
When I run `pnpm nx run web:dev`
Then a Vite dev server starts on port 5173
And navigating to http://localhost:5173 returns an HTML page
And the page renders "Edgar-Differ" title and FormType badges
```

### AC-3: Production build succeeds

```gherkin
Given the app source compiles without errors
When I run `pnpm nx run web:build`
Then the build completes without errors
And apps/web/dist/ contains index.html and at least one .js file in assets/
```

### AC-4: Typecheck passes

```gherkin
Given the app uses TypeScript with bundler moduleResolution and react-jsx
When I run `pnpm nx run web:typecheck`
Then the command exits with code 0
And no type errors are reported (including cross-workspace @edgar-diff/lib types)
```

### AC-5: Lint passes

```gherkin
Given ESLint is configured for the web app (via eslint.config.mjs import-x block)
When I run `pnpm nx run web:lint`
Then the command exits with code 0
And no lint errors are reported
```

### AC-6: Library workspace dep works

```gherkin
Given the app imports FormType from @edgar-diff/lib (workspace:* dependency)
When the app renders
Then the page displays all FormType values as styled badges (10-K, 10-Q, 8-K, etc.)
And the import resolves via pnpm workspace protocol (not npm registry)
```

### AC-7: Tailwind CSS configured and working

```gherkin
Given Tailwind CSS v4 is configured via @tailwindcss/vite plugin
And src/index.css contains `@import "tailwindcss"`
When the app renders with utility classes (bg-gray-50, text-3xl, rounded-lg, etc.)
Then the elements are styled with the corresponding CSS properties
```

### AC-8: Chrome DevTools MCP configured

```gherkin
Given Chromium is installed in the devcontainer (Debian bookworm package)
And .mcp.json at workspace root configures @anthropic-ai/chrome-devtools-mcp
And the MCP server uses --chrome-path=/usr/bin/chromium --headless
When the MCP server connects to headless Chromium
Then it can navigate to http://localhost:5173
And it can capture a screenshot of the rendered page
```

---

## Unit Tests

Unit tests run in Vitest with jsdom environment. Co-located with source in `src/`. Configured via `apps/web/vitest.config.ts` with `@vitejs/plugin-react` and `src/test-setup.ts`.

### UT-1: App component renders the title

```typescript
// apps/web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the title', () => {
    render(<App />);
    expect(screen.getByText('Edgar-Differ')).toBeDefined();
  });
});
```

**What it proves:** The component tree mounts without runtime errors and renders the expected title.

### UT-2: App component displays FormType values

```typescript
it('renders FormType values from the library', () => {
  render(<App />);
  expect(screen.getByText('10-K')).toBeDefined();
  expect(screen.getByText('10-Q')).toBeDefined();
});
```

**What it proves:** The workspace dependency import resolves at test time and the type's values render as badges.

### UT-3: Tailwind utility classes are present

```typescript
it('applies Tailwind utility classes', () => {
  render(<App />);
  const title = screen.getByText('Edgar-Differ');
  expect(title.className).toContain('text-3xl');
  expect(title.className).toContain('font-bold');
});
```

**What it proves:** Tailwind classes are present in the rendered DOM. (Full CSS computation is validated via Chrome DevTools MCP screenshot, not jsdom.)

> **Note:** jsdom does not compute CSS. The unit test verifies classes are applied; the Chrome DevTools MCP test (see MCP section) validates visual rendering.

### UT-4: All FormType values rendered

```typescript
it('renders all 13 FormType values', () => {
  render(<App />);
  const badges = screen.getAllByText(
    /^(10-K|10-K\/A|10-Q|10-Q\/A|8-K|8-K\/A|20-F|20-F\/A|S-1|S-1\/A|DEF 14A|SC 13D|SC 13D\/A)$/
  );
  expect(badges).toHaveLength(13);
});
```

**What it proves:** The hardcoded `formTypes` array in App.tsx contains all 13 FormType values. Catches accidental omissions.

---

## Integration Test

Integration test verifies the cross-boundary workspace dependency resolution. Build output and TypeScript compilation are validated as part of E2E tests (E2E-2 and E2E-3) since they are agent-driven shell commands, not Vitest tests.

### IT-1: Workspace dependency resolution

```typescript
// apps/web/src/workspace-dep.test.ts
import { describe, it, expect } from 'vitest';
import type { FormType } from '@edgar-diff/lib';

describe('workspace dependency', () => {
  it('resolves @edgar-diff/lib type imports', () => {
    // If this compiles and runs, the workspace dep type resolution works
    const formType: FormType = '10-K';
    expect(formType).toBe('10-K');
  });

  it('can import runtime values from the library', async () => {
    // Dynamic import to prove runtime resolution (not just type erasure)
    const lib = await import('@edgar-diff/lib');
    expect(lib).toBeDefined();
  });
});
```

**What it proves:** Vitest can resolve `@edgar-diff/lib` via pnpm workspace protocol, not just at Vite build time. The runtime import test is especially important — it proves the library's `dist/` output is accessible, not just the type declarations.

---

## End-to-End Tests (Build & Dev Server Validation)

These tests validate the Nx targets and dev server behavior. They run as shell commands or scripted checks.

### E2E-1: `pnpm nx run web:dev` starts successfully

```bash
# Start dev server in background
pnpm nx run web:dev &
DEV_PID=$!

# Wait for server to be ready (poll localhost until 200 or timeout after 30s)
# curl -s --retry 10 --retry-delay 2 http://localhost:5173 > /dev/null

# Verify: HTTP 200 response
# Verify: Response body contains <div id="root"> (or equivalent mount point)

# Cleanup
kill $DEV_PID
```

**What it proves:** The dev server boots and serves the app.

### E2E-2: `pnpm nx run web:build` produces valid output

```bash
pnpm nx run web:build

# Verify output structure:
ls apps/web/dist/index.html       # HTML entry point exists
ls apps/web/dist/assets/*.js      # JS bundle exists
ls apps/web/dist/assets/*.css     # Tailwind-processed CSS exists
# File sizes > 0
# index.html references the .js bundle via <script> tag
```

**What it proves:** The full Vite + React + TypeScript + Tailwind pipeline produces a deployable bundle with all expected assets (HTML, JS, CSS).

### E2E-3: `pnpm nx run web:typecheck` exits cleanly

```bash
pnpm nx run web:typecheck
echo $?  # Must be 0
```

**What it proves:** The app's TypeScript config (`bundler` moduleResolution, `react-jsx`, project references to `@edgar-diff/lib`) is correctly set up and all types resolve, including cross-workspace imports.

### E2E-4: `pnpm nx run web:lint` exits cleanly

```bash
pnpm nx run web:lint
echo $?  # Must be 0
```

---

## Chrome DevTools MCP Validation

These tests use the Chrome DevTools MCP server to validate visual rendering. They run after the dev server is started.

### MCP-1: Navigate to dev server

```
Action: mcp__chrome-devtools__navigate_page to http://localhost:5173
Expected: Page loads without errors
```

### MCP-2: Capture screenshot

```
Action: mcp__chrome-devtools__take_screenshot
Expected: Screenshot shows rendered content (not blank/error page)
```

### MCP-3: Verify page content

```
Action: mcp__chrome-devtools__evaluate_script
Script: document.body.innerText
Expected: Contains "10-K" or other FormType values, confirming library integration
```

### MCP-4: Verify Tailwind styling is applied

```
Action: mcp__chrome-devtools__evaluate_script
Script: getComputedStyle(document.querySelector('.bg-blue-100')).backgroundColor
Expected: Returns a computed blue-ish background color (not transparent/default), confirming Tailwind CSS v4 processing via @tailwindcss/vite
```

### MCP-5: Verify page structure matches App.tsx design

```
Action: mcp__chrome-devtools__evaluate_script
Script: document.querySelectorAll('.rounded-full').length
Expected: Returns 13 (one badge per FormType value), confirming all badges rendered
```

---

## Boundary Conditions

### BC-1: Library not built yet

```gherkin
Given @edgar-diff/lib has not been built (no dist/ output)
When I run `pnpm nx run web:build`
Then Nx dependency graph triggers lib build first via dependsOn: ["^build"]
And the web build succeeds without manual intervention
```

**Rationale:** The implementation design adds `dependsOn: ["^build"]` to both `build` and `dev` targets. This test validates that configuration works correctly — particularly important because the library exports from `./dist/index.js` (ESM), so the dist must exist before the web app can import it.

### BC-1a: Library not built for dev server

```gherkin
Given @edgar-diff/lib has not been built (no dist/ output)
When I run `pnpm nx run web:dev`
Then Nx builds the library first via dependsOn: ["^build"]
And the dev server starts and renders FormType values
```

**Rationale:** The design doc recommends `dependsOn: ["^build"]` on the dev target too. This validates it.

### BC-2: Incremental rebuild

```gherkin
Given the app has been built once
When I modify a source file in apps/web/src/
And run `pnpm nx run web:build` again
Then the build succeeds (no stale cache issues)
And Nx cache is used for unchanged dependencies
```

### BC-3: Empty FormType handling

```gherkin
Given the app references FormType values
When the FormType union is a valid but exhaustive set
Then the app renders at least one value without runtime error
```

> **Note:** `FormType` is a compile-time union type. There's no "empty" case at runtime — the app will use string literals. This boundary condition is mainly a compile-time concern covered by typecheck.

---

## Error Conditions

### EC-1: @edgar-diff/lib not available

```gherkin
Given the workspace dependency @edgar-diff/lib is removed from package.json
When I run `pnpm nx run web:typecheck`
Then TypeScript reports an error for the missing import
And the error message identifies the unresolved module
```

**Purpose:** Validates that the dependency is explicitly declared, not accidentally resolved.

### EC-2: Chrome not installed (MCP graceful failure)

```gherkin
Given Chrome is not installed in the environment
When the Chrome DevTools MCP server attempts to connect
Then it reports a clear error (not a crash or hang)
And other Nx targets (build, typecheck, lint) still work
```

**Purpose:** MCP is a development tool, not a build dependency. Its absence must not break the build pipeline.

---

## Test Data & Fixtures

### FormType values for rendering

The `FormType` union from `@edgar-diff/lib` provides these values:

```typescript
type FormType =
  | '10-K' | '10-K/A'
  | '10-Q' | '10-Q/A'
  | '8-K'  | '8-K/A'
  | '20-F' | '20-F/A'
  | 'S-1'  | 'S-1/A'
  | 'DEF 14A'
  | 'SC 13D' | 'SC 13D/A';
```

Per the design doc, the app renders **all** FormType values as styled badges to fully prove the import works.

### Expected build output structure

```
apps/web/dist/
├── index.html          # Entry point referencing JS/CSS assets
└── assets/
    ├── index-[hash].js  # Bundled application code
    └── index-[hash].css # Tailwind-processed styles
```

---

## Test Configuration

### Vitest config for web app (`apps/web/vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

Key differences from library's vitest config:
- `environment: 'jsdom'` (not `'node'`)
- Uses `@vitejs/plugin-react` (not `vite-tsconfig-paths`) — Vite's React plugin handles JSX transform
- Tests co-located in `src/` (not separate `tests/` directory)
- Setup file imports `@testing-library/jest-dom/vitest` for DOM matchers

### Test setup file (`apps/web/src/test-setup.ts`)

```typescript
import '@testing-library/jest-dom/vitest';
```

### Required devDependencies (in `apps/web/package.json`)

```json
{
  "@vitejs/plugin-react": "^4.5.2",
  "vitest": "^4.0.18",
  "@testing-library/react": "^16.3.0",
  "@testing-library/jest-dom": "^6.6.3",
  "jsdom": "^26.1.0"
}
```

### Test file locations (co-located with source)

```
apps/web/
├── vitest.config.ts
└── src/
    ├── App.tsx
    ├── App.test.tsx              # UT-1, UT-2, UT-3, UT-4
    ├── workspace-dep.test.ts     # IT-1
    └── test-setup.ts             # jest-dom matchers
```

---

## Test Execution Summary

| Test ID | Type | Automated | Tool | Blocks |
|---------|------|-----------|------|--------|
| UT-1 | Unit | Yes (`pnpm nx run web:test`) | Vitest + RTL (jsdom) | — |
| UT-2 | Unit | Yes (`pnpm nx run web:test`) | Vitest + RTL (jsdom) | — |
| UT-3 | Unit | Yes (`pnpm nx run web:test`) | Vitest + RTL (jsdom) | — |
| UT-4 | Unit | Yes (`pnpm nx run web:test`) | Vitest + RTL (jsdom) | — |
| IT-1 | Integration | Yes (`pnpm nx run web:test`) | Vitest | — |
| E2E-1 | E2E | Agent-driven | Shell / Nx | — |
| E2E-2 | E2E | Agent-driven | Shell / Nx | — |
| E2E-3 | E2E | Agent-driven | Shell / Nx | — |
| E2E-4 | E2E | Agent-driven | Shell / Nx | — |
| MCP-1 | Visual | Agent-driven | Chrome DevTools MCP | E2E-1 |
| MCP-2 | Visual | Agent-driven | Chrome DevTools MCP | MCP-1 |
| MCP-3 | Visual | Agent-driven | Chrome DevTools MCP | MCP-1 |
| MCP-4 | Visual | Agent-driven | Chrome DevTools MCP | MCP-1 |
| MCP-5 | Visual | Agent-driven | Chrome DevTools MCP | MCP-1 |
| BC-1 | Boundary | Agent-driven | Shell | — |
| BC-1a | Boundary | Agent-driven | Shell | — |
| BC-2 | Boundary | Agent-driven | Shell | E2E-2 |
| EC-1 | Error | Agent-driven | Shell | — |
| EC-2 | Error | Agent-driven | Shell | — |

**Automated tests** (UT-1 through IT-1) run via `pnpm nx run web:test` and are included in `pnpm nx run-many --target=test`.

**Agent-driven tests** are executed by the implementing agent during validation. They are not CI-automated but follow a repeatable script.

## Verification Order

The recommended validation sequence during implementation:

1. `pnpm nx run web:typecheck` (E2E-3) — catches type errors early
2. `pnpm nx run web:lint` (E2E-4) — catches style/import errors
3. `pnpm nx run web:test` (UT-1 through UT-4, IT-1) — component + dep tests
4. `pnpm nx run web:build` (E2E-2) — full production build with output verification
5. `pnpm nx run web:dev` → MCP validation (E2E-1, MCP-1 through MCP-5) — visual proof
6. Boundary/error conditions (BC-1, BC-1a, BC-2, EC-1, EC-2) — edge cases
