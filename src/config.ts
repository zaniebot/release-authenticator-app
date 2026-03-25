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
}

export interface Config {
  appId: string;
  appPrivateKey: string;
  expectedAudience: string;
  allowedRef: string;
  allowedWorkflowPath?: string;
  allowedEnvironment?: string;
}

const DEFAULT_ALLOWED_REF = "refs/heads/main";

function getRequiredConfig(
  env: Env,
): { appId: string; appPrivateKey: string } | AppError {
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

export function validateConfig(env: Env): AppError | null {
  const requiredConfig = getRequiredConfig(env);
  return isAppError(requiredConfig) ? requiredConfig : null;
}

export function getConfig(env: Env, requestUrl: string): Config | AppError {
  const requiredConfig = getRequiredConfig(env);
  if (isAppError(requiredConfig)) return requiredConfig;

  return {
    ...requiredConfig,
    expectedAudience: env.EXPECTED_AUDIENCE ?? new URL(requestUrl).origin,
    allowedRef: env.ALLOWED_REF ?? DEFAULT_ALLOWED_REF,
    allowedWorkflowPath: env.ALLOWED_WORKFLOW_PATH,
    allowedEnvironment: env.ALLOWED_ENVIRONMENT,
  };
}
