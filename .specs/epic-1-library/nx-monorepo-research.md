---
title: Nx Monorepo Scaffolding Research
created: "2026-03-02"
bead-id: edgar-diff-vda.10
status: research
---

# Nx Monorepo Scaffolding Research

Research findings for scaffolding the edgar-diff monorepo. Covers Nx 22.5 (current stable) with pnpm.

---

## 1. Workspace Initialization

Bootstrap with:

```bash
npx create-nx-workspace edgar-diff --preset=ts --packageManager=pnpm
```

The `ts` preset provides a minimal integrated TypeScript workspace with no framework-specific boilerplate. Key flags: `--unitTestRunner=vitest`, `--workspaces` (default true in Nx 22).

### Integrated vs Package-Based

Nx has converged these models. The current recommendation combines **pnpm workspaces** (native package resolution via `workspace:*` protocol) with **TypeScript project references** (incremental type checking). This gives the linking ergonomics of package-based setups with the tight integration of the integrated model.

---

## 2. pnpm Workspace Integration

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'libs/*'
```

### Root package.json

- `"private": true` — root is never published
- Pin `packageManager` field for reproducibility
- All `@nx/*` plugin versions **must** match the `nx` version exactly

### Workspace Protocol

Internal dependencies use `"workspace:*"` in package.json, which tells pnpm to symlink local packages rather than fetching from registry.

### Dependency Resolution

pnpm uses a content-addressable store with hard links. Does not hoist by default — stricter than npm, catches implicit dependency issues early.

---

## 3. Project Structure

```
edgar-diff/
  apps/                          # Deployable applications
  libs/
    edgar-diff-lib/              # Core library
      package.json
      src/
      tsconfig.json
      vitest.config.ts
  nx.json
  pnpm-workspace.yaml
  tsconfig.base.json
  package.json
```

### project.json vs package.json Inference

With Project Crystal (Nx 18+), Nx plugins **infer targets automatically** from tool config files (vite.config.ts, tsconfig.json, etc.). Explicit `project.json` files are often unnecessary.

Configuration precedence (lowest → highest):
1. Inferred configurations from plugins
2. `targetDefaults` in `nx.json`
3. Project-specific `project.json` or `package.json`

Use `nx show project my-project --web` to see inferred configuration.

---

## 4. Nx Configuration (nx.json)

Key sections:

- **`plugins`** — drives Project Crystal inference. Register `@nx/js/typescript`, `@nx/eslint/plugin`, `@nx/vitest/plugin`.
- **`namedInputs`** — reusable file glob sets for caching (e.g., `production` excludes test files).
- **`targetDefaults`** — default settings for targets across all projects. `dependsOn: ["^build"]` means "build upstream dependencies first."
- **`defaultBase`** — branch for `nx affected` calculations.
- **`cache: true`** on targets enables local (and remote) caching.

### Task Caching

Nx hashes source files, config, dependency versions, and CLI flags. On hit: replays terminal output and restores cached artifacts. On miss: runs the task and stores results.

---

## 5. Enforce Module Boundaries

The `@nx/enforce-module-boundaries` ESLint rule uses a **tag-based system**:

1. **Assign tags** to projects in `package.json` (under `"nx": { "tags": [...] }`) or `project.json`.
2. **Configure constraints** in ESLint config with `depConstraints` array.

Each constraint specifies `sourceTag` and either `onlyDependOnLibsWithTags` (whitelist) or `notDependOnLibsWithTags` (blacklist).

For our project, the architecture doc specifies: `client` has no dependency on `parser` or `diff`; `parser` imports only from `client/types`; `diff` imports only from `parser/types`. These are intra-library module boundaries, which are enforced differently — either via ESLint rules on import paths or by splitting into separate Nx projects with tags.

---

## 6. TypeScript Configuration

### Recommended: TypeScript Project References

Since Nx 20+ (Jan 2025), new workspaces should use TS project references combined with pnpm workspaces.

Performance benchmarks from Nx team:
- Without project references: ~186s typecheck, 6.14 GB memory
- With project references + `.tsbuildinfo`: ~25s typecheck, 429 MB memory

### Root tsconfig.base.json

Key settings: `"composite": true`, `"incremental": true`, `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"strict": true`.

### Root tsconfig.json (references hub)

Lists all projects as references. `nx sync` automatically maintains this array.

### Per-Project tsconfig.json

Extends base, declares `references` to sibling packages it depends on.

---

## 7. Vitest Integration

As of Nx 22, use `@nx/vitest` (dedicated plugin, replacing older `@nx/vite` test support).

Register in nx.json plugins array. The plugin auto-infers a `test` target for any project with a `vitest.config.ts`.

Key vitest.config.ts patterns:
- Set `root: __dirname` for correct monorepo path resolution
- Use `vite-tsconfig-paths` plugin to resolve cross-project imports
- Point `coverage.reportsDirectory` to workspace-level directory for caching

Note: `@nx/vite:test` executor is deprecated in Nx 22, removed in Nx 23.

---

## 8. Build Options for TypeScript Libraries

| Tool | Speed | Type Checking | Best For |
|------|-------|---------------|----------|
| tsc | Moderate | Full | Libraries needing type checking; batch mode competitive |
| swc | Fast | None | Speed-critical builds; pair with separate typecheck |
| esbuild | Very fast | None | CLIs, bundled Node.js apps |
| rollup | Moderate | None | Publishable npm packages, multiple output formats |

For internal-consumption libraries like edgar-diff-lib, **tsc with project references** is the simplest and most correct choice. Batch mode makes it competitive with faster transpilers.

---

## 9. Developer Experience Tools

- **`nx affected -t test`** — runs tasks only on projects impacted by current changes
- **`nx graph`** — interactive dependency visualization
- **`nx run-many -t build test`** — run across all/selected projects
- **`nrwl/nx-set-shas`** — GitHub Action for correct affected base SHA in CI

---

## Key Decisions for Our Project

Based on this research, the main choices for edgar-diff:

1. **Workspace model**: pnpm workspaces + TS project references (current recommendation)
2. **Project inference**: Let Project Crystal infer targets; use project.json only for overrides
3. **Build tool**: tsc (correctness over speed for a library; no bundling needed)
4. **Module boundaries**: Tag-based enforcement via ESLint if we split into multiple Nx projects; import-path rules if we keep a single library project with internal modules
5. **Vitest**: `@nx/vitest` plugin with per-project vitest.config.ts
