# release-authenticator-app

Cloudflare Worker for Astral release automation.

It currently supports two GitHub App-backed flows:

1. **OIDC exchange** at `POST /exchange`
   - verifies a GitHub Actions OIDC token
   - mints a short-lived GitHub App installation token scoped to the calling repository
2. **Custom deployment protection rule approvals** at `POST /github/webhook`
   - validates GitHub App webhook deliveries
   - checks that the current workflow run already passed a human-approved `release-gate` job
   - approves or rejects the protected `release` environment for that run

## Security model

### OIDC exchange

- Verifies the OIDC JWT against GitHub's JWKS
- Requires `iss = https://token.actions.githubusercontent.com`
- Accepts only `RS256` and allows a small clock skew tolerance
- Requires `aud` matches the worker's own origin (or `EXPECTED_AUDIENCE` if set)
- Requires `ref = ALLOWED_REF` (defaults to `refs/heads/main`)
- Rejects pull request tokens, including `pull_request_target`
- Optionally requires a workflow file lock via `workflow_ref` / `job_workflow_ref`
- Optionally requires `environment = ALLOWED_ENVIRONMENT`
- Requires `jti` and rejects replayed OIDC tokens via a Durable Object-backed replay guard
- Looks up the installation for the repository named in the OIDC claims
- Mints an installation token scoped to that same `repository_id`
- Grants `contents: write`

### Deployment protection approvals

- Validates GitHub App webhook deliveries with `X-Hub-Signature-256`
- Handles `deployment_protection_rule` requests from the `release` environment
- Mints an installation token scoped to the triggering repository with:
  - `actions: read`
  - `deployments: write`
- Fetches the workflow run and its jobs
- Requires the run to come from `.github/workflows/release.yml` by default
- Requires a job named `release-gate` to have concluded with `success`
- Approves the deployment protection rule only after that gate passes

The GitHub App private key lives only in Cloudflare Worker secrets.

## Setup

### Secrets

Set these as Cloudflare Worker secrets:

- `APP_ID`: The GitHub App id (or client application id)
- `APP_PRIVATE_KEY`: PKCS#8 encoded private key for the GitHub App
- `GITHUB_WEBHOOK_SECRET`: The GitHub App webhook secret used for `POST /github/webhook`

> **Private key format**: The Cloudflare Workers runtime requires PKCS#8 keys
> (`BEGIN PRIVATE KEY`), but GitHub's App settings page downloads PKCS#1
> (`BEGIN RSA PRIVATE KEY`). Convert before uploading:
>
> ```bash
> openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
>   -in <downloaded-key>.pem -out private-key-pkcs8.pem
> ```
>
> Then upload the converted key:
>
> ```bash
> cat private-key-pkcs8.pem | npx wrangler secret put APP_PRIVATE_KEY
> ```

### Configuration

Set these in `wrangler.toml`:

#### OIDC exchange

- `EXPECTED_AUDIENCE` (optional) — the OIDC `aud` claim the worker requires. Defaults to the
  worker's own origin (e.g. `https://release-authenticator.<subdomain>.workers.dev`), which matches
  the action's default. You only need to set this if you want a custom audience.
- `ALLOWED_REF` (optional) — defaults to `refs/heads/main`
- `ALLOWED_WORKFLOW_PATH` (optional)
- `ALLOWED_ENVIRONMENT` (optional)

A generic release lock would be:

```toml
ALLOWED_REF = "refs/heads/main"
ALLOWED_WORKFLOW_PATH = ".github/workflows/release.yml"
ALLOWED_ENVIRONMENT = "release"
```

`ALLOWED_WORKFLOW_PATH` is matched as an exact same-repository, same-ref workflow identity:

- `${repository}/${ALLOWED_WORKFLOW_PATH}@${ALLOWED_REF}`

That exact value is compared against `workflow_ref` for direct workflows and `job_workflow_ref` for reusable workflows.

#### Deployment protection approvals

These defaults match `uv`'s release workflow:

```toml
RELEASE_ENVIRONMENT_NAME = "release"
RELEASE_GATE_JOB_NAME = "release-gate"
RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml"
```

- `RELEASE_ENVIRONMENT_NAME` — protected environment that the app will review
- `RELEASE_GATE_JOB_NAME` — job that must already be `success`
- `RELEASE_WORKFLOW_PATH` — workflow file path the run must come from; set it to `""` to disable this lock

## GitHub App permissions

Configure the GitHub App with:

- **Actions**: Read-only
- **Contents**: Read and write
- **Deployments**: Read and write
- **Metadata**: Read-only

For deployment protection approvals, subscribe the App webhook to:

- `deployment_protection_rule`
- `ping`

## Deploy

Set these environment variables for deployment, or add them to `.env.local`:

```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
```

Then:

```bash
npm install
npm run check
npm test
npm run deploy
```

The included `wrangler.toml` migration creates the `JtiReplayGuard` Durable Object used for
single-use OIDC `jti` enforcement.

## Workflow usage

### OIDC exchange

```yaml
permissions:
  id-token: write
  contents: write

steps:
  - uses: actions/checkout@v4

  - uses: astral-sh/release-authenticator-action@main
    id: app-token
    with:
      url: https://release-authenticator.<subdomain>.workers.dev/exchange

  - name: Create release
    env:
      GH_TOKEN: ${{ steps.app-token.outputs.token }}
    run: gh release create "v${{ inputs.version }}" --generate-notes
```

### Release gate + protected environment

For the `uv` release workflow, the intended pattern is:

1. Add a single `release-gate` job that targets a `release-gate` environment with human reviewers
2. Keep all real release secrets in the `release` environment
3. Configure `release` to use this GitHub App as a custom deployment protection rule
4. Make the release jobs depend on `release-gate`
5. Keep `deployment: false` only for CI-only `release-test` jobs, not real release jobs

Example gate job:

```yaml
release-gate:
  name: release-gate
  needs:
    - plan
  if: ${{ needs.plan.outputs.publishing == 'true' }}
  runs-on: ubuntu-latest
  environment:
    name: release-gate
    deployment: false
  steps:
    - run: echo "Release approved"
```

## Tag protection

To ensure only the GitHub App can create release tags, add a repository ruleset to each target repository:

- **Target**: Tags → All tags
- **Enforcement**: Active
- **Rules**: Block creation, deletion, update, and non-fast-forward
- **Bypass actors**: Add your GitHub App with "Always" bypass mode

This prevents humans, `GITHUB_TOKEN`, and other apps from creating or modifying tags. Only a token
from the release-authenticator-app — triggered through the OIDC-verified workflow — can create
releases.

You can configure this in the repository settings under **Rules → Rulesets**, or via the API:

```json
{
  "name": "only-release-app",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": ["~ALL"]
    }
  },
  "rules": [
    { "type": "creation" },
    { "type": "deletion" },
    { "type": "update" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": [
    {
      "actor_id": <your-app-id>,
      "actor_type": "Integration",
      "bypass_mode": "always"
    }
  ]
}
```

## Endpoints

- `GET /health` — returns 200 only when the OIDC exchange config is present
- `GET /health/deployment-protection` — returns 200 only when deployment protection config is present
- `POST /exchange`
- `POST /github/webhook`

`POST /exchange` expects:

- `Authorization: Bearer <github-actions-oidc-token>`

It returns:

```json
{
  "token": "...",
  "expires_at": "2026-03-25T16:00:00Z",
  "repository": "owner/repo",
  "ref": "refs/heads/main"
}
```

`POST /github/webhook` expects a GitHub App webhook delivery with:

- `X-GitHub-Event: deployment_protection_rule`
- `X-Hub-Signature-256: sha256=...`

It approves or rejects the deployment protection rule and returns:

```json
{
  "ok": true,
  "repository": "astral-sh/uv",
  "run_id": 123456789,
  "environment": "release",
  "state": "approved",
  "comment": "release-gate passed"
}
```
