import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import type { DeploymentProtectionConfig } from "./config";
import { isAppError } from "./errors";
import {
  evaluateReleaseProtection,
  parseRequestedDeploymentProtection,
  parseRunIdFromDeploymentCallbackUrl,
  refMatchesAllowedRef,
  type WorkflowJobSummary,
} from "./deployment-protection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const deploymentProtectionFixture = JSON.parse(
  readFileSync(
    join(__dirname, "..", "testdata", "deployment-protection-requested.json"),
    "utf8",
  ),
);

const config: DeploymentProtectionConfig = {
  appId: "123",
  appPrivateKey: "private-key",
  githubWebhookSecret: "secret",
  allowedRef: "refs/heads/main",
  releaseEnvironmentName: "release",
  releaseGateJobName: "release-gate",
  releaseWorkflowPath: ".github/workflows/release.yml",
};

test("parseRunIdFromDeploymentCallbackUrl extracts the workflow run id", () => {
  const runId = parseRunIdFromDeploymentCallbackUrl(
    "https://api.github.com/repos/zaniebot/release-authenticator-example/actions/runs/23624826112/deployment_protection_rule",
  );

  assert.equal(runId, 23624826112);
});

test("parseRequestedDeploymentProtection accepts a real requested webhook payload shape", () => {
  const requested = parseRequestedDeploymentProtection(
    deploymentProtectionFixture,
  );

  assert.equal(isAppError(requested), false);
  if (isAppError(requested)) {
    throw requested;
  }

  assert.equal(requested.environment, "release");
  assert.equal(requested.ref, "main");
  assert.equal(requested.repository, "zaniebot/release-authenticator-example");
  assert.equal(requested.owner, "zaniebot");
  assert.equal(requested.repo, "release-authenticator-example");
  assert.equal(requested.runId, 23625057533);
});

test("refMatchesAllowedRef accepts full and short branch refs", () => {
  assert.equal(refMatchesAllowedRef("main", "refs/heads/main"), true);
  assert.equal(refMatchesAllowedRef("refs/heads/main", "refs/heads/main"), true);
  assert.equal(refMatchesAllowedRef("v1.2.3", "refs/tags/v1.2.3"), true);
  assert.equal(refMatchesAllowedRef("refs/tags/v1.2.3", "refs/tags/v1.2.3"), true);
  assert.equal(refMatchesAllowedRef("develop", "refs/heads/main"), false);
});

test("evaluateReleaseProtection approves a run after the gate job succeeds", () => {
  const jobs: WorkflowJobSummary[] = [
    { name: "release-gate", conclusion: "success" },
    { name: "publish", conclusion: null },
  ];

  const decision = evaluateReleaseProtection(
    { environment: "release", ref: "main" },
    { path: ".github/workflows/release.yml" },
    jobs,
    config,
  );

  assert.equal(decision.state, "approved");
  assert.equal(decision.comment, "release-gate passed");
});

test("evaluateReleaseProtection rejects a run with the wrong workflow path", () => {
  const decision = evaluateReleaseProtection(
    { environment: "release", ref: "main" },
    { path: ".github/workflows/ci.yml" },
    [{ name: "release-gate", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.match(decision.comment, /workflow path/);
});

test("evaluateReleaseProtection rejects a run when the gate job is missing", () => {
  const decision = evaluateReleaseProtection(
    { environment: "release", ref: "main" },
    { path: ".github/workflows/release.yml" },
    [{ name: "publish", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "workflow run is missing release-gate");
});

test("evaluateReleaseProtection rejects a run when the gate job did not succeed", () => {
  const decision = evaluateReleaseProtection(
    { environment: "release", ref: "main" },
    { path: ".github/workflows/release.yml" },
    [{ name: "release-gate", conclusion: "failure" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "release-gate concluded with failure");
});

test("evaluateReleaseProtection rejects a run for the wrong environment", () => {
  const decision = evaluateReleaseProtection(
    { environment: "staging", ref: "main" },
    { path: ".github/workflows/release.yml" },
    [{ name: "release-gate", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "environment staging is not allowed");
});

test("evaluateReleaseProtection rejects a run for the wrong ref", () => {
  const decision = evaluateReleaseProtection(
    { environment: "release", ref: "refs/tags/v1.2.3" },
    { path: ".github/workflows/release.yml" },
    [{ name: "release-gate", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "ref refs/tags/v1.2.3 is not allowed");
});
