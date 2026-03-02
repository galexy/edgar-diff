---
title: "Monorepo Scaffold — Design Document"
bead-id: edgar-diff-vda.10
created: "2026-03-02"
status: draft
---

# Monorepo Scaffold Design

This document describes the design for scaffolding the edgar-diff Nx monorepo. It covers **what** we're building and **why**, using concrete details only where they clarify the design intent.

The fixed decisions — TypeScript, pnpm, Nx, vitest, Temporal API — are established in the [architecture doc](architecture.md) and not revisited here.

---

## 1. Workspace Model

### The Choice: pnpm Workspaces + TypeScript Project References

Nx offers two historical workspace models: *integrated* (centralized config, TS path aliases for cross-project linking) and *package-based* (each package owns its config, npm workspace protocol for linking). As of Nx 22, these have converged into a single recommended approach that combines the strengths of both:

- **pnpm workspaces** handle package discovery and linking. Internal packages reference each other via the `workspace:*` protocol, which tells pnpm to symlink the local copy. This is standard pnpm behavior — nothing Nx-specific.
- **TypeScript project references** handle incremental type checking. Each package declares its dependencies as TS `references`, enabling `tsc --build` to check only what changed. The Nx team reports 7x speedup and 14x memory reduction compared to non-referenced typechecking.
- **Nx** sits on top as a task orchestrator. It infers build/test/lint targets from config files, caches results, and runs tasks in dependency order.

This model means our packages are real npm packages with real `package.json` files. They could, in principle, be extracted to standalone repos or published to a registry. This is a healthy property for a library that downstream epics will consume.

### Why Not Pure Integrated?

The older integrated model uses TypeScript path aliases (`@edgar-diff/lib` → `libs/edgar-diff-lib/src/index.ts`) defined in a root tsconfig. This works but has two downsides: (1) path aliases are a TypeScript-only concept that tools like vitest and eslint need special plugins to understand, and (2) it couples all packages to the monorepo — they can't resolve each other's imports outside the workspace. The project references approach uses standard Node module resolution, which every tool already understands.

---

## 2. Project Layout

The architecture doc defines the directory structure. The scaffold creates the skeleton:

```
edgar-diff/
├── apps/                          # Empty; ready for Epic 2
├── libs/
│   └── edgar-diff-lib/
│       ├── src/
│       │   └── index.ts           # Barrel — empty initially
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   │   └── fixtures/
│       │   └── fuzz/
│       ├── spikes/
│       │   ├── source-mapping/
│       │   └── diff-algorithm/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.lib.json
│       └── vitest.config.ts
├── nx.json
├── tsconfig.base.json
├── tsconfig.json
├── pnpm-workspace.yaml
├── package.json
├── .npmrc
└── eslint.config.mjs
```

### Design Rationale

**`libs/` not `packages/`** — The architecture doc uses `libs/` and we follow it. The name is conventional in Nx; the actual mechanics are identical regardless of directory name.

**`tsconfig.base.json` + `tsconfig.json` at root** — `tsconfig.base.json` holds shared compiler options that all projects extend. `tsconfig.json` at root is a "solution-style" config that lists all projects as `references` — it's the entry point for `tsc --build` across the whole workspace. Nx's `nx sync` command keeps this references list in sync automatically.

**`tsconfig.lib.json` in the library** — Separates build config from general config. The base `tsconfig.json` includes test files (for editor support); `tsconfig.lib.json` excludes them (for production builds). This is a standard Nx pattern.

**No `project.json`** — Nx 22's Project Crystal infers targets from config files. A `vitest.config.ts` automatically creates a `test` target; a `tsconfig.json` with `composite: true` creates `build` and `typecheck` targets. We rely on inference and avoid maintaining redundant config. If we later need custom target configuration, we add a `project.json` at that point.

**`spikes/` inside the library** — Spike code lives alongside the library it informs. The spikes directory is excluded from builds via tsconfig but is accessible to developers working on the library. This keeps spike artifacts close to the code they'll eventually influence, rather than floating at the repo root.

**`tests/` alongside `src/`** — Tests are co-located with the library but in a parallel directory rather than mixed into `src/`. This lets us exclude tests from the build output cleanly via tsconfig, while keeping them navigable. The `fixtures/` directory under `integration/` will hold real SEC filing HTML files committed to the repo.

---

## 3. Dependency Management

### Root Dependencies

The root `package.json` holds only **tooling** dependencies — things that orchestrate the workspace but aren't runtime code:

- `nx` and `@nx/*` plugins (js, vitest, eslint)
- `typescript` (shared compiler)
- `eslint` and related plugins
- `prettier` (if used)

All `@nx/*` versions must match the `nx` version exactly. Version drift between Nx plugins produces subtle, hard-to-diagnose failures.

### Library Dependencies

The library's `package.json` declares its own dependencies:

- **Runtime**: `htmlparser2`, `@js-temporal/polyfill`
- **Dev**: `vitest` (if not hoisted)

This separation matters because the library is a consumable package. Its `package.json` must accurately describe what it needs — a consumer installing it shouldn't need to guess.

### The `workspace:*` Protocol

When a future Epic 2 web app depends on `edgar-diff-lib`, its `package.json` will say:

```json
{ "dependencies": { "@edgar-diff/lib": "workspace:*" } }
```

pnpm resolves this to a symlink. No publishing, no version gymnastics. But the dependency is explicit and discoverable — `pnpm why @edgar-diff/lib` works, Nx's dependency graph picks it up, and module boundary rules can enforce constraints on it.

### pnpm Strictness

pnpm's default behavior is strict: a package can only import what it declares in its own `package.json`. This is unlike npm's flat `node_modules`, where any transitively-installed package is importable. The strictness is desirable — it catches "phantom dependencies" (imports that work locally because something else installed the package, but would fail in isolation).

We configure `.npmrc` to keep this strictness:

```ini
shamefully-hoist=false
public-hoist-pattern[]=*types*
public-hoist-pattern[]=*eslint*
```

The `public-hoist-pattern` exceptions are pragmatic: `@types/*` packages need to be visible to the TypeScript compiler, and eslint plugins need to be loadable from the root config.

---

## 4. Nx Configuration

### Plugin-Driven Target Inference

Rather than manually defining "how to build," "how to test," etc. in config files, we register Nx plugins that detect tool config and infer targets:

| Plugin | Detects | Creates Target |
|--------|---------|----------------|
| `@nx/js/typescript` | `tsconfig.json` with `composite: true` | `build`, `typecheck` |
| `@nx/vitest/plugin` | `vitest.config.ts` | `test` |
| `@nx/eslint/plugin` | `eslint.config.mjs` | `lint` |

This means adding a new library to the monorepo requires only: create a directory with a `package.json`, `tsconfig.json`, and `vitest.config.ts`. Nx discovers it, infers its targets, and includes it in the task graph. No registration step, no central manifest to update.

### Task Pipeline

The `targetDefaults` in `nx.json` define how tasks relate:

- **`build` depends on `^build`** — before building a project, build all its dependencies first. The `^` prefix means "upstream in the dependency graph."
- **`test` has no upstream dependency** — tests run against source, not build output, so they don't need upstream builds.
- **`typecheck` depends on `^typecheck`** — type checking requires upstream declaration files.

### Caching

Every target is cached. Nx hashes source files, configs, dependency versions, and CLI flags to produce a cache key. On a cache hit, it replays terminal output and restores artifacts — a build that took 10 seconds becomes instant.

Cache inputs are categorized:
- **`production`** — source files minus test files. Used for `build`.
- **`default`** — all project files. Used for `test` and `lint`.

This separation prevents test-only changes from invalidating the build cache.

### What We Defer

- **Remote caching / Nx Cloud** — useful for CI but not needed for the scaffold. Add later.
- **Distributed task execution** — same; premature for a single-library repo.
- **Generator defaults** — we won't use Nx generators to create internal modules. The library's internal structure (client/, parser/, diff/) is hand-authored per the architecture doc.

---

## 5. Module Boundary Enforcement

The architecture doc specifies strict import rules between the library's internal modules:

- `client` → no internal imports
- `parser` → may import from `client/types` only
- `diff` → may import from `parser/types` only
- `src/index.ts` → the sole public surface

### The Design Challenge

Nx's `enforce-module-boundaries` rule operates at the **project** level — it controls which Nx projects can depend on which other projects, using tags. Our constraints are **intra-project**: they control which directories within a single library can import from each other.

There are two approaches:

**A. Split into multiple Nx projects** — make `client`, `parser`, and `diff` separate packages under `libs/`. Each gets its own `package.json` and tags. Nx's boundary rule enforces the constraints natively.

**B. Keep a single project, use ESLint import rules** — keep the monolithic `edgar-diff-lib` project. Use ESLint's `no-restricted-imports` or `import/no-restricted-paths` to enforce the internal boundaries.

### Our Approach: Single Project + ESLint Import Rules

We keep `edgar-diff-lib` as one Nx project. Splitting into three packages for a library this early in development adds overhead (three package.json files, three tsconfigs, cross-package linking) without proportional benefit. The modules are tightly coupled by design — they share types and will evolve together.

The boundary rules are enforced via ESLint configuration scoped to directory paths:

```javascript
// Conceptual — the idea, not the exact syntax
rules: {
  'import/no-restricted-paths': ['error', {
    zones: [
      // client/ cannot import from parser/ or diff/
      { target: 'src/client/**', from: 'src/parser/**' },
      { target: 'src/client/**', from: 'src/diff/**' },
      // parser/ cannot import from diff/
      { target: 'src/parser/**', from: 'src/diff/**' },
      // diff/ cannot import from client/
      { target: 'src/diff/**', from: 'src/client/**' },
    ]
  }]
}
```

If the monorepo grows to have multiple libraries or apps, we'll use Nx's tag-based `enforce-module-boundaries` rule for inter-project constraints at that point.

---

## 6. TypeScript Setup

### Compiler Target

We target **ES2022** on **Node.js**. This gives us top-level await, private class fields, `Array.prototype.at()`, and `Object.hasOwn()` without transpilation. The `module` and `moduleResolution` settings are `nodenext`, which uses Node's native ESM resolution algorithm and requires explicit file extensions in imports.

### Strict Mode

All strict checks are enabled. This is non-negotiable for a library — downstream consumers shouldn't have to worry about `null` leaking through our API because we didn't enable `strictNullChecks`.

### Composite + Incremental

Both are enabled in the base config. `composite` is required for TypeScript project references to work. `incremental` produces `.tsbuildinfo` files that let subsequent type checks skip unchanged files.

### Declaration Maps

Enabled. These let consumers of the library "Go to Definition" and land in the `.ts` source file rather than a `.d.ts` declaration. This is a significant developer experience improvement when working across packages in the monorepo.

---

## 7. Vitest Setup

### Configuration Approach

Each library gets its own `vitest.config.ts`. The config is minimal — vitest's defaults are sensible and we override only what's necessary for monorepo path resolution and output locations.

Key configuration choices:

- **Environment: `node`** — the library is a Node.js library, not a browser library. No jsdom.
- **Include pattern: `tests/**/*.{test,spec}.ts`** — tests live in the `tests/` directory, not alongside source in `src/`. This matches the architecture doc's test layout.
- **Path resolution** — we use the `vite-tsconfig-paths` plugin so that imports like `@edgar-diff/lib` resolve correctly during tests, matching how TypeScript resolves them.
- **Coverage directory** — pointed to a workspace-level `coverage/` directory so Nx can cache and aggregate it.

### Running Tests

With the `@nx/vitest` plugin registered, `nx test edgar-diff-lib` just works — no additional configuration. The scaffold should verify this works (even with no actual tests) as a smoke test.

---

## 8. Build Strategy

### Do We Need a Build Step?

For the scaffold: **yes, but minimal.** The library will be consumed by sibling packages in the monorepo via TypeScript project references. The "build" is `tsc --build`, which produces `.js` and `.d.ts` files in a `dist/` directory. Consumers import from the package name (e.g., `@edgar-diff/lib`), and Node resolves to the built output via the `exports` field in `package.json`.

We use `tsc` (not swc or esbuild) because:
1. It produces declaration files as part of the same compilation — no separate step.
2. Batch mode in Nx makes it competitive with faster transpilers for our scale.
3. We want type checking to be part of the build, not a separate concern to remember.

### Package Exports

The library's `package.json` uses the `exports` field to define its public API:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

This enforces the architecture doc's rule that `src/index.ts` is the sole public surface. Consumers cannot deep-import internal modules like `@edgar-diff/lib/client/edgar-client` — Node's module resolution respects the `exports` map and blocks unlisted paths.

---

## 9. What the Scaffold Delivers

The scaffold task (edgar-diff-vda.10) produces a working monorepo skeleton where:

1. `pnpm install` succeeds
2. `nx test edgar-diff-lib` runs vitest (passes trivially — no tests yet)
3. `nx typecheck edgar-diff-lib` runs tsc and succeeds
4. `nx lint edgar-diff-lib` runs eslint with module boundary rules configured
5. `nx graph` shows edgar-diff-lib as a node

The scaffold creates **structure, not code**. The `src/index.ts` barrel is empty. The `tests/` directories contain no test files. The `client/`, `parser/`, and `diff/` source directories are not yet created — those are the responsibility of the user stories that follow. The scaffold's job is to ensure that when those stories begin, the developer drops into a working environment with tooling, type checking, testing, and linting already configured.

### What Blocks on This

Five issues depend on the scaffold completing:
- **vda.11** (Spike A: source mapping prototype) — needs the workspace to write spike code
- **vda.12** (Spike B: diff algorithm prototype) — same
- **vda.13** (HTML pattern catalog) — needs the workspace for fixture files
- **vda.2** (US-1.1: fetch filing) — needs the client/ module structure
- **vda.3** (US-1.2: rate limits) — same

All five are currently blocked. Completing the scaffold unblocks parallel work across three workstreams (spikes, cataloging, client development).

---

## 10. Verification Criteria

The scaffold is complete when:

- [ ] `pnpm install` completes without errors
- [ ] `nx test edgar-diff-lib` executes vitest (0 tests, 0 failures)
- [ ] `nx typecheck edgar-diff-lib` succeeds
- [ ] `nx lint edgar-diff-lib` succeeds with boundary rules active
- [ ] `nx graph` renders the project graph
- [ ] The directory structure matches the architecture doc's section 1
- [ ] `package.json` exports field restricts public API to the barrel
- [ ] ESLint rules prevent cross-module imports (client ↛ parser, etc.)
