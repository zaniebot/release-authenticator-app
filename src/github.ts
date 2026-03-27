import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

export function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
}

export function createGitHubAppClient(
  appId: string,
  appPrivateKey: string,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: normalizePrivateKey(appPrivateKey),
    },
  });
}
