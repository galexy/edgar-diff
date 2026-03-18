# Test Plan: Cloudflare Deployment

> Story: edgar-diff-042h — Design: Test plan for CloudFlare deployment
> Status: Approved
> Last updated: 2026-03-17
> Revision: 3 (final — aligned with implementation design)

## Overview

This test plan covers the deployment pipeline for edgar-diff to Cloudflare Workers + Assets. The deployed application is a React SPA served via Cloudflare Assets with a Workers-based API proxy layer that forwards requests to SEC EDGAR APIs (tickers, submissions, EFTS full-text search, and archives).

### Architecture Summary

| Component | Technology | Purpose |
|-----------|-----------|---------|
| SPA | React 19 + Vite + Tailwind | UI served at root |
| Worker | Cloudflare Workers | API proxy at `/api/*` |
| Assets | Cloudflare Assets (SPA mode) | Static file serving with SPA fallback |
| Build | Vite + `@cloudflare/vite-plugin` | Produces `dist/` with SPA + worker bundle |
| Config | `wrangler.jsonc` | Deployment configuration |
| CI | GitHub Actions + Nx | PR checks, deploy triggers |

### Existing Test Coverage

The worker layer already has comprehensive unit tests:
- `worker/index.test.ts` — Route matching, CORS headers, tickers caching, submissions proxy
- `worker/handle-efts-proxy.test.ts` — EFTS proxy URL rewriting, error handling, CORS
- `worker/handle-archives-proxy.test.ts` — Archives proxy URL rewriting, path validation, error handling

This test plan focuses on **deployment-specific** concerns: build output, deploy scripts, CI/CD workflows, wrangler configuration, and post-deployment verification.

---

## 1. BDD Acceptance Criteria

### AC-1: Deploy Script Deploys to Cloudflare Successfully

```gherkin
Feature: Cloudflare deployment via Nx target

  Scenario: Production deployment on main merge
    Given the web app has been built successfully
    And CLOUDFLARE_API_TOKEN is set in the environment
    And CLOUDFLARE_ACCOUNT_ID is set in the environment
    When the deploy target is executed
    Then wrangler deploys the worker and assets to production
    And the deployment URL is printed to stdout
    And the exit code is 0

  Scenario: Preview deployment on PR
    Given the web app has been built successfully
    And CLOUDFLARE_API_TOKEN is set in the environment
    When the deploy target is executed with --preview flag
    Then wrangler deploys to a preview environment
    And a unique preview URL is returned
    And the preview is accessible via HTTPS

  Scenario: Dry-run mode
    Given the web app has been built successfully
    When the deploy target is executed with --dry-run flag
    Then wrangler validates the config without deploying
    And no network calls to Cloudflare API are made
    And the exit code is 0
```

### AC-2: Build Output Contains Expected Assets

```gherkin
Feature: Build output structure

  Scenario: Vite build produces correct output
    Given the web app source code compiles without errors
    When `pnpm nx run web:build` completes
    Then dist/ contains an index.html file
    And dist/assets/ contains at least one .js bundle
    And dist/assets/ contains at least one .css bundle
    And source maps (.map files) are generated
    And the worker entry point is bundled by the Cloudflare Vite plugin

  Scenario: Build output is deployable by wrangler
    Given a successful build output in dist/
    When wrangler validates the deployment package
    Then the assets directory is recognized
    And the worker entry point resolves correctly
    And no missing file references exist
```

### AC-3: Wrangler Config Is Valid and Complete

```gherkin
Feature: Wrangler configuration validation

  Scenario: Config schema compliance
    Given wrangler.jsonc exists in apps/web/
    When validated against wrangler's config schema
    Then no schema errors are reported

  Scenario: Required fields present
    Given wrangler.jsonc is loaded
    Then "name" equals "edgar-diff-api"
    And "compatibility_date" is a valid date string
    And "main" points to a file that exists
    And "assets.not_found_handling" is "single-page-application"
    And "assets.run_worker_first" includes "/api/*"
    And "vars" contains no sensitive values (SEC_USER_AGENT is a wrangler secret, not a var)
    And environment blocks for "production" and "preview" are defined
```

### AC-4: CI/CD Workflow Triggers Correctly

```gherkin
Feature: Deployment CI/CD workflow (single deploy.yml with conditional jobs)

  Scenario: Production deploy job triggers on push to main
    Given deploy.yml exists in .github/workflows/
    And deploy.yml listens on both push (main) and pull_request (main)
    When a commit is pushed to the main branch
    Then the deploy-production job runs
    And the deploy-preview job is skipped
    And it runs the build step before deploy
    And it uses CLOUDFLARE_API_TOKEN from GitHub Secrets
    And it uses CLOUDFLARE_ACCOUNT_ID from GitHub Secrets

  Scenario: Preview deploy job triggers on PRs
    Given deploy.yml exists in .github/workflows/
    When a pull request is opened or updated against main
    Then the deploy-preview job runs
    And the deploy-production job is skipped

  Scenario: Smoke test runs after each deployment
    Given a deploy job has completed successfully
    When the deployment URL is captured from wrangler output
    Then the smoke test script runs against the deployed URL
    And all smoke checks must pass before the job succeeds
```

### AC-5: Preview Deployments Work on PRs

```gherkin
Feature: Preview deployments for pull requests

  Scenario: PR triggers preview deployment
    Given the deploy-preview job in deploy.yml is configured
    When a pull request is opened or updated against main
    Then a preview deployment is created via wrangler deploy --env preview
    And the preview URL is posted as a PR comment
    And the preview uses worker name "edgar-diff-api-preview" (isolated from production)

  Scenario: Preview comment is updated on subsequent pushes
    Given a preview deployment comment already exists on the PR
    When a new commit is pushed to the PR branch
    Then the existing comment is updated (not duplicated)
    And the preview URL reflects the latest deployment

  Scenario: Concurrent PRs share a single preview worker
    Given multiple PRs are open simultaneously
    When each PR deploys to preview
    Then each deployment overwrites the previous preview
    And only the most recent preview is accessible
    And production is never affected
```

### AC-6: Bootstrap Documentation Is Accurate

```gherkin
Feature: Deployment documentation

  Scenario: First-time setup instructions work
    Given a new contributor follows the bootstrap docs
    When they configure CLOUDFLARE_API_TOKEN
    And they configure CLOUDFLARE_ACCOUNT_ID
    And they run the deploy command
    Then the deployment succeeds on the first attempt

  Scenario: Required secrets are documented
    Given the bootstrap docs exist
    Then they list CLOUDFLARE_API_TOKEN as required
    And they list CLOUDFLARE_ACCOUNT_ID as required
    And they explain how to obtain each secret
    And they explain where to configure them (GitHub Secrets)
```

### AC-7: Environment Variables and Secrets Are Properly Configured

```gherkin
Feature: Environment and secret handling

  Scenario: SEC_USER_AGENT is available in deployed worker via secret binding
    Given the worker is deployed to Cloudflare
    And SEC_USER_AGENT has been set via `wrangler secret put` for the target environment
    When a request hits /api/tickers
    Then the worker reads SEC_USER_AGENT from env (secret binding)
    And passes it as the User-Agent header to SEC APIs

  Scenario: Secrets are not exposed in build output or source
    Given the web app has been built
    When inspecting dist/ files
    Then no API tokens or secrets appear in any output file
    And SEC_USER_AGENT is not present in wrangler.jsonc vars
    And SEC_USER_AGENT is only referenced as an env binding in worker code

  Scenario: Local development uses .dev.vars for secrets
    Given a developer has created .dev.vars with SEC_USER_AGENT
    When running `pnpm nx run web:dev`
    Then the worker reads SEC_USER_AGENT from .dev.vars
    And .dev.vars is gitignored
```

### AC-10: Rollback to Previous Deployment

```gherkin
Feature: Deployment rollback

  Scenario: Rollback to previous deployment
    Given a broken deployment has been pushed to production
    When `wrangler rollback` is executed with the previous deployment ID
    Then the previous worker version is restored
    And the smoke tests pass against the rolled-back version
    And the rollback completes in under 5 seconds

  Scenario: Rollback via git revert
    Given a broken commit has been merged to main
    When the commit is reverted and pushed to main
    Then the deploy workflow re-deploys the reverted code
    And the deployment succeeds with the previous working version
```

### AC-8: Deployed App Serves SPA Correctly

```gherkin
Feature: SPA serving on deployed Cloudflare

  Scenario: Root URL serves the SPA
    Given the app is deployed to Cloudflare
    When a browser navigates to the root URL (/)
    Then index.html is returned with status 200
    And Content-Type is text/html

  Scenario: Deep link returns SPA (client-side routing)
    Given the app is deployed
    When a browser navigates to /filings/AAPL
    Then index.html is returned (SPA fallback) with status 200
    And the React router handles the route client-side

  Scenario: Static assets are served directly
    Given the app is deployed
    When a browser requests /assets/index-abc123.js
    Then the JS file is returned with Content-Type application/javascript
    And appropriate caching headers are set
```

### AC-9: Deployed Worker Proxies SEC API Requests Correctly

```gherkin
Feature: API proxy on deployed Cloudflare

  Scenario: Tickers endpoint works
    Given the app is deployed
    When a GET request is sent to /api/tickers
    Then a JSON response with ticker data is returned
    And CORS headers are present

  Scenario: EFTS search proxy works
    Given the app is deployed
    When a GET request is sent to /api/sec/efts/search-index?q=apple&dateRange=custom&startdt=2023-01-01&enddt=2023-12-31&forms=10-K
    Then the response contains EFTS search results
    And CORS headers are present

  Scenario: Archives proxy works
    Given the app is deployed
    When a GET request is sent to /api/sec/archives/edgar/data/320193/000032019323000106/aapl-20230930.htm
    Then the SEC filing HTML is returned
    And Content-Type is text/html
    And CORS headers are present

  Scenario: Submissions proxy works
    Given the app is deployed
    When a GET request is sent to /api/sec/submissions/CIK0000320193.json
    Then the SEC submissions JSON is returned
    And CORS headers are present

  Scenario: CORS preflight succeeds
    Given the app is deployed
    When an OPTIONS request is sent to /api/tickers with Origin header
    Then status 204 is returned
    And Access-Control-Allow-Origin reflects the Origin
    And Access-Control-Allow-Methods includes GET
```

---

## 2. Unit Tests

### 2.1 Deployment Script Validation

**File:** `apps/web/scripts/deploy.test.ts` (new)

| Test ID | Description | Expected |
|---------|-------------|----------|
| DS-1 | Deploy script calls `wrangler deploy` with correct working directory | Command includes `--cwd apps/web` or equivalent |
| DS-2 | Deploy script passes `--env production` for prod deploys | Flag present in command args |
| DS-3 | Deploy script passes `--env preview` for preview deploys | Flag present in command args |
| DS-4 | Dry-run mode passes `--dry-run` to wrangler | Flag present, no actual deploy |
| DS-5 | Deploy script fails fast if CLOUDFLARE_API_TOKEN is unset | Throws with descriptive error message |
| DS-6 | Deploy script fails fast if CLOUDFLARE_ACCOUNT_ID is unset | Throws with descriptive error message |
| DS-7 | Deploy script exits non-zero on wrangler failure | Process exit code propagated |

### 2.2 Wrangler Config Validation

**File:** `apps/web/worker/__tests__/wrangler-config.test.ts` (new)

| Test ID | Description | Expected |
|---------|-------------|----------|
| WC-1 | wrangler.jsonc parses as valid JSONC | No parse errors |
| WC-2 | `name` field is "edgar-diff-api" | Exact match |
| WC-3 | `compatibility_date` is a valid ISO date | Matches `YYYY-MM-DD` pattern |
| WC-4 | `main` points to an existing file | `worker/index.ts` exists relative to `apps/web/` |
| WC-5 | `assets.not_found_handling` is "single-page-application" | Exact match |
| WC-6 | `assets.run_worker_first` includes "/api/*" | Array contains pattern |
| WC-7 | `vars` does not contain `SEC_USER_AGENT` (moved to secret) | Key absent from vars object |
| WC-8 | No sensitive values hardcoded in vars | No keys matching `TOKEN`, `SECRET`, `KEY`, `PASSWORD`; no email addresses |
| WC-9 | `env.production` block is defined | Object with `name: "edgar-diff-api"` |
| WC-10 | `env.preview` block is defined | Object with `name: "edgar-diff-api-preview"` |

### 2.3 Build Output Structure Verification

**File:** `apps/web/__tests__/build-output.test.ts` (new)
**Nx target:** `verify-build` (separate from `test`, requires `dependsOn: ["build"]`)

These tests run via a dedicated Nx target because they require `dist/` to exist:

```jsonc
// in apps/web/project.json
"verify-build": {
  "command": "vitest run --config vitest.build-verify.config.ts",
  "options": { "cwd": "apps/web" },
  "dependsOn": ["build"]
}
```

| Test ID | Description | Expected |
|---------|-------------|----------|
| BO-1 | `dist/` directory exists after build | Directory present |
| BO-2 | `dist/index.html` exists | File present |
| BO-3 | `dist/assets/` contains at least one `.js` file | Glob matches ≥ 1 |
| BO-4 | `dist/assets/` contains at least one `.css` file | Glob matches ≥ 1 |
| BO-5 | Source maps are generated (`*.map` files) | At least one `.map` in dist/ |
| BO-6 | index.html references assets with hashed filenames | Script/link tags contain hash patterns |
| BO-7 | No `.ts` source files in dist/ | Zero `.ts` files (only compiled output) |

### 2.4 Environment Variable Handling

**File:** Covered by existing `worker/index.test.ts`

The existing tests already validate that `env.SEC_USER_AGENT` is read and passed as `User-Agent` header. No additional unit tests needed for env handling — `SEC_USER_AGENT` is set as a wrangler secret (not a var), but Workers access both via the same `env` object, so the worker code and tests are unchanged.

---

## 3. Integration Tests

### 3.1 Build + Deploy Pipeline (Dry-Run)

**File:** `apps/web/__tests__/deploy-integration.test.ts` (new)

| Test ID | Description | Expected |
|---------|-------------|----------|
| DI-1 | `pnpm nx run web:build` succeeds | Exit code 0, dist/ populated |
| DI-2 | `wrangler deploy --dry-run` validates config after build | Exit code 0, no errors |
| DI-3 | Nx deploy target depends on build target | Deploy runs build first |
| DI-4 | Build + dry-run deploy completes under 60 seconds | Timeout budget met |

**Note:** These tests run `wrangler deploy --dry-run` which validates config and build output without contacting Cloudflare API. Safe for CI.

### 3.2 Nx Deploy Target Integration

**File:** Validated in `project.json` structure

| Test ID | Description | Expected |
|---------|-------------|----------|
| NX-1 | `deploy` target exists in `apps/web/project.json` | Target defined |
| NX-2 | `deploy` target has `dependsOn: ["build"]` | Build runs first |
| NX-3 | `deploy` target command invokes `wrangler deploy` | Correct command string |
| NX-4 | `deploy` target is NOT cached | `cache: false` or omitted |

### 3.3 GitHub Actions Workflow Validation

**File:** `.github/workflows/deploy.yml` (single workflow with conditional jobs)

| Test ID | Description | Expected |
|---------|-------------|----------|
| GA-1 | Deploy workflow YAML is valid syntax | `actionlint` passes |
| GA-2 | Deploy workflow triggers on both `push` (main) and `pull_request` (main) | `on: { push: { branches: [main] }, pull_request: { branches: [main] } }` |
| GA-3 | Deploy workflow references `CLOUDFLARE_API_TOKEN` secret | `${{ secrets.CLOUDFLARE_API_TOKEN }}` present in both jobs |
| GA-4 | Deploy workflow references `CLOUDFLARE_ACCOUNT_ID` secret | `${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` present in both jobs |
| GA-5 | Both jobs run build before deploy | Build step precedes wrangler deploy step |
| GA-6 | `deploy-production` job has `if: github.event_name == 'push'` | Conditional gates production deploys to main pushes only |
| GA-7 | `deploy-preview` job has `if: github.event_name == 'pull_request'` | Conditional gates preview deploys to PRs only |
| GA-8 | `deploy-preview` posts preview URL as PR comment | Uses `actions/github-script` to create/update comment |
| GA-9 | Both jobs include a post-deploy smoke test step | Smoke test runs after wrangler deploy, before job succeeds |
| GA-10 | Concurrency group prevents conflicting deploys | `concurrency.group` includes `github.ref` |

**Validation approach:** Use `actionlint` in CI to validate workflow YAML syntax and structure.

### 3.4 Wrangler Config Produces Valid Deployment

| Test ID | Description | Expected |
|---------|-------------|----------|
| WD-1 | `wrangler deploy --dry-run` with current config exits 0 | Valid config |
| WD-2 | `wrangler types` generates type bindings matching `types.ts` | `Env` interface matches generated bindings |

---

## 4. End-to-End Tests

### 4.1 Post-Deployment Verification

These tests run against a deployed environment (preview or production). They are the **smoke test suite** that validates a deployment is healthy.

**File:** `apps/web/e2e/smoke.test.ts` (new)

#### SPA Serving

| Test ID | Description | Expected |
|---------|-------------|----------|
| E2E-S1 | GET `/` returns 200 with `text/html` content-type | Status 200, HTML body |
| E2E-S2 | Response body contains `<div id="root">` | SPA mount point present |
| E2E-S3 | GET `/nonexistent-route` returns 200 (SPA fallback) | Status 200, same index.html |
| E2E-S4 | GET `/assets/<hash>.js` returns 200 with `application/javascript` | Correct content-type, non-empty body |
| E2E-S5 | GET `/assets/<hash>.css` returns 200 with `text/css` | Correct content-type, non-empty body |
| E2E-S6 | Static assets have caching headers | `Cache-Control` present on asset responses |

#### API Proxy Routes

| Test ID | Description | Expected |
|---------|-------------|----------|
| E2E-A1 | GET `/api/tickers` returns 200 with JSON | Status 200, valid JSON body with ticker data |
| E2E-A2 | GET `/api/sec/submissions/CIK0000320193.json` returns 200 | Status 200, JSON with `name` field |
| E2E-A3 | GET `/api/sec/efts/search-index?q=apple&forms=10-K` returns 200 | Status 200, JSON with search results |
| E2E-A4 | GET `/api/sec/archives/edgar/data/320193/000032019323000106/aapl-20230930.htm` returns 200 | Status 200, HTML content |
| E2E-A5 | GET `/api/unknown` returns 404 | Status 404 |
| E2E-A6 | POST `/api/sec/efts/search-index` returns 405 | Method not allowed |

#### CORS Headers

| Test ID | Description | Expected |
|---------|-------------|----------|
| E2E-C1 | OPTIONS `/api/tickers` with Origin returns 204 | Preflight succeeds |
| E2E-C2 | Response includes `Access-Control-Allow-Origin` | Header matches request Origin |
| E2E-C3 | Response includes `Access-Control-Allow-Methods` | Includes GET |
| E2E-C4 | Response includes `Access-Control-Max-Age` | Value is "86400" |
| E2E-C5 | GET `/api/tickers` with Origin includes CORS headers | `Access-Control-Allow-Origin` + `Vary: Origin` |

#### Content Types

| Test ID | Description | Expected |
|---------|-------------|----------|
| E2E-T1 | `/api/tickers` returns `application/json` | Content-Type header correct |
| E2E-T2 | `/api/sec/submissions/*` returns `application/json` | Content-Type header correct |
| E2E-T3 | `/api/sec/archives/*` returns `text/html` for .htm files | Content-Type header correct |

### 4.2 Smoke Test Script

**File:** `apps/web/scripts/smoke-test.sh` (new)

A standalone script that runs post-deployment in CI or manually. Design principles:
- **Strict, no retries** — If a check fails (including due to upstream SEC flakiness), the smoke test fails. We investigate rather than mask with retries.
- **10-second per-request timeout** — Fast feedback; any response slower than 10s indicates a problem.
- **Sequential execution** — Checks run in order; first failure exits non-zero immediately.

```bash
#!/usr/bin/env bash
# Usage: ./smoke-test.sh <deployment-url>
# Exit code 0 = all checks pass, non-zero = failure
set -euo pipefail

DEPLOY_URL="${1:?Usage: smoke-test.sh <deployment-url>}"
TIMEOUT=10  # seconds per request — no retries
PASSED=0
FAILED=0

check() {
  local name="$1" method="$2" url="$3" expected_status="$4"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" \
    --max-time "$TIMEOUT" "$url") || status="TIMEOUT"
  if [[ "$status" == "$expected_status" ]]; then
    echo "  PASS: $name ($status)"
    ((PASSED++))
  else
    echo "  FAIL: $name — expected $expected_status, got $status"
    ((FAILED++))
  fi
}

echo "Smoke testing: $DEPLOY_URL"

check "SPA root"          GET     "$DEPLOY_URL/"                    200
check "SPA fallback"      GET     "$DEPLOY_URL/any/deep/route"      200
check "API tickers"       GET     "$DEPLOY_URL/api/tickers"         200
check "API submissions"   GET     "$DEPLOY_URL/api/sec/submissions/CIK0000320193.json" 200
check "API unknown 404"   GET     "$DEPLOY_URL/api/unknown"         404
check "CORS preflight"    OPTIONS "$DEPLOY_URL/api/tickers"         204

echo ""
echo "Results: $PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]] || exit 1
```

**Execution:** Runs as a post-deploy step in both `deploy-production` and `deploy-preview` jobs in `deploy.yml`.

---

## 5. Boundary Conditions

| Test ID | Condition | Expected Behavior |
|---------|-----------|-------------------|
| BC-1 | Build produces empty `dist/` (e.g., source error not caught) | `wrangler deploy --dry-run` fails with descriptive error; deploy target exits non-zero |
| BC-2 | `dist/` missing `index.html` | Wrangler rejects deployment; deploy script reports missing asset |
| BC-3 | `wrangler.jsonc` has `compatibility_date` in the future | Wrangler may warn; deploy should still succeed |
| BC-4 | Very large build output (>25MB assets) | Cloudflare Assets has a 25MB per-file limit; build should split bundles to stay under |
| BC-5 | Worker bundle exceeds 10MB compressed limit | Wrangler fails with size limit error; build config should be reviewed |
| BC-6 | `SEC_USER_AGENT` env var is empty string | Worker should still function but SEC may reject with 403 (test the behavior) |
| BC-7 | Concurrent deploys from two CI runs | Cloudflare handles atomic deploys; second deploy wins; verify no corruption |
| BC-8 | Concurrent PR previews from multiple PRs | All PRs deploy to same `edgar-diff-api-preview` worker; latest PR wins; smoke test should only validate most recent deployment URL |
| BC-9 | `SEC_USER_AGENT` secret not set for environment | Worker receives `undefined`; SEC likely returns 403; worker should handle gracefully |

---

## 6. Error Conditions

### 6.1 Authentication & Authorization Errors

| Test ID | Condition | Expected Behavior |
|---------|-----------|-------------------|
| EC-1 | Deploy with invalid `CLOUDFLARE_API_TOKEN` | Wrangler exits non-zero with 401/403 error; CI step fails |
| EC-2 | Deploy with expired `CLOUDFLARE_API_TOKEN` | Same as EC-1; clear error message |
| EC-3 | Deploy with valid token but wrong `CLOUDFLARE_ACCOUNT_ID` | Wrangler exits non-zero with account-not-found error |
| EC-4 | `CLOUDFLARE_API_TOKEN` missing entirely | Deploy script fails fast with "missing token" message before calling wrangler |
| EC-5 | `CLOUDFLARE_ACCOUNT_ID` missing entirely | Deploy script fails fast with "missing account ID" message |

### 6.2 Build Failures

| Test ID | Condition | Expected Behavior |
|---------|-----------|-------------------|
| EC-6 | TypeScript compilation error in worker | `nx run web:build` fails; deploy target never runs |
| EC-7 | Vite build error (missing dependency) | Build step fails; deploy target never runs |
| EC-8 | Build succeeds but dist/ is deleted before deploy | Deploy step detects missing output; fails with clear error |

### 6.3 Network & Deployment Failures

| Test ID | Condition | Expected Behavior |
|---------|-----------|-------------------|
| EC-9 | Network timeout during `wrangler deploy` | Wrangler retries or fails; CI step fails with timeout |
| EC-10 | Cloudflare API returns 500 during deploy | Wrangler exits non-zero; CI step fails |
| EC-11 | Partial upload (some assets uploaded, worker fails) | Cloudflare atomic deploy ensures no partial state; previous version remains active |

### 6.4 Runtime Errors Post-Deploy

| Test ID | Condition | Expected Behavior |
|---------|-----------|-------------------|
| EC-12 | SEC API is down (all proxies return 502) | Worker returns 502 with JSON error body; SPA still loads; app degrades gracefully |
| EC-13 | SEC rate-limits our worker (429 responses) | Worker forwards 429 to client; client can retry or show error |
| EC-14 | Worker throws unhandled exception | Cloudflare returns 500; error logged in Workers dashboard |

---

## 7. Test Data & Fixtures

### 7.1 Mock Environment

```typescript
// fixtures/env.ts
export const mockEnv = {
  SEC_USER_AGENT: 'edgar-diff research@example.com',
};

export const mockEnvMissing = {
  // Intentionally empty — tests missing var behavior
};
```

### 7.2 Wrangler Config Fixture

For config validation tests, read `wrangler.jsonc` directly from the repo using `fs.readFileSync` + JSONC parser (strip comments). No separate fixture needed — test the real config.

### 7.3 Build Output Fixtures

For build-output structure tests, run the actual build (`nx run web:build`) as a `beforeAll` step and inspect `dist/`. These are integration tests, not mocked.

### 7.4 Smoke Test URLs

| Fixture | Value |
|---------|-------|
| Production URL | `https://edgar-diff-api.<account>.workers.dev` (or custom domain) |
| Preview URL | Dynamically provided by wrangler deploy output |
| Known valid CIK | `CIK0000320193` (Apple Inc.) |
| Known EFTS query | `q=apple&forms=10-K` |
| Known filing path | `edgar/data/320193/000032019323000106/aapl-20230930.htm` |

### 7.5 Expected CI Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets | Wrangler auth |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Secrets | Target account |

---

## 8. Performance Criteria

| Metric | Budget | Rationale |
|--------|--------|-----------|
| Build time (`nx run web:build`) | ≤ 30s | Vite is fast; worker bundle is small |
| Deploy time (`wrangler deploy`) | ≤ 60s | Asset upload + worker publish |
| Full CI deploy pipeline | ≤ 3 min | Build + deploy + smoke test |
| SPA initial load (TTFB) | ≤ 200ms | Cloudflare edge serving |
| API proxy response (p95) | ≤ 500ms | Dominated by SEC upstream latency |
| Smoke test suite | ≤ 30s | Sequential HTTP checks against deployed URL |

---

## 9. Test Execution Strategy

### In CI (pr-checks.yml — unchanged)

1. **Existing checks** — typecheck, lint, unit tests (includes wrangler config validation tests)
2. **Build verification** — `pnpm nx run web:verify-build` (runs build first via dependsOn, then validates output)
3. **Config validation** — `wrangler deploy --dry-run` (validates config + build output without credentials)
4. **Workflow lint** — `actionlint` on all `.github/workflows/*.yml`

### In CI (deploy.yml — deploy-production job, main push only)

1. **Build** — `pnpm nx run web:build`
2. **Deploy** — `wrangler deploy --env production`
3. **Capture URL** — Extract deployment URL from wrangler output
4. **Smoke test** — Run `smoke-test.sh <deployed-url>` (strict, 10s timeout, no retries)

### In CI (deploy.yml — deploy-preview job, PRs only)

1. **Build** — `pnpm nx run web:build`
2. **Preview deploy** — `wrangler deploy --env preview`
3. **Capture URL** — Extract preview URL from wrangler output
4. **Smoke test** — Run smoke suite against preview URL
5. **Comment URL** — Post/update preview URL on PR (only after smoke passes)

### Locally

```bash
# Validate config
npx wrangler deploy --dry-run --cwd apps/web

# Run build + verify build output
pnpm nx run web:verify-build

# Run smoke test against local dev
pnpm nx run web:dev &
./apps/web/scripts/smoke-test.sh http://localhost:5173
```

---

## 10. Out of Scope

- **Load testing** — Not needed for initial deployment; SEC API is the bottleneck
- **Multi-region testing** — Cloudflare handles edge distribution automatically
- **Browser compatibility** — Covered by existing SPA tests, not deployment-specific
- **Worker KV / Durable Objects** — Not used in current architecture
- **Custom domain setup** — Separate task; deployment works on `*.workers.dev` first
