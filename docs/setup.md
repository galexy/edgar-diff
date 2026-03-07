# Development Setup

## Prerequisites

- Node.js >= 20 (devcontainer uses v22 LTS)
- pnpm (managed via corepack — do NOT install globally)
- Git

## Initial Setup

```bash
# 1. Enable corepack (provides pnpm from package.json#packageManager)
corepack enable

# 2. Install dependencies
pnpm install

# 3. Verify everything works
pnpm nx run-many --target=typecheck
pnpm nx run-many --target=test
```

## Running Tasks via Nx

All tasks go through Nx. Do NOT call `vitest`, `tsc`, or `eslint` directly at the root.

```bash
# Typecheck all projects
pnpm nx run-many --target=typecheck

# Run all tests (unit + integration + fixture e2e + acceptance)
pnpm nx run-many --target=test

# Lint all projects
pnpm nx run-many --target=lint

# Run only affected (faster for PRs)
pnpm nx affected --target=test
pnpm nx affected --target=typecheck
pnpm nx affected --target=lint

# Single project
pnpm nx test edgar-diff-lib
pnpm nx typecheck edgar-diff-lib

# Live e2e (hits real EDGAR — not in CI by default)
cd libs/edgar-diff-lib && pnpm vitest run --config vitest.live.config.ts
```

## Common Errors

### `pnpm: command not found` (especially in worktrees)

**Cause:** Corepack is not enabled in the current shell/environment.

**Fix:**
```bash
corepack enable
```

If you see `corepack: command not found`, Node.js was installed without corepack. Re-install Node.js >= 16.13 or run:
```bash
npm install -g corepack
corepack enable
```

### `ERR_PNPM_MISMATCHED_PACKAGE_MANAGER` or version warnings

**Cause:** A globally-installed pnpm conflicts with the version in `package.json#packageManager`.

**Fix:** Remove the global pnpm and use corepack:
```bash
npm uninstall -g pnpm
corepack enable
```

Corepack reads `"packageManager": "pnpm@10.30.3"` from `package.json` and uses exactly that version.

### `nx: command not found`

**Cause:** Nx is a devDependency, not a global install.

**Fix:** Always prefix with `pnpm`:
```bash
pnpm nx run-many --target=test
```

Or use `npx nx` if you prefer.

### Worktree / subagent pnpm errors

When Claude Code spawns agents in git worktrees, the worktree may not have `node_modules`. The agent needs to:

1. Ensure corepack is enabled: `corepack enable`
2. Install dependencies: `pnpm install`
3. Then run tasks normally

If the worktree sees lockfile conflicts, use `pnpm install --frozen-lockfile` to avoid modifying it.

### `Cannot find module` errors after switching branches

**Fix:**
```bash
pnpm install
pnpm nx reset
```

The `nx reset` clears Nx's cache, which can hold stale data across branch switches.
