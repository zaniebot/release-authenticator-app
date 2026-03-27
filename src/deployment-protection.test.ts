import assert from "node:assert/strict";
import test from "node:test";

import type { DeploymentProtectionConfig } from "./config";
import {
  evaluateReleaseProtection,
  parseRunIdFromDeploymentCallbackUrl,
  type WorkflowJobSummary,
} from "./deployment-protection";

const config: DeploymentProtectionConfig = {
  appId: "123",
  appPrivateKey: "private-key",
  githubWebhookSecret: "secret",
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

test("evaluateReleaseProtection approves a run after the gate job succeeds", () => {
  const jobs: WorkflowJobSummary[] = [
    { name: "release-gate", conclusion: "success" },
    { name: "publish", conclusion: null },
  ];

  const decision = evaluateReleaseProtection(
    { path: ".github/workflows/release.yml" },
    jobs,
    config,
  );

  assert.equal(decision.state, "approved");
  assert.equal(decision.comment, "release-gate passed");
});

test("evaluateReleaseProtection rejects a run with the wrong workflow path", () => {
  const decision = evaluateReleaseProtection(
    { path: ".github/workflows/ci.yml" },
    [{ name: "release-gate", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.match(decision.comment, /workflow path/);
});

test("evaluateReleaseProtection rejects a run when the gate job is missing", () => {
  const decision = evaluateReleaseProtection(
    { path: ".github/workflows/release.yml" },
    [{ name: "publish", conclusion: "success" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "workflow run is missing release-gate");
});

test("evaluateReleaseProtection rejects a run when the gate job did not succeed", () => {
  const decision = evaluateReleaseProtection(
    { path: ".github/workflows/release.yml" },
    [{ name: "release-gate", conclusion: "failure" }],
    config,
  );

  assert.equal(decision.state, "rejected");
  assert.equal(decision.comment, "release-gate concluded with failure");
});
