import { createAppAuth } from "@octokit/auth-app";
import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
} from "jose";
import { Octokit } from "octokit";

import { getConfig, type Config, type Env } from "./config";
import {
  ErrorCode,
  appError,
  isAppError,
  mapAccessTokenRequestError,
  mapInstallationLookupError,
  mapOidcVerificationError,
  toResponse,
  type AppError,
} from "./errors";
import { json } from "./http";

interface GitHubActionsClaims extends JWTPayload {
  repository?: string;
  repository_id?: string | number;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  environment?: string;
}

interface VerifiedClaims {
  repository: string;
  repositoryId: number;
  repoParts: {
    owner: string;
    repo: string;
  };
  ref: string;
}

interface ExchangeResponse {
  token: string;
  expires_at: string;
  repository: string;
  ref: string;
}

const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
const ACTIONS_JWKS_URL = new URL(`${ACTIONS_ISSUER}/.well-known/jwks`);
const JWKS = createRemoteJWKSet(ACTIONS_JWKS_URL);
const MIN_TOKEN_LIFETIME_MINUTES = 10;
const MAX_TOKEN_LIFETIME_MINUTES = 60;

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;

  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function parseRepository(
  repository: string,
): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return { owner, repo };
}

function parseRepositoryId(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function parseExpiresIn(value: string | null): number | null | AppError {
  if (!value) return null;

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_TOKEN_LIFETIME_MINUTES ||
    parsed > MAX_TOKEN_LIFETIME_MINUTES
  ) {
    return appError(ErrorCode.InvalidExpiresIn, {
      message: `expires_in must be an integer between ${MIN_TOKEN_LIFETIME_MINUTES} and ${MAX_TOKEN_LIFETIME_MINUTES}`,
    });
  }

  return parsed;
}

function expiresAtFromMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
}

async function verifyOidcClaims(
  request: Request,
  config: Config,
): Promise<VerifiedClaims | AppError> {
  const oidcToken = getBearerToken(request);
  if (!oidcToken) {
    return appError(ErrorCode.MissingBearerToken);
  }

  let payload: GitHubActionsClaims;
  try {
    const verified = await jwtVerify<GitHubActionsClaims>(oidcToken, JWKS, {
      issuer: ACTIONS_ISSUER,
      audience: config.expectedAudience,
    });
    payload = verified.payload;
  } catch (error) {
    return mapOidcVerificationError(error);
  }

  if (payload.ref !== config.allowedRef) {
    return appError(ErrorCode.RefNotAllowed);
  }

  if (
    config.allowedEnvironment &&
    payload.environment !== config.allowedEnvironment
  ) {
    return appError(ErrorCode.EnvironmentNotAllowed);
  }

  if (typeof payload.repository !== "string") {
    return appError(ErrorCode.RepositoryClaimMissing);
  }

  const repository = payload.repository;
  const repoParts = parseRepository(repository);
  if (!repoParts) {
    return appError(ErrorCode.RepositoryClaimInvalid);
  }

  if (
    payload.event_name === "pull_request" ||
    payload.event_name === "pull_request_target" ||
    payload.sub === `repo:${repository}:pull_request`
  ) {
    return appError(ErrorCode.PullRequestEventNotAllowed);
  }

  if (config.allowedWorkflowPath) {
    const expectedWorkflowRef = `${repository}/${config.allowedWorkflowPath}@${config.allowedRef}`;
    if (
      payload.workflow_ref !== expectedWorkflowRef &&
      payload.job_workflow_ref !== expectedWorkflowRef
    ) {
      return appError(ErrorCode.WorkflowNotAllowed);
    }
  }

  const repositoryId = parseRepositoryId(payload.repository_id);
  if (!repositoryId) {
    return appError(ErrorCode.RepositoryIdClaimInvalid);
  }

  return {
    repository,
    repositoryId,
    repoParts,
    ref: config.allowedRef,
  };
}

async function mintInstallationToken(
  config: Config,
  claims: VerifiedClaims,
  expiresInMinutes: number | null,
): Promise<ExchangeResponse | AppError> {
  try {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.appId,
        privateKey: normalizePrivateKey(config.appPrivateKey),
      },
    });

    let installationId: number;
    try {
      const installation = await octokit.request(
        "GET /repos/{owner}/{repo}/installation",
        {
          owner: claims.repoParts.owner,
          repo: claims.repoParts.repo,
        },
      );
      installationId = installation.data.id;
    } catch (error) {
      return mapInstallationLookupError(error);
    }

    try {
      const accessToken = await octokit.request(
        "POST /app/installations/{installation_id}/access_tokens",
        {
          installation_id: installationId,
          repository_ids: [claims.repositoryId],
          permissions: {
            contents: "write",
          },
          ...(expiresInMinutes && {
            expires_at: expiresAtFromMinutes(expiresInMinutes),
          }),
        },
      );

      return {
        token: accessToken.data.token,
        expires_at: accessToken.data.expires_at,
        repository: claims.repository,
        ref: claims.ref,
      };
    } catch (error) {
      return mapAccessTokenRequestError(error);
    }
  } catch (error) {
    console.error("token exchange failed", error);
    return appError(ErrorCode.TokenExchangeFailed);
  }
}

export async function exchangeToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const config = getConfig(env, request.url);
  if (isAppError(config)) return toResponse(config);

  const url = new URL(request.url);
  const expiresIn = parseExpiresIn(url.searchParams.get("expires_in"));
  if (isAppError(expiresIn)) return toResponse(expiresIn);

  const claims = await verifyOidcClaims(request, config);
  if (isAppError(claims)) return toResponse(claims);

  const response = await mintInstallationToken(config, claims, expiresIn);
  if (isAppError(response)) return toResponse(response);

  return json(response);
}
