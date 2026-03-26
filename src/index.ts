import { validateConfig, type Env } from "./config";
import { toResponse } from "./errors";
import { exchangeToken } from "./exchange";
import { json, jsonError } from "./http";
import { JtiReplayGuard } from "./replay";

export { JtiReplayGuard };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const configError = validateConfig(env);
      if (configError) return toResponse(configError);

      return json({ ok: true, service: "release-authenticator" });
    }

    if (request.method === "POST" && url.pathname === "/exchange") {
      return exchangeToken(request, env);
    }

    return jsonError(404, "not_found", "not found");
  },
};
