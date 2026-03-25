export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...init?.headers,
    },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  return json({ error: message, code }, { status });
}
