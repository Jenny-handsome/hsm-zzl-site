export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function apiError(status, code, message, headers = {}) {
  return json({ ok: false, code, message }, status, headers);
}

export async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("请求内容不是有效 JSON");
    error.status = 400;
    error.code = "BAD_JSON";
    throw error;
  }
}

export function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};

  let requestOrigin = "";
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    requestOrigin = "";
  }

  const allowedOrigins = new Set([requestOrigin, "https://w.ketangpai.com"]);
  if (!allowedOrigins.has(origin)) return {};

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

export function optionsResponse(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}
