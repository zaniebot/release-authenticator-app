import assert from "node:assert/strict";
import test from "node:test";

import { ErrorCode } from "./errors";
import {
  signGitHubWebhookPayload,
  verifyGitHubWebhookSignature,
} from "./github-webhook";

test("verifyGitHubWebhookSignature accepts a valid signature", async () => {
  const secret = "super-secret";
  const body = JSON.stringify({ hello: "world" });
  const signature = await signGitHubWebhookPayload(secret, body);

  const error = await verifyGitHubWebhookSignature(secret, body, signature);
  assert.equal(error, null);
});

test("verifyGitHubWebhookSignature rejects a missing signature", async () => {
  const error = await verifyGitHubWebhookSignature(
    "super-secret",
    "{}",
    null,
  );

  assert.ok(error);
  assert.equal(error.code, ErrorCode.InvalidGithubWebhookSignature);
});

test("verifyGitHubWebhookSignature rejects an invalid signature", async () => {
  const error = await verifyGitHubWebhookSignature(
    "super-secret",
    "{}",
    "sha256=deadbeef",
  );

  assert.ok(error);
  assert.equal(error.code, ErrorCode.InvalidGithubWebhookSignature);
});
