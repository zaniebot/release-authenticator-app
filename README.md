# release-authenticator-app

Cloudflare Worker that verifies a GitHub Actions OIDC token and exchanges it for a short-lived
GitHub App installation token.

## Security model

- Verifies the OIDC JWT against GitHub's JWKS
- Requires `iss = https://token.actions.githubusercontent.com`
- Requires `aud` matches the worker's own origin (or `EXPECTED_AUDIENCE` if set)
- Requires `ref = ALLOWED_REF` (defaults to `refs/heads/main`)
- Rejects pull request tokens, including `pull_request_target`
- Optionally requires a workflow file lock via `workflow_ref` / `job_workflow_ref`
- Optionally requires `environment = ALLOWED_ENVIRONMENT`
- Looks up the installation for the repository named in the OIDC claims
- Mints an installation token scoped to that same `repository_id`
- Grants `contents: write`

The GitHub App private key lives only in Cloudflare Worker secrets.

## Setup

### Secrets

- `APP_ID`: The GitHub App id (or client application id)
- `APP_PRIVATE_KEY`: PKCS#8 encoded private key for the GitHub App

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
npm run deploy
```

## Workflow usage

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

## App permissions

Configure the GitHub App with:

- **Contents**: Read and write
- **Metadata**: Read-only

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

- `GET /health` — returns 200 only when required worker config is present
- `POST /exchange`

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
