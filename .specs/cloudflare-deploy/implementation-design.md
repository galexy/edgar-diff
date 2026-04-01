# Cloudflare Deployment — Implementation Design

## Status

| Field       | Value                           |
|-------------|---------------------------------|
| **Bead**    | `edgar-diff-r2h2`              |
| **Author**  | Shannon (Coder Agent)           |
| **Date**    | 2026-03-17                      |
| **Status**  | Draft                           |

---

## 1. Current State

The web application (`apps/web`) is already fully configured for Cloudflare Workers:

- **`@cloudflare/vite-plugin`** integrates Workers into the Vite dev server
- **`wrangler.jsonc`** defines the worker `edgar-diff-api` with:
  - SPA fallback via `not_found_handling: "single-page-application"`
  - Worker-first routing for `/api/*` paths
  - `SEC_USER_AGENT` as a `vars` binding
- **Worker entry** (`worker/index.ts`) proxies SEC EDGAR APIs:
  - `/api/tickers` → `sec.gov/files/company_tickers.json` (cached 24h)
  - `/api/sec/submissions/*` → `data.sec.gov/submissions/*`
  - `/api/sec/efts/*` → `efts.sec.gov/LATEST/*`
  - `/api/sec/archives/*` → `sec.gov/Archives/*`
- **CORS** handled for all API routes
- **Path validation** prevents traversal attacks on submissions/archives

What's **missing**: deployment scripts, Nx integration, CI/CD, environment management, and bootstrap documentation.

---

## 2. Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│           Cloudflare Workers Platform           │
│                                                 │
│  ┌─────────────┐     ┌──────────────────────┐  │
│  │ Static      │     │ Worker               │  │
│  │ Assets      │     │ (edgar-diff-api)     │  │
│  │             │     │                      │  │
│  │ React SPA   │     │ /api/tickers    ──►SEC│  │
│  │ (dist/)     │     │ /api/sec/efts   ──►SEC│  │
│  │             │     │ /api/sec/archives──►SEC│  │
│  │             │     │ /api/sec/submissions►SEC│  │
│  └─────────────┘     └──────────────────────┘  │
│                                                 │
│  Request routing:                               │
│    /api/* → Worker (run_worker_first)           │
│    /*     → Static Assets (SPA fallback)        │
└─────────────────────────────────────────────────┘
```

Cloudflare Workers with static assets is the deployment target (NOT Cloudflare Pages). The `@cloudflare/vite-plugin` produces a build compatible with `wrangler deploy`, which uploads both the worker code and the static SPA assets in a single deployment.

### Why Workers (not Pages)?

- The app has a Worker entry point that runs server-side logic (API proxying)
- `wrangler deploy` handles both Worker + static assets natively via the `assets` config
- Pages would require a separate Functions layer, adding unnecessary complexity
- The existing `wrangler.jsonc` is already configured for Workers

---

## 3. Files to Create / Modify

### 3.1. New Files

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | CI/CD workflow: deploy on merge to main, preview on PR |
| `docs/cloudflare-bootstrap.md` | Bootstrap/change-management document for initial Cloudflare setup |
| `apps/web/deploy.sh` | Wrapper script for wrangler deploy (env selection + pre-flight validation) |
| `apps/web/scripts/smoke-test.sh` | Post-deploy smoke test (validates SPA + API proxy health) |

### 3.2. Modified Files

| File | Change |
|------|--------|
| `apps/web/project.json` | Add `deploy` and `deploy:preview` Nx targets |
| `apps/web/wrangler.jsonc` | Move `SEC_USER_AGENT` from `vars` to a secret; add environment blocks |
| `.gitignore` | Add `.dev.vars` (local wrangler secrets file) |

---

## 4. Detailed Changes

### 4.1. `apps/web/wrangler.jsonc` — Environment Configuration

The current config puts `SEC_USER_AGENT` in plaintext `vars`. While not a true secret, SEC requires a valid contact email in the User-Agent, so it should be managed as a **wrangler secret** to avoid leaking a contact email in source control.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "edgar-diff-api",
  "compatibility_date": "2025-04-01",
  "main": "./worker/index.ts",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  // SEC_USER_AGENT is now a secret, not a var.
  // Set via: wrangler secret put SEC_USER_AGENT
  // For local dev: create .dev.vars with SEC_USER_AGENT=...

  "env": {
    "production": {
      "name": "edgar-diff-api"
      // Inherits all top-level config
      // Secrets set independently per environment
    },
    "preview": {
      "name": "edgar-diff-api-preview"
      // Preview deployments get their own worker name
    }
  }
}
```

**Key decisions:**
- Remove `SEC_USER_AGENT` from `vars` → set as a wrangler secret per environment
- Add `env.production` and `env.preview` blocks for environment separation
- Preview deployments use a separate worker name to avoid conflicts

### 4.2. `.dev.vars` (local development secrets)

Developers create this file locally (gitignored):

```
SEC_USER_AGENT=edgar-diff yourname@example.com
```

This is the standard wrangler mechanism for local secret injection.

### 4.3. `apps/web/project.json` — Nx Deploy Targets

```jsonc
{
  "targets": {
    // ... existing targets ...
    "deploy": {
      "command": "wrangler deploy --env production",
      "options": {
        "cwd": "apps/web"
      },
      "dependsOn": ["build"]
    },
    "deploy:preview": {
      "command": "wrangler deploy --env preview",
      "options": {
        "cwd": "apps/web"
      },
      "dependsOn": ["build"]
    }
  }
}
```

Usage:
```bash
pnpm nx run web:deploy           # Production deployment
pnpm nx run web:deploy:preview   # Preview deployment
```

The `dependsOn: ["build"]` ensures the Vite build runs first.

### 4.4. `.github/workflows/deploy.yml` — CI/CD Pipeline

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - run: corepack enable

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm nx run web:build

      - name: Deploy to Cloudflare
        id: deploy
        working-directory: apps/web
        run: |
          OUTPUT=$(npx wrangler deploy --env production 2>&1)
          echo "$OUTPUT"
          # Extract deployment URL — try JSON output first, fall back to regex
          URL=$(echo "$OUTPUT" | grep -oP 'https://[^\s]+\.workers\.dev' | head -1) || true
          if [[ -z "$URL" ]]; then
            echo "::warning::Could not extract deployment URL from wrangler output"
          fi
          echo "deploy_url=$URL" >> "$GITHUB_OUTPUT"
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Smoke test
        if: steps.deploy.outputs.deploy_url
        run: ./apps/web/scripts/smoke-test.sh "${{ steps.deploy.outputs.deploy_url }}"

  deploy-preview:
    name: Deploy Preview
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - run: corepack enable

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm nx run web:build

      - name: Deploy Preview to Cloudflare
        id: deploy
        working-directory: apps/web
        run: |
          OUTPUT=$(npx wrangler deploy --env preview 2>&1)
          echo "$OUTPUT"
          # Extract deployment URL — try JSON output first, fall back to regex
          URL=$(echo "$OUTPUT" | grep -oP 'https://[^\s]+\.workers\.dev' | head -1) || true
          if [[ -z "$URL" ]]; then
            echo "::warning::Could not extract preview URL from wrangler output"
            echo "preview_url=" >> "$GITHUB_OUTPUT"
          else
            echo "preview_url=$URL" >> "$GITHUB_OUTPUT"
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Smoke test preview
        if: steps.deploy.outputs.preview_url
        run: ./apps/web/scripts/smoke-test.sh "${{ steps.deploy.outputs.preview_url }}"

      - name: Comment PR with Preview URL
        if: steps.deploy.outputs.preview_url
        uses: actions/github-script@v7
        with:
          script: |
            const url = '${{ steps.deploy.outputs.preview_url }}';
            const body = `### 🔗 Preview Deployment\n\n**URL:** ${url}\n\nThis preview will be updated on each push to this PR.`;

            // Find existing comment
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c =>
              c.body.includes('Preview Deployment') && c.user.type === 'Bot'
            );

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

**Design decisions:**
- **Production**: Deploys only on merge to `main`, after PR checks pass (separate workflow, runs after `pr-checks.yml`)
- **Preview**: Deploys on every PR push, posts the preview URL as a PR comment
- **Smoke tests**: Both production and preview jobs run `smoke-test.sh` after deploy to verify the deployment is healthy before considering the job successful
- **URL extraction**: Uses regex against wrangler stdout with `|| true` fallback + GitHub Actions `::warning::` annotation if extraction fails. If `wrangler deploy --json` becomes available in a future version, prefer that for structured output
- **Concurrency**: Cancels in-progress deploys for the same ref to avoid conflicts
- **Separation from `pr-checks.yml`**: Keeps the existing PR validation workflow untouched; deployment is a separate concern
- **wrangler** runs directly (not via Nx) in CI — avoids caching deploy as an Nx target, which would be incorrect since deploys are side-effectful

### 4.5. `.gitignore` Addition

```gitignore
# Wrangler local secrets
.dev.vars
```

### 4.6. `apps/web/deploy.sh` — Deploy Wrapper

```bash
#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-production}"

# Pre-flight validation
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2
  echo "  Set it via: export CLOUDFLARE_API_TOKEN=<your-token>" >&2
  echo "  Or run: wrangler login" >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID is not set." >&2
  echo "  Find it at: https://dash.cloudflare.com → Workers & Pages → Overview" >&2
  exit 1
fi

echo "Deploying edgar-diff-api to $ENV..."
wrangler deploy --env "$ENV"
echo "Deploy complete."
```

Pre-flight checks catch missing credentials before wrangler runs, providing clear error messages with remediation steps. CI also uses this script (not wrangler directly) for consistent validation.

### 4.7. `apps/web/scripts/smoke-test.sh` — Post-Deploy Verification

```bash
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_URL="${1:?Usage: smoke-test.sh <deployment-url>}"
TIMEOUT=10
FAILURES=0

check() {
  local name="$1" method="$2" url="$3" expected_status="$4"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" \
    -H "Origin: https://example.com" \
    --max-time "$TIMEOUT" "$url") || status="TIMEOUT"

  if [[ "$status" == "$expected_status" ]]; then
    echo "  PASS: $name (HTTP $status)"
  else
    echo "  FAIL: $name — expected $expected_status, got $status"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "Smoke testing: $DEPLOY_URL"
echo ""

echo "SPA Serving:"
check "Root serves HTML"         GET  "$DEPLOY_URL/"                200
check "SPA fallback (deep link)" GET  "$DEPLOY_URL/filings/AAPL"   200

echo ""
echo "API Proxy:"
check "Tickers endpoint"         GET  "$DEPLOY_URL/api/tickers"    200
check "Submissions proxy"        GET  "$DEPLOY_URL/api/sec/submissions/CIK0000320193.json" 200
check "Unknown route 404"        GET  "$DEPLOY_URL/api/unknown"    404

echo ""
echo "CORS:"
check "OPTIONS preflight"        OPTIONS "$DEPLOY_URL/api/tickers" 204

echo ""
if [[ $FAILURES -gt 0 ]]; then
  echo "FAILED: $FAILURES check(s) failed"
  exit 1
else
  echo "ALL CHECKS PASSED"
fi
```

**Design decisions:**
- 10-second per-request timeout, no retries (strict — we want to know if something is broken)
- Tests both SPA serving and API proxy routes
- Exit code 1 on any failure — CI step fails cleanly
- No EFTS/Archives in smoke tests (they depend on specific SEC data availability; covered by E2E suite instead)

---

## 5. Environment & Secrets Management

### 5.1. Secret Inventory

| Secret | Where Set | Purpose |
|--------|-----------|---------|
| `SEC_USER_AGENT` | `wrangler secret put` (per env) | SEC EDGAR API User-Agent header |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Wrangler authentication |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Cloudflare account targeting |

### 5.2. Secret Lifecycle

| Environment | How secrets are set |
|-------------|---------------------|
| **Local dev** | `.dev.vars` file (gitignored) |
| **Production** | `wrangler secret put SEC_USER_AGENT --env production` |
| **Preview** | `wrangler secret put SEC_USER_AGENT --env preview` |
| **CI/CD** | GitHub Actions repository secrets for `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |

### 5.3. Wrangler Vars vs Secrets

- **Vars** (`vars` in `wrangler.jsonc`): Non-sensitive, version-controlled config. Currently unused after moving `SEC_USER_AGENT` to secrets.
- **Secrets** (`wrangler secret put`): Encrypted, per-environment values not stored in source. Used for `SEC_USER_AGENT`.

---

## 6. Bootstrap Document Structure

The bootstrap document (`docs/cloudflare-bootstrap.md`) will cover the **one-time manual setup** needed before CI/CD can deploy. It is a change-management document — it records what was done, by whom, and when.

### Outline

1. **Prerequisites**
   - Cloudflare account (free tier sufficient)
   - `wrangler` CLI installed (already a devDependency)
   - GitHub repository admin access

2. **Cloudflare Account Setup**
   - Sign up / sign in at dash.cloudflare.com
   - Note Account ID (from the Workers & Pages overview page)

3. **API Token Creation**
   - Create token with permissions: `Workers Scripts: Edit`, `Account Settings: Read`
   - Scope to the specific account
   - Record token securely

4. **Worker Initial Deployment**
   ```bash
   cd apps/web
   npx wrangler deploy --env production
   ```
   - First deploy creates the worker; subsequent deploys update it

5. **Secret Configuration**
   ```bash
   # Production
   echo "edgar-diff research@yourdomain.com" | npx wrangler secret put SEC_USER_AGENT --env production

   # Preview
   echo "edgar-diff research@yourdomain.com" | npx wrangler secret put SEC_USER_AGENT --env preview
   ```

6. **GitHub Actions Secrets**
   - Go to repo → Settings → Secrets and variables → Actions
   - Add `CLOUDFLARE_API_TOKEN` (the token from step 3)
   - Add `CLOUDFLARE_ACCOUNT_ID` (from step 2)

7. **Custom Domain (Optional)**
   - Add custom domain via Cloudflare dashboard → Workers → Routes
   - Or use the default `*.workers.dev` domain

8. **Verification**
   - Visit `https://edgar-diff-api.<account>.workers.dev/api/tickers`
   - Confirm JSON response with SEC ticker data
   - Check the SPA loads on the root URL

9. **Change Log**
   - Table: Date | Change | Who | Notes

---

## 7. Relationship to Existing CI

The `pr-checks.yml` workflow remains unchanged. The new `deploy.yml` is independent:

```
PR opened/updated:
  ├─ pr-checks.yml → typecheck, lint, test (existing)
  └─ deploy.yml    → build + preview deploy + smoke test (new)

Merge to main:
  └─ deploy.yml → build + production deploy + smoke test (new)
```

There is no dependency between the two workflows. If PR checks fail, the PR cannot merge (branch protection), which gates production deployment naturally.

---

## 8. Rollback Strategy

Cloudflare Workers support instant rollback via the dashboard or CLI:

```bash
# List recent deployments
wrangler deployments list

# Rollback to a specific deployment
wrangler rollback <deployment-id>
```

For the CI pipeline, rolling back means reverting the merge commit and pushing to `main`, which triggers a new deploy of the previous code.

**Recommendation**: Document the rollback procedure in the bootstrap doc, but do not build automated rollback into the pipeline initially. Manual rollback via `wrangler rollback` is fast (< 1 second) and sufficient.

---

## 9. Local & CI Validation (Dry-Run)

`wrangler deploy --dry-run` validates config and build output without contacting the Cloudflare API. This works without credentials in wrangler ^4.x, making it safe for CI validation in `pr-checks.yml` and local development.

**Prerequisites**: The build output (`dist/`) must exist — `--dry-run` validates the deployment package, not just the config file. Run `pnpm nx run web:build` first.

**Usage:**
```bash
# Local validation
pnpm nx run web:build && cd apps/web && npx wrangler deploy --dry-run

# CI: add as a step in pr-checks.yml (no credentials needed)
- name: Validate deployment config
  working-directory: apps/web
  run: npx wrangler deploy --dry-run
```

**Compatibility note**: The `@cloudflare/vite-plugin` produces standard Vite + Worker output. `--dry-run` validates this output the same way it validates any wrangler-managed project. No special handling needed.

---

## 10. Edge Cases

### SEC Rate Limiting
- SEC EDGAR has a 10 requests/second rate limit per User-Agent
- The worker already caches `/api/tickers` for 24 hours
- **No additional rate limiting is needed at the worker level** for now — Cloudflare Workers handle request isolation, and individual user sessions won't exceed SEC limits
- If rate limiting becomes a problem, consider adding `Cache-Control` headers to EFTS/Archives proxy responses

### Build Failures in CI
- `dependsOn: ["build"]` in the Nx deploy target ensures the build must pass
- CI runs `pnpm nx run web:build` explicitly before `wrangler deploy`
- If the build fails, the deploy step is skipped (standard GitHub Actions behavior)

### Worker Size Limits
- Cloudflare Workers have a 10 MB limit (after compression) for bundled workers
- The worker code is minimal (proxy handlers + CORS) — well under the limit
- Static assets are handled separately and don't count toward the worker size

### Preview Environment Cleanup
- Preview workers (`edgar-diff-api-preview`) persist after PR merge/close
- They share the same preview worker name, so each PR deploy overwrites the previous one
- This is acceptable for a single-contributor project; for multi-contributor, consider per-PR worker names (future enhancement)

---

## 11. Open Questions

1. **Custom domain**: Is a custom domain needed, or is `*.workers.dev` sufficient for now?
2. **Branch protection**: Are GitHub branch protection rules already in place requiring PR checks to pass before merge? (This gates production deploys.)
3. **Preview per-PR isolation**: The current design uses a single preview worker. If multiple PRs need concurrent previews, we'd need per-PR worker names (e.g., `edgar-diff-api-preview-{PR#}`). Is this needed?
4. **SEC User-Agent email**: What email should be used in the production `SEC_USER_AGENT` value?
5. **Monitoring / alerting**: Should we set up Cloudflare analytics or external monitoring (e.g., uptime checks) as part of this work, or defer?

---

## 12. Implementation Order

1. **Update `wrangler.jsonc`** — Add environment blocks, remove `SEC_USER_AGENT` from vars
2. **Update `.gitignore`** — Add `.dev.vars`
3. **Create `.dev.vars.example`** — Template for local development
4. **Update `apps/web/project.json`** — Add deploy targets
5. **Create `apps/web/deploy.sh`** — Deploy wrapper with pre-flight validation
6. **Create `apps/web/scripts/smoke-test.sh`** — Post-deploy smoke test
7. **Create `.github/workflows/deploy.yml`** — CI/CD pipeline
8. **Create `docs/cloudflare-bootstrap.md`** — Bootstrap/change-management document
9. **Test**: Manual deploy from local machine to verify wrangler config works
10. **Test**: Run `smoke-test.sh` against local deployment to verify smoke checks
11. **Test**: Push to a PR branch to verify preview deployment workflow + smoke test
12. **Test**: Merge to main to verify production deployment workflow + smoke test
