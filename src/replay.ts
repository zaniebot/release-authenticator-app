import { DurableObject } from "cloudflare:workers";

import { type Config } from "./config";
import { ErrorCode, appError, type AppError } from "./errors";
import { jsonError } from "./http";

const CLAIM_PATH = "https://replay.internal/claim";
const STORAGE_KEY = "expiresAtMs";

interface ClaimRequestBody {
  expiresAtMs: number;
}

function isValidExpiresAtMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashReplayKey(issuer: string, jti: string): Promise<string> {
  const payload = new TextEncoder().encode(`${issuer}\0${jti}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return toHex(digest);
}

export async function claimJti(
  config: Config,
  issuer: string,
  jti: string,
  expiresAtMs: number,
): Promise<AppError | null> {
  try {
    const key = await hashReplayKey(issuer, jti);
    const response = await config.jtiReplayGuard.getByName(key).fetch(CLAIM_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresAtMs }),
    });

    if (response.status === 204) {
      return null;
    }

    if (response.status === 409) {
      return appError(ErrorCode.OidcTokenReplayed);
    }

    console.error("jti replay claim failed", response.status);
    return appError(ErrorCode.JtiReplayGuardUnavailable);
  } catch (error) {
    console.error("jti replay claim failed", error);
    return appError(ErrorCode.JtiReplayGuardUnavailable);
  }
}

export class JtiReplayGuard extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/claim") {
      return jsonError(404, "not_found", "not found");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_request", "invalid request");
    }

    const expiresAtMs = (body as Partial<ClaimRequestBody>).expiresAtMs;
    if (!isValidExpiresAtMs(expiresAtMs) || expiresAtMs <= Date.now()) {
      return jsonError(400, "invalid_expires_at", "invalid expiresAtMs");
    }

    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<number>(STORAGE_KEY);
      if (typeof existing === "number" && existing > Date.now()) {
        return new Response(null, { status: 409 });
      }

      await this.ctx.storage.put(STORAGE_KEY, expiresAtMs);
      await this.ctx.storage.setAlarm(expiresAtMs);
      return new Response(null, { status: 204 });
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
