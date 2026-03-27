import { Octokit } from "octokit";

import {
  getDeploymentProtectionConfig,
  type DeploymentProtectionConfig,
  type Env,
} from "./config";
import {
  ErrorCode,
  appError,
  isAppError,
  mapAccessTokenRequestError,
  mapDeploymentProtectionReviewError,
  mapWorkflowJobsLookupError,
  mapWorkflowRunLookupError,
  toResponse,
  type AppError,
} from "./errors";
import { createGitHubAppClient } from "./github";
import { verifyGitHubWebhookSignature } from "./github-webhook";
import { json } from "./http";

interface DeploymentProtectionRulePayload {
  action?: string;
  environment?: string;
  installation?: {
    id?: number;
  };
  repository?: {
    id?: number;
    full_name?: string;
    name?: string;
    owner?: {
      login?: string;
    };
  };
  workflow_run?: {
    id?: number;
  };
}

interface RequestedDeploymentProtection {
  environment: string;
  installationId: number;
  owner: string;
  repo: string;
  repository: string;
  repositoryId: number;
  runId: number;
}

interface WorkflowRunSummary {
  path?: string | null;
}

export interface WorkflowJobSummary {
  name: string;
  conclusion?: string | null;
}

export interface ReleaseProtectionDecision {
  state: "approved" | "rejected";
  comment: string;
}

const DEPLOYMENT_PROTECTION_EVENT = "deployment_protection_rule";
const PING_EVENT = "ping";
const REQUESTED_ACTION = "requested";

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function parseRepositoryCoordinates(
  repository: DeploymentProtectionRulePayload["repository"],
): { owner: string; repo: string; repository: string; repositoryId: number } | null {
  const repositoryId = parsePositiveInteger(repository?.id);
  if (!repositoryId) {
    return null;
  }

  const owner = repository?.owner?.login;
  const repo = repository?.name;
  if (owner && repo) {
    return {
      owner,
      repo,
      repository: `${owner}/${repo}`,
      repositoryId,
    };
  }

  const fullName = repository?.full_name;
  if (!fullName) {
    return null;
  }

  const [parsedOwner, parsedRepo, ...rest] = fullName.split("/");
  if (!parsedOwner || !parsedRepo || rest.length > 0) {
    return null;
  }

  return {
    owner: parsedOwner,
    repo: parsedRepo,
    repository: fullName,
    repositoryId,
  };
}

function parseRequestedDeploymentProtection(
  payload: unknown,
): RequestedDeploymentProtection | AppError {
  if (typeof payload !== "object" || payload === null) {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid);
  }

  const requestedPayload = payload as DeploymentProtectionRulePayload;

  if (requestedPayload.action !== REQUESTED_ACTION) {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid, {
      message: `deployment protection action must be ${REQUESTED_ACTION}`,
    });
  }

  if (typeof requestedPayload.environment !== "string") {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid, {
      message: "deployment protection payload is missing environment",
    });
  }

  const installationId = parsePositiveInteger(requestedPayload.installation?.id);
  if (!installationId) {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid, {
      message: "deployment protection payload is missing installation.id",
    });
  }

  const repository = parseRepositoryCoordinates(requestedPayload.repository);
  if (!repository) {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid, {
      message: "deployment protection payload is missing repository coordinates",
    });
  }

  const runId = parsePositiveInteger(requestedPayload.workflow_run?.id);
  if (!runId) {
    return appError(ErrorCode.DeploymentProtectionPayloadInvalid, {
      message: "deployment protection payload is missing workflow_run.id",
    });
  }

  return {
    environment: requestedPayload.environment,
    installationId,
    ...repository,
    runId,
  };
}

export function evaluateReleaseProtection(
  workflowRun: WorkflowRunSummary,
  jobs: WorkflowJobSummary[],
  config: Pick<
    DeploymentProtectionConfig,
    "releaseGateJobName" | "releaseWorkflowPath"
  >,
): ReleaseProtectionDecision {
  if (
    config.releaseWorkflowPath &&
    workflowRun.path !== config.releaseWorkflowPath
  ) {
    return {
      state: "rejected",
      comment: `workflow path ${workflowRun.path ?? "<missing>"} is not allowed`,
    };
  }

  const releaseGateJob = jobs.find(
    (job) => job.name === config.releaseGateJobName,
  );
  if (!releaseGateJob) {
    return {
      state: "rejected",
      comment: `workflow run is missing ${config.releaseGateJobName}`,
    };
  }

  if (releaseGateJob.conclusion !== "success") {
    return {
      state: "rejected",
      comment: `${config.releaseGateJobName} concluded with ${releaseGateJob.conclusion ?? "no conclusion"}`,
    };
  }

  return {
    state: "approved",
    comment: `${config.releaseGateJobName} passed`,
  };
}

async function mintDeploymentProtectionToken(
  config: DeploymentProtectionConfig,
  requested: RequestedDeploymentProtection,
): Promise<string | AppError> {
  const octokit = createGitHubAppClient(config.appId, config.appPrivateKey);

  try {
    const response = await octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: requested.installationId,
        repository_ids: [requested.repositoryId],
        permissions: {
          actions: "read",
          deployments: "write",
        },
      },
    );

    return response.data.token;
  } catch (error) {
    return mapAccessTokenRequestError(error);
  }
}

async function fetchWorkflowRun(
  octokit: Octokit,
  requested: RequestedDeploymentProtection,
): Promise<WorkflowRunSummary | AppError> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      {
        owner: requested.owner,
        repo: requested.repo,
        run_id: requested.runId,
      },
    );

    return {
      path: response.data.path,
    };
  } catch (error) {
    return mapWorkflowRunLookupError(error);
  }
}

async function fetchWorkflowJobs(
  octokit: Octokit,
  requested: RequestedDeploymentProtection,
): Promise<WorkflowJobSummary[] | AppError> {
  try {
    const jobs = await octokit.paginate(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      {
        owner: requested.owner,
        repo: requested.repo,
        run_id: requested.runId,
        per_page: 100,
      },
      (response) =>
        response.data.jobs.map((job) => ({
          name: job.name,
          conclusion: job.conclusion,
        })),
    );

    return jobs;
  } catch (error) {
    return mapWorkflowJobsLookupError(error);
  }
}

async function reviewDeploymentProtectionRule(
  octokit: Octokit,
  requested: RequestedDeploymentProtection,
  decision: ReleaseProtectionDecision,
): Promise<AppError | null> {
  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule",
      {
        owner: requested.owner,
        repo: requested.repo,
        run_id: requested.runId,
        environment_name: requested.environment,
        state: decision.state,
        comment: decision.comment,
      },
    );

    return null;
  } catch (error) {
    return mapDeploymentProtectionReviewError(error);
  }
}

export async function handleGitHubWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const config = getDeploymentProtectionConfig(env);
  if (isAppError(config)) {
    return toResponse(config);
  }

  const body = await request.text();
  const signatureError = await verifyGitHubWebhookSignature(
    config.githubWebhookSecret,
    body,
    request.headers.get("x-hub-signature-256"),
  );
  if (signatureError) {
    return toResponse(signatureError);
  }

  const event = request.headers.get("x-github-event");
  if (event === PING_EVENT) {
    return json({ ok: true, event: PING_EVENT });
  }

  if (event !== DEPLOYMENT_PROTECTION_EVENT) {
    return json({ ok: true, ignored: true, event }, { status: 202 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return toResponse(appError(ErrorCode.DeploymentProtectionPayloadInvalid));
  }

  const action =
    typeof payload === "object" && payload !== null && "action" in payload
      ? (payload as { action?: unknown }).action
      : undefined;
  if (action !== REQUESTED_ACTION) {
    return json(
      { ok: true, ignored: true, event, action },
      { status: 202 },
    );
  }

  const requested = parseRequestedDeploymentProtection(payload);
  if (isAppError(requested)) {
    return toResponse(requested);
  }

  const installationToken = await mintDeploymentProtectionToken(
    config,
    requested,
  );
  if (isAppError(installationToken)) {
    return toResponse(installationToken);
  }

  const octokit = new Octokit({ auth: installationToken });

  let decision: ReleaseProtectionDecision;
  if (requested.environment !== config.releaseEnvironmentName) {
    decision = {
      state: "rejected",
      comment: `environment ${requested.environment} is not allowed`,
    };
  } else {
    const workflowRun = await fetchWorkflowRun(octokit, requested);
    if (isAppError(workflowRun)) {
      return toResponse(workflowRun);
    }

    const jobs = await fetchWorkflowJobs(octokit, requested);
    if (isAppError(jobs)) {
      return toResponse(jobs);
    }

    decision = evaluateReleaseProtection(workflowRun, jobs, config);
  }

  const reviewError = await reviewDeploymentProtectionRule(
    octokit,
    requested,
    decision,
  );
  if (reviewError) {
    return toResponse(reviewError);
  }

  return json({
    ok: true,
    repository: requested.repository,
    run_id: requested.runId,
    environment: requested.environment,
    state: decision.state,
    comment: decision.comment,
  });
}
