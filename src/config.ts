import {
  ErrorCode,
  appError,
  isAppError,
  type AppError,
} from "./errors";

export interface Env {
  APP_ID?: string;
  APP_PRIVATE_KEY?: string;
  EXPECTED_AUDIENCE?: string;
  ALLOWED_REF?: string;
  ALLOWED_WORKFLOW_PATH?: string;
  ALLOWED_ENVIRONMENT?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  RELEASE_ENVIRONMENT_NAME?: string;
  RELEASE_GATE_JOB_NAME?: string;
  RELEASE_WORKFLOW_PATH?: string;
  JTI_REPLAY_GUARD?: DurableObjectNamespace;
}

interface AppCredentials {
  appId: string;
  appPrivateKey: string;
}

export interface Config extends AppCredentials {
  expectedAudience: string;
  allowedRef: string;
  allowedWorkflowPath?: string;
  allowedEnvironment?: string;
  jtiReplayGuard: DurableObjectNamespace;
}

export interface DeploymentProtectionConfig extends AppCredentials {
  githubWebhookSecret: string;
  releaseEnvironmentName: string;
  releaseGateJobName: string;
  releaseWorkflowPath?: string;
}

const DEFAULT_ALLOWED_REF = "refs/heads/main";
const DEFAULT_RELEASE_ENVIRONMENT_NAME = "release";
const DEFAULT_RELEASE_GATE_JOB_NAME = "release-gate";
const DEFAULT_RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";

function getRequiredAppCredentials(env: Env): AppCredentials | AppError {
  if (!env.APP_ID) {
    return appError(ErrorCode.AppIdNotConfigured);
  }

  if (!env.APP_PRIVATE_KEY) {
    return appError(ErrorCode.AppPrivateKeyNotConfigured);
  }

  return {
    appId: env.APP_ID,
    appPrivateKey: env.APP_PRIVATE_KEY,
  };
}

function getRequiredExchangeConfig(
  env: Env,
):
  | {
      appId: string;
      appPrivateKey: string;
      jtiReplayGuard: DurableObjectNamespace;
    }
  | AppError {
  const credentials = getRequiredAppCredentials(env);
  if (isAppError(credentials)) {
    return credentials;
  }

  if (!env.JTI_REPLAY_GUARD) {
    return appError(ErrorCode.JtiReplayGuardNotConfigured);
  }

  return {
    ...credentials,
    jtiReplayGuard: env.JTI_REPLAY_GUARD,
  };
}

function getReleaseWorkflowPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return DEFAULT_RELEASE_WORKFLOW_PATH;
  }

  return value.length > 0 ? value : undefined;
}

export function validateConfig(env: Env): AppError | null {
  const requiredConfig = getRequiredExchangeConfig(env);
  return isAppError(requiredConfig) ? requiredConfig : null;
}

export function validateDeploymentProtectionConfig(env: Env): AppError | null {
  const credentials = getRequiredAppCredentials(env);
  if (isAppError(credentials)) {
    return credentials;
  }

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return appError(ErrorCode.GithubWebhookSecretNotConfigured);
  }

  return null;
}

export function getConfig(env: Env, requestUrl: string): Config | AppError {
  const requiredConfig = getRequiredExchangeConfig(env);
  if (isAppError(requiredConfig)) return requiredConfig;

  return {
    ...requiredConfig,
    expectedAudience: env.EXPECTED_AUDIENCE ?? new URL(requestUrl).origin,
    allowedRef: env.ALLOWED_REF ?? DEFAULT_ALLOWED_REF,
    allowedWorkflowPath: env.ALLOWED_WORKFLOW_PATH,
    allowedEnvironment: env.ALLOWED_ENVIRONMENT,
  };
}

export function getDeploymentProtectionConfig(
  env: Env,
): DeploymentProtectionConfig | AppError {
  const credentials = getRequiredAppCredentials(env);
  if (isAppError(credentials)) {
    return credentials;
  }

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return appError(ErrorCode.GithubWebhookSecretNotConfigured);
  }

  return {
    ...credentials,
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    releaseEnvironmentName:
      env.RELEASE_ENVIRONMENT_NAME ?? DEFAULT_RELEASE_ENVIRONMENT_NAME,
    releaseGateJobName: env.RELEASE_GATE_JOB_NAME ?? DEFAULT_RELEASE_GATE_JOB_NAME,
    releaseWorkflowPath: getReleaseWorkflowPath(env.RELEASE_WORKFLOW_PATH),
  };
}
