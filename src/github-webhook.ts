import { ErrorCode, appError, type AppError } from "./errors";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  let mismatch = leftBytes.length === rightBytes.length ? 0 : 1;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export async function signGitHubWebhookPayload(
  secret: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );

  return `sha256=${toHex(signature)}`;
}

export async function verifyGitHubWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<AppError | null> {
  if (!signatureHeader) {
    return appError(ErrorCode.InvalidGithubWebhookSignature);
  }

  const expectedSignature = await signGitHubWebhookPayload(secret, body);
  if (!timingSafeEqual(expectedSignature, signatureHeader)) {
    return appError(ErrorCode.InvalidGithubWebhookSignature);
  }

  return null;
}
