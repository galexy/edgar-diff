# US-2.1: React App Scaffold — Implementation Design

## Approach

Scaffold a minimal React + TypeScript + Vite app at `apps/web` that integrates with the existing Nx monorepo. Use Nx inferred targets (via existing plugins) rather than explicit `project.json` targets where possible. Prove the workspace dependency works by importing `FormType` from `@edgar-diff/lib`. Configure Tailwind CSS v4 with its new CSS-first approach. Install Chrome in the devcontainer and configure the Chrome DevTools MCP server.

**Key design decisions:**
- **No `@nx/react` plugin** — the existing Nx setup uses inferred targets from `@nx/js/typescript`, `@nx/eslint/plugin`, and `@nx/vitest`. Adding `@nx/react` would introduce a new plugin with its own target inference that may conflict. Instead, we manually create the Vite config with `@vitejs/plugin-react` and rely on the existing Nx plugins for typecheck, lint, and test targets. We add explicit `dev` and `build` targets via `project.json` since those are Vite-specific and not covered by existing plugins.
- **Tailwind v4 CSS-first** — no `tailwind.config.js`, just `@import "tailwindcss"` in the app's CSS entry point.
- **Minimal app** — renders a page showing the `FormType` values from the library. No routing, no state management, no data fetching.

## Files to Create

### `apps/web/package.json`

Package manifest declaring the app and its dependencies.

```json
{
  "name": "@edgar-diff/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "nx": {
    "tags": ["scope:app", "type:web"]
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@edgar-diff/lib": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.2",
    "@tailwindcss/vite": "^4.1.0",
    "tailwindcss": "^4.1.0",
    "vite": "^6.3.0",
    "vitest": "^4.0.18",
    "@testing-library/react": "^16.3.0",
    "@testing-library/jest-dom": "^6.6.3",
    "jsdom": "^26.1.0"
  }
}
```

### `apps/web/project.json`

Nx project configuration with explicit `dev` and `build` targets (Vite-specific). The `typecheck`, `lint`, and `test` targets are inferred by existing Nx plugins.

```json
{
  "name": "web",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/web/src",
  "targets": {
    "dev": {
      "command": "vite dev",
      "options": {
        "cwd": "apps/web"
      },
      "dependsOn": ["^build"]
    },
    "build": {
      "command": "vite build",
      "options": {
        "cwd": "apps/web"
      },
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "outputs": ["{projectRoot}/dist"],
      "cache": true
    }
  }
}
```

### `apps/web/tsconfig.json`

Extends the workspace base. Adds `DOM` and `DOM.Iterable` libs for browser APIs, and uses `jsx: "react-jsx"` for React 19's JSX transform. Uses `bundler` module resolution (required by Vite — the base config's `nodenext` is for Node.js libraries).

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false,
    "incremental": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["dist", "node_modules"],
  "references": [
    { "path": "../../libs/edgar-diff-lib" }
  ]
}
```

**Note:** `noEmit: true` because Vite handles bundling — TypeScript is only used for type-checking. `composite: false` and `incremental: false` override the base config to avoid the known TypeScript conflict between `composite` and `noEmit`. The app doesn't emit declarations (it's not consumed by other projects), so `composite` is unnecessary. The `references` array still enables project-reference-based type-checking against the library.

### `apps/web/vite.config.ts`

Vite configuration with React plugin. Resolves the workspace dependency via pnpm workspace protocol.

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // Bind to 0.0.0.0 for devcontainer access
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

### `apps/web/vitest.config.ts`

Vitest configuration for component tests. Uses jsdom environment for React Testing Library.

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

### `apps/web/index.html`

Vite entry point HTML file (must be at app root, not in `src/`).

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Edgar-Differ</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `apps/web/src/main.tsx`

React entry point. Mounts the App component.

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `apps/web/src/index.css`

Tailwind CSS v4 entry point. Uses the new CSS-first config — no `tailwind.config.js` needed.

```css
@import "tailwindcss";
```

### `apps/web/src/App.tsx`

Minimal app component that imports `FormType` from the library to prove the workspace dependency. Renders the type's values and uses a Tailwind utility class.

```tsx
import type { FormType } from '@edgar-diff/lib';

const formTypes: FormType[] = [
  '10-K', '10-K/A', '10-Q', '10-Q/A',
  '8-K', '8-K/A', '20-F', '20-F/A',
  'S-1', 'S-1/A', 'DEF 14A',
  'SC 13D', 'SC 13D/A',
];

export function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        Edgar-Differ
      </h1>
      <p className="text-gray-600 mb-6">
        SEC Filing Comparison Tool
      </p>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">
          Supported Form Types
        </h2>
        <div className="flex flex-wrap gap-2">
          {formTypes.map((ft) => (
            <span
              key={ft}
              className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
            >
              {ft}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Note:** We import `FormType` as a `type` import and use the literal values in a typed array. This proves the workspace dependency resolves correctly at both the TypeScript and runtime level (the type constrains the array, and the array values render in the browser).

### `apps/web/src/App.test.tsx`

Smoke test proving the app renders and the library dependency works.

```tsx
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

### `apps/web/src/test-setup.ts`

Test setup file for jsdom environment.

```typescript
import '@testing-library/jest-dom/vitest';
```

### `apps/web/src/vite-env.d.ts`

Vite client type declarations.

```typescript
/// <reference types="vite/client" />
```

## Files to Modify

### `eslint.config.mjs`

Add `*.tsx` to the existing file patterns so the Nx module boundary rules and eslint apply to React files. The existing config already includes `**/*.tsx` in the module boundary rule, so no change is needed there. We add a new block for the web app's import resolution:

```javascript
// After the existing lib import-x block, add:
{
  files: ['apps/web/src/**/*.{ts,tsx}'],
  plugins: {
    'import-x': importXPlugin,
  },
  settings: {
    'import-x/resolver-next': [tsNodeResolver],
  },
},
```

### `.devcontainer/Dockerfile`

Add Chromium installation for headless browser testing. Insert after the Node.js installation block (before the dolt install):

```dockerfile
# Install Chromium for headless browser testing (Chrome DevTools MCP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**Why Chromium over Chrome?** Chromium is available in Debian's apt repos (`bookworm`), avoiding the need for Google's apt repo. It's functionally equivalent for DevTools Protocol use.

### `.mcp.json` (new file at workspace root)

Chrome DevTools MCP server configuration. This file is read by Claude Code to discover available MCP servers.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic-ai/chrome-devtools-mcp@latest",
        "--chrome-path=/usr/bin/chromium",
        "--headless",
        "--no-sandbox"
      ]
    }
  }
}
```

### `.devcontainer/devcontainer.json`

Add `CHROME_PATH` to `containerEnv` so tools can discover Chrome:

```json
"CHROME_PATH": "/usr/bin/chromium"
```

## Package Dependencies

### Production (apps/web)
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.1.0 | UI framework |
| `react-dom` | ^19.1.0 | DOM renderer |
| `@edgar-diff/lib` | workspace:* | Workspace library dependency |

### Development (apps/web)
| Package | Version | Purpose |
|---------|---------|---------|
| `@types/react` | ^19.1.0 | React type definitions |
| `@types/react-dom` | ^19.1.0 | ReactDOM type definitions |
| `@vitejs/plugin-react` | ^4.5.2 | Vite React plugin (JSX transform, Fast Refresh) |
| `@tailwindcss/vite` | ^4.1.0 | Tailwind CSS v4 Vite plugin (explicit integration) |
| `tailwindcss` | ^4.1.0 | Tailwind CSS v4 (CSS-first config) |
| `vite` | ^6.3.0 | Build tool and dev server |
| `vitest` | ^4.0.18 | Test runner (matches workspace version) |
| `@testing-library/react` | ^16.3.0 | React component testing utilities |
| `@testing-library/jest-dom` | ^6.6.3 | DOM assertion matchers |
| `jsdom` | ^26.1.0 | DOM environment for tests |

### Global (devcontainer)
| Package | Purpose |
|---------|---------|
| `chromium` (apt) | Headless browser for Chrome DevTools MCP |
| `@anthropic-ai/chrome-devtools-mcp` (npx) | MCP server for browser automation |

## Nx Configuration

The app integrates with existing Nx setup via:

1. **Inferred targets** from existing plugins:
   - `@nx/js/typescript` → `typecheck` target (reads `tsconfig.json`)
   - `@nx/eslint/plugin` → `lint` target (reads `eslint.config.mjs`)
   - `@nx/vitest` → `test` target (reads `vitest.config.ts`)

2. **Explicit targets** in `project.json`:
   - `dev` → `vite dev` (no Nx plugin equivalent)
   - `build` → `vite build` (custom command, not using `@nx/js/typescript` build which is for library tsc builds)

3. **Workspace detection**: pnpm workspace already includes `apps/*`, so `apps/web` is auto-detected.

4. **No changes to `nx.json`** — existing named inputs, target defaults, and plugins work as-is.

## TypeScript Configuration

The app's `tsconfig.json` diverges from the base config in two key areas:

| Setting | Base | App | Why |
|---------|------|-----|-----|
| `module` | `nodenext` | `ESNext` | Vite uses ESM bundling, not Node.js resolution |
| `moduleResolution` | `nodenext` | `bundler` | Vite resolves bare specifiers differently than Node |
| `lib` | `ES2022` | `ES2022, DOM, DOM.Iterable` | Browser APIs needed |
| `jsx` | (none) | `react-jsx` | React 19 JSX transform |
| `composite` | `true` | `false` | App doesn't emit declarations; avoids `composite`+`noEmit` conflict |
| `incremental` | `true` | `false` | Not needed without `composite` |
| `noEmit` | (none) | `true` | Vite handles emit; tsc is type-check only |

The `references` array points to the library so `tsc --build` can resolve cross-project types.

## Tailwind CSS v4 Setup

Tailwind v4 uses a CSS-first configuration model:

1. Install `tailwindcss` v4 and `@tailwindcss/vite` as dev dependencies
2. Add `@tailwindcss/vite` plugin to `vite.config.ts` (explicit integration, more reliable than auto-detection)
3. In `src/index.css`, add `@import "tailwindcss"` — this is the entire CSS config
4. No `tailwind.config.js`, no `postcss.config.js` needed

**Verification:** The `App.tsx` uses utility classes like `bg-gray-50`, `text-3xl`, `rounded-lg` etc. If Tailwind is working, these render styled content. If not, the page renders unstyled.

## Chrome DevTools MCP Configuration

The Chrome DevTools MCP server enables Claude agents to:
- Navigate to URLs in a headless Chrome instance
- Take screenshots for visual verification
- Inspect DOM elements, console output, and network requests
- Validate that the app renders correctly

**Setup:**
1. Install `chromium` in the devcontainer Dockerfile (Debian bookworm package)
2. Add `.mcp.json` at workspace root with the Chrome DevTools MCP server config
3. The MCP server launches Chrome on demand via `npx @anthropic-ai/chrome-devtools-mcp`
4. Set `CHROME_PATH` env var so the MCP server can find the Chromium binary

**Validation flow:**
1. Start dev server: `pnpm nx run web:dev`
2. MCP navigates to `http://localhost:5173`
3. Take screenshot → verify "Edgar-Differ" title and FormType badges render
4. Verify Tailwind styles are applied (colored badges, proper layout)

## Edge Cases and Risks

### ESM Workspace Dependency Resolution
The library (`@edgar-diff/lib`) exports from `./dist/index.js`. The app imports via `@edgar-diff/lib`. For this to work:
- The library must be built first (`pnpm nx run edgar-diff-lib:build`)
- Nx's `dependsOn: ["^build"]` on the web app's build target ensures this
- For `dev` mode, `dependsOn: ["^build"]` on the dev target ensures Nx builds the library before starting the dev server.

### Tailwind v4 + Vite Integration
We use `@tailwindcss/vite` explicitly in the Vite config rather than relying on Tailwind's auto-detection. This is the documented approach for Vite in Tailwind v4 and avoids subtle CSS processing issues.

### TypeScript Project References
The base `tsconfig.base.json` has `composite: true` and `incremental: true`. The app's tsconfig overrides both to `false` and sets `noEmit: true`, avoiding the known `composite`+`noEmit` conflict. The app doesn't need `composite` because it's not consumed by other projects — it's a leaf application. The `references` array still works for cross-project type-checking.

### Chromium in Devcontainer
Chromium requires several system libraries (libgbm, libnss3, etc.). The Dockerfile must install these. The `--headless` and `--no-sandbox` flags are included in the MCP config by default since we're always running in a container environment with no display server.

## Resolved Decisions

1. **Tailwind v4 Vite plugin:** Using `@tailwindcss/vite` explicitly — more reliable than auto-detection.
2. **Dev server `dependsOn`:** Yes, `dev` target includes `dependsOn: ["^build"]` to auto-build the library.
3. **TypeScript `composite` + `noEmit`:** Resolved by setting `composite: false` and `incremental: false` in the app tsconfig. The app is a leaf project and doesn't need `composite`.
4. **Chromium `--no-sandbox`:** Included by default in `.mcp.json` since we always run in a container.

## Open Questions

1. **MCP server startup:** The `npx -y` approach downloads the package on first use. Should we pin it as a devDependency instead for reproducibility? **Recommendation:** Keep `npx -y` for now — it's the documented approach and avoids cluttering the root package.json.

## Implementation Checklist

1. Create `apps/web/` directory structure (remove `.gitkeep`)
2. Write `apps/web/package.json`
3. Write `apps/web/project.json`
4. Write `apps/web/tsconfig.json`
5. Write `apps/web/vite.config.ts`
6. Write `apps/web/vitest.config.ts`
7. Write `apps/web/index.html`
8. Write `apps/web/src/main.tsx`
9. Write `apps/web/src/index.css`
10. Write `apps/web/src/App.tsx`
11. Write `apps/web/src/App.test.tsx`
12. Write `apps/web/src/test-setup.ts`
13. Write `apps/web/src/vite-env.d.ts`
14. Update `eslint.config.mjs` with web app import resolution
15. Update `.devcontainer/Dockerfile` with Chromium
16. Create `.mcp.json` at workspace root
17. Update `.devcontainer/devcontainer.json` with `CHROME_PATH`
18. Run `pnpm install` to resolve dependencies
19. Verify: `pnpm nx run web:typecheck`
20. Verify: `pnpm nx run web:lint`
21. Verify: `pnpm nx run web:test`
22. Verify: `pnpm nx run web:build`
23. Verify: `pnpm nx run web:dev` → page renders in browser
24. Verify: Chrome DevTools MCP can navigate and screenshot
