import { errors as JoseErrors } from "jose";

import { jsonError } from "./http";

export enum ErrorCode {
  AppIdNotConfigured = "app_id_not_configured",
  AppPrivateKeyNotConfigured = "app_private_key_not_configured",
  JtiReplayGuardNotConfigured = "jti_replay_guard_not_configured",
  GithubWebhookSecretNotConfigured = "github_webhook_secret_not_configured",
  MissingBearerToken = "missing_bearer_token",
  InvalidExpiresIn = "invalid_expires_in",
  OidcTokenExpired = "oidc_token_expired",
  InvalidOidcToken = "invalid_oidc_token",
  OidcVerificationUnavailable = "oidc_verification_unavailable",
  OidcTokenMissingJti = "oidc_token_missing_jti",
  OidcTokenMissingExp = "oidc_token_missing_exp",
  OidcTokenReplayed = "oidc_token_replayed",
  JtiReplayGuardUnavailable = "jti_replay_guard_unavailable",
  RefNotAllowed = "ref_not_allowed",
  EnvironmentNotAllowed = "environment_not_allowed",
  RepositoryClaimMissing = "repository_claim_missing",
  RepositoryClaimInvalid = "repository_claim_invalid",
  PullRequestEventNotAllowed = "pull_request_event_not_allowed",
  WorkflowNotAllowed = "workflow_not_allowed",
  RepositoryIdClaimInvalid = "repository_id_claim_invalid",
  InvalidGithubWebhookSignature = "invalid_github_webhook_signature",
  DeploymentProtectionPayloadInvalid = "deployment_protection_payload_invalid",
  GithubAppAuthInvalid = "github_app_auth_invalid",
  GithubInstallationLookupForbidden = "github_installation_lookup_forbidden",
  AppNotInstalled = "app_not_installed",
  GithubInstallationLookupFailed = "github_installation_lookup_failed",
  GithubAccessTokenRequestForbidden = "github_access_token_request_forbidden",
  InstallationNotFound = "installation_not_found",
  InstallationTokenRequestInvalid = "installation_token_request_invalid",
  GithubAccessTokenRequestFailed = "github_access_token_request_failed",
  WorkflowRunLookupFailed = "workflow_run_lookup_failed",
  WorkflowJobsLookupFailed = "workflow_jobs_lookup_failed",
  DeploymentProtectionReviewFailed = "deployment_protection_review_failed",
  TokenExchangeFailed = "token_exchange_failed",
}

export interface AppError {
  kind: "app_error";
  code: ErrorCode;
  status: number;
  message: string;
}

const ERROR_DEFINITIONS: Record<ErrorCode, { status: number; message: string }> = {
  [ErrorCode.AppIdNotConfigured]: {
    status: 500,
    message: "APP_ID is not configured",
  },
  [ErrorCode.AppPrivateKeyNotConfigured]: {
    status: 500,
    message: "APP_PRIVATE_KEY is not configured",
  },
  [ErrorCode.JtiReplayGuardNotConfigured]: {
    status: 500,
    message: "JTI_REPLAY_GUARD is not configured",
  },
  [ErrorCode.GithubWebhookSecretNotConfigured]: {
    status: 500,
    message: "GITHUB_WEBHOOK_SECRET is not configured",
  },
  [ErrorCode.MissingBearerToken]: {
    status: 401,
    message: "missing bearer token",
  },
  [ErrorCode.InvalidExpiresIn]: {
    status: 400,
    message: "invalid expires_in",
  },
  [ErrorCode.OidcTokenExpired]: {
    status: 401,
    message: "oidc token expired",
  },
  [ErrorCode.InvalidOidcToken]: {
    status: 401,
    message: "invalid oidc token",
  },
  [ErrorCode.OidcVerificationUnavailable]: {
    status: 503,
    message: "oidc verification unavailable",
  },
  [ErrorCode.OidcTokenMissingJti]: {
    status: 401,
    message: "oidc token missing jti",
  },
  [ErrorCode.OidcTokenMissingExp]: {
    status: 401,
    message: "oidc token missing exp",
  },
  [ErrorCode.OidcTokenReplayed]: {
    status: 409,
    message: "oidc token replayed",
  },
  [ErrorCode.JtiReplayGuardUnavailable]: {
    status: 503,
    message: "jti replay guard unavailable",
  },
  [ErrorCode.RefNotAllowed]: {
    status: 403,
    message: "ref is not allowed",
  },
  [ErrorCode.EnvironmentNotAllowed]: {
    status: 403,
    message: "environment is not allowed",
  },
  [ErrorCode.RepositoryClaimMissing]: {
    status: 403,
    message: "repository claim missing",
  },
  [ErrorCode.RepositoryClaimInvalid]: {
    status: 403,
    message: "invalid repository claim",
  },
  [ErrorCode.PullRequestEventNotAllowed]: {
    status: 403,
    message: "pull request events are not allowed",
  },
  [ErrorCode.WorkflowNotAllowed]: {
    status: 403,
    message: "workflow is not allowed",
  },
  [ErrorCode.RepositoryIdClaimInvalid]: {
    status: 403,
    message: "repository_id claim missing or invalid",
  },
  [ErrorCode.InvalidGithubWebhookSignature]: {
    status: 401,
    message: "invalid GitHub webhook signature",
  },
  [ErrorCode.DeploymentProtectionPayloadInvalid]: {
    status: 400,
    message: "deployment protection payload is invalid",
  },
  [ErrorCode.GithubAppAuthInvalid]: {
    status: 424,
    message: "github app authentication failed",
  },
  [ErrorCode.GithubInstallationLookupForbidden]: {
    status: 424,
    message: "github rejected installation lookup",
  },
  [ErrorCode.AppNotInstalled]: {
    status: 403,
    message: "app is not installed on repository",
  },
  [ErrorCode.GithubInstallationLookupFailed]: {
    status: 502,
    message: "github installation lookup failed",
  },
  [ErrorCode.GithubAccessTokenRequestForbidden]: {
    status: 424,
    message: "github rejected access token request",
  },
  [ErrorCode.InstallationNotFound]: {
    status: 403,
    message: "repository installation is not available",
  },
  [ErrorCode.InstallationTokenRequestInvalid]: {
    status: 422,
    message: "repository or permissions are not allowed for this installation",
  },
  [ErrorCode.GithubAccessTokenRequestFailed]: {
    status: 502,
    message: "github access token request failed",
  },
  [ErrorCode.WorkflowRunLookupFailed]: {
    status: 502,
    message: "github workflow run lookup failed",
  },
  [ErrorCode.WorkflowJobsLookupFailed]: {
    status: 502,
    message: "github workflow jobs lookup failed",
  },
  [ErrorCode.DeploymentProtectionReviewFailed]: {
    status: 502,
    message: "github deployment protection review failed",
  },
  [ErrorCode.TokenExchangeFailed]: {
    status: 500,
    message: "token exchange failed",
  },
};

export function appError(
  code: ErrorCode,
  overrides?: Partial<Pick<AppError, "status" | "message">>,
): AppError {
  const definition = ERROR_DEFINITIONS[code];
  return {
    kind: "app_error",
    code,
    status: overrides?.status ?? definition.status,
    message: overrides?.message ?? definition.message,
  };
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "app_error"
  );
}

export function toResponse(error: AppError): Response {
  return jsonError(error.status, error.code, error.message);
}

function getRequestErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }

  const { status } = error as { status?: unknown };
  return typeof status === "number" ? status : null;
}

export function mapOidcVerificationError(error: unknown): AppError {
  if (error instanceof JoseErrors.JWTExpired) {
    return appError(ErrorCode.OidcTokenExpired);
  }

  if (
    error instanceof JoseErrors.JWTClaimValidationFailed ||
    error instanceof JoseErrors.JWTInvalid ||
    error instanceof JoseErrors.JWSInvalid ||
    error instanceof JoseErrors.JWSSignatureVerificationFailed ||
    error instanceof JoseErrors.JWKSNoMatchingKey ||
    error instanceof JoseErrors.JWKSMultipleMatchingKeys ||
    error instanceof JoseErrors.JOSEAlgNotAllowed
  ) {
    return appError(ErrorCode.InvalidOidcToken);
  }

  console.error("oidc verification failed", error);
  return appError(ErrorCode.OidcVerificationUnavailable);
}

export function mapInstallationLookupError(error: unknown): AppError {
  const status = getRequestErrorStatus(error);

  switch (status) {
    case 401:
      return appError(ErrorCode.GithubAppAuthInvalid);
    case 403:
      return appError(ErrorCode.GithubInstallationLookupForbidden);
    case 404:
      return appError(ErrorCode.AppNotInstalled);
    default:
      console.error("installation lookup failed", error);
      return appError(ErrorCode.GithubInstallationLookupFailed);
  }
}

export function mapAccessTokenRequestError(error: unknown): AppError {
  const status = getRequestErrorStatus(error);

  switch (status) {
    case 401:
      return appError(ErrorCode.GithubAppAuthInvalid);
    case 403:
      return appError(ErrorCode.GithubAccessTokenRequestForbidden);
    case 404:
      return appError(ErrorCode.InstallationNotFound);
    case 422:
      return appError(ErrorCode.InstallationTokenRequestInvalid);
    default:
      console.error("access token request failed", error);
      return appError(ErrorCode.GithubAccessTokenRequestFailed);
  }
}

export function mapWorkflowRunLookupError(error: unknown): AppError {
  console.error("workflow run lookup failed", error);
  return appError(ErrorCode.WorkflowRunLookupFailed);
}

export function mapWorkflowJobsLookupError(error: unknown): AppError {
  console.error("workflow jobs lookup failed", error);
  return appError(ErrorCode.WorkflowJobsLookupFailed);
}

export function mapDeploymentProtectionReviewError(error: unknown): AppError {
  console.error("deployment protection review failed", error);
  return appError(ErrorCode.DeploymentProtectionReviewFailed);
}
