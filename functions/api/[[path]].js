import { createPasswordHash, randomToken, sha256Hex, verifyPassword } from "../_lib/crypto.js";
import { apiError, corsHeaders, json, optionsResponse, readJson } from "../_lib/http.js";
import {
  calculateRemaining,
  getUsageDate,
  normalizeDailyLimit,
  parseKetangpaiUrl,
  sanitizeMessage
} from "../_lib/usage.js";

const SESSION_COOKIE = "ktp_admin_session";
const SESSION_DAYS = 14;
const TICKET_MINUTES = 30;

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") return optionsResponse(request);

  try {
    if (!context.env.DB) {
      return apiError(500, "DB_NOT_CONFIGURED", "Cloudflare D1 binding DB is not configured", corsHeaders(request));
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/g, "");

    if (request.method === "POST" && route === "auth/login") return await login(context);
    if (request.method === "POST" && route === "auth/logout") return await logout(context);
    if (request.method === "GET" && route === "auth/me") return await me(context);

    if (request.method === "GET" && route === "admin/bootstrap") return await bootstrapStatus(context);
    if (request.method === "POST" && route === "admin/bootstrap") return await bootstrapAdmin(context);
    if (request.method === "GET" && route === "admin/access-keys") return await listAccessKeys(context);
    if (request.method === "POST" && route === "admin/access-keys") return await createAccessKey(context);
    if (request.method === "POST" && route === "admin/access-keys/update") return await updateAccessKey(context);
    if (request.method === "GET" && route === "admin/usage") return await listUsage(context);

    if (request.method === "GET" && route === "bookmarklet/script") return await bookmarkletScript(context);

    if (request.method === "POST" && route === "access-key/verify") return await verifyAccessKeyRoute(context);
    if (request.method === "POST" && route === "download-ticket/create") return await createDownloadTicket(context);
    if (request.method === "POST" && route === "download-ticket/report") return await reportDownloadTicket(context);

    return apiError(404, "NOT_FOUND", "API route not found", corsHeaders(request));
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_ERROR";
    const message = status >= 500 ? "Service is temporarily unavailable" : error.message;
    return apiError(status, code, message, corsHeaders(request));
  }
}

async function login({ request, env }) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  if (!username || !password) throw httpError(400, "BAD_LOGIN", "请输入管理员账号和密码");

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'")
    .bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw httpError(401, "BAD_LOGIN", "管理员账号或密码不正确");
  }
  if (user.disabled) throw httpError(403, "USER_DISABLED", "管理员账号已禁用");

  const token = randomToken(36);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()).run();
  await env.DB.prepare(
    "INSERT INTO sessions (session_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(await sha256Hex(token), user.id, now.toISOString(), expiresAt.toISOString()).run();

  return json(
    { ok: true, user: publicAdmin(user) },
    200,
    { "set-cookie": sessionCookie(request, token, SESSION_DAYS * 86400) }
  );
}

async function logout({ request, env }) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
}

async function me({ request, env }) {
  const admin = await getCurrentAdmin(request, env);
  if (!admin) return json({ ok: true, authenticated: false });
  return json({ ok: true, authenticated: true, user: publicAdmin(admin) });
}

async function bootstrapStatus({ request, env }) {
  return json({ ok: true, setupRequired: (await adminCount(env)) === 0 }, 200, corsHeaders(request));
}

async function bootstrapAdmin({ request, env }) {
  if ((await adminCount(env)) > 0) throw httpError(409, "SETUP_DONE", "管理员已存在");
  if (!env.ADMIN_SETUP_TOKEN) throw httpError(500, "SETUP_TOKEN_MISSING", "缺少 ADMIN_SETUP_TOKEN 环境变量");

  const body = await readJson(request);
  if (String(body.setupToken || "") !== env.ADMIN_SETUP_TOKEN) {
    throw httpError(403, "BAD_SETUP_TOKEN", "初始化口令不正确");
  }

  const username = normalizeUsername(body.username);
  const password = requirePassword(body.password);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, role, disabled, daily_limit, created_at, updated_at) VALUES (?, ?, 'admin', 0, 0, ?, ?)"
  ).bind(username, await createPasswordHash(password), now, now).run();

  await env.DB.prepare(
    "INSERT INTO quota_events (target_user_id, event_type, new_value, reason, created_at) VALUES (?, 'create_user', 'admin', 'bootstrap admin', ?)"
  ).bind(result.meta.last_row_id, now).run();

  return json({ ok: true });
}

async function verifyAccessKeyRoute({ request, env }) {
  const body = await readJson(request);
  const access = await requireAccessKey(env, body.accessKey);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE access_keys SET last_used_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, access.id).run();
  await env.DB.prepare(
    "INSERT INTO key_usage_events (access_key_id, usage_date, event_type, message, created_at) VALUES (?, ?, 'key_verified', 'key verified', ?)"
  ).bind(access.id, getUsageDate(), now).run();
  return json({ ok: true, accessKey: publicAccessKey(access), quota: await getKeyQuota(env, access) });
}

async function listAccessKeys({ request, env }) {
  await requireAdmin(request, env);
  const usageDate = getUsageDate();
  const rows = await env.DB.prepare(
    `SELECT k.*,
      COALESCE(d.used_count, 0) AS used_count,
      COALESCE(d.extra_count, 0) AS extra_count
     FROM access_keys k
     LEFT JOIN key_daily_usage d ON d.access_key_id = k.id AND d.usage_date = ?
     ORDER BY k.id DESC`
  ).bind(usageDate).all();
  return json({
    ok: true,
    date: usageDate,
    keys: rows.results.map((row) => ({
      ...publicAccessKey(row),
      quota: quotaFromRow(row)
    }))
  });
}

async function createAccessKey({ request, env }) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const name = normalizeKeyName(body.name);
  const note = sanitizeMessage(body.note, 120);
  const dailyLimit = normalizeDailyLimit(body.dailyLimit, 10);
  const secret = `ktp_${randomToken(30)}`;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO access_keys
      (key_hash, key_prefix, key_secret, name, note, disabled, daily_limit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).bind(await sha256Hex(secret), secret.slice(0, 12), secret, name, note, dailyLimit, now, now).run();

  await logKeyQuota(env, admin.id, result.meta.last_row_id, "create_key", null, `daily_limit=${dailyLimit}`, note, now);

  const accessKey = await env.DB.prepare("SELECT * FROM access_keys WHERE id = ?").bind(result.meta.last_row_id).first();
  return json({ ok: true, accessKey: publicAccessKey(accessKey), secret });
}

async function updateAccessKey({ request, env }) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const keyId = Number(body.keyId);
  const action = String(body.action || "");
  if (!Number.isInteger(keyId) || keyId <= 0) throw httpError(400, "BAD_KEY_ID", "密钥 ID 不正确");

  const target = await env.DB.prepare("SELECT * FROM access_keys WHERE id = ?").bind(keyId).first();
  if (!target) throw httpError(404, "KEY_NOT_FOUND", "密钥不存在");

  const now = new Date().toISOString();
  if (action === "delete_key") {
    await deleteAccessKey(env, keyId);
    await logKeyQuota(env, admin.id, keyId, "delete_key", null, target.key_prefix, body.reason, now).catch(() => null);
    return json({ ok: true });
  }

  if (action === "set_daily_limit") {
    const dailyLimit = normalizeDailyLimit(body.value, target.daily_limit);
    await env.DB.prepare("UPDATE access_keys SET daily_limit = ?, updated_at = ? WHERE id = ?")
      .bind(dailyLimit, now, keyId).run();
    await logKeyQuota(env, admin.id, keyId, "set_daily_limit", null, String(dailyLimit), body.reason, now);
    return json({ ok: true });
  }

  if (action === "adjust_today_extra") {
    const delta = Math.max(-9999, Math.min(9999, Math.trunc(Number(body.delta) || 0)));
    const usageDate = getUsageDate();
    await ensureKeyDailyUsage(env, keyId, usageDate, now);
    await env.DB.prepare(
      "UPDATE key_daily_usage SET extra_count = MAX(extra_count + ?, -?), updated_at = ? WHERE access_key_id = ? AND usage_date = ?"
    ).bind(delta, target.daily_limit, now, keyId, usageDate).run();
    await logKeyQuota(env, admin.id, keyId, "adjust_today_extra", delta, null, body.reason, now);
    return json({ ok: true });
  }

  if (action === "set_disabled") {
    const disabled = body.disabled ? 1 : 0;
    await env.DB.prepare("UPDATE access_keys SET disabled = ?, updated_at = ? WHERE id = ?")
      .bind(disabled, now, keyId).run();
    await logKeyQuota(env, admin.id, keyId, "set_disabled", null, String(disabled), body.reason, now);
    return json({ ok: true });
  }

  if (action === "update_key") {
    const name = normalizeKeyName(body.name || target.name);
    const note = sanitizeMessage(body.note, 120);
    await env.DB.prepare("UPDATE access_keys SET name = ?, note = ?, updated_at = ? WHERE id = ?")
      .bind(name, note, now, keyId).run();
    await logKeyQuota(env, admin.id, keyId, "update_key", null, name, note, now);
    return json({ ok: true });
  }

  if (action === "reset_key") {
    const secret = `ktp_${randomToken(30)}`;
    await env.DB.prepare("UPDATE access_keys SET key_hash = ?, key_prefix = ?, key_secret = ?, updated_at = ? WHERE id = ?")
      .bind(await sha256Hex(secret), secret.slice(0, 12), secret, now, keyId).run();
    await logKeyQuota(env, admin.id, keyId, "reset_key", null, secret.slice(0, 12), body.reason, now);
    return json({ ok: true, secret, accessKey: { ...(await getPublicAccessKey(env, keyId)), secret } });
  }

  throw httpError(400, "BAD_ACTION", "不支持的操作");
}

async function listUsage({ request, env }) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const usageDate = url.searchParams.get("date") || getUsageDate();
  const rows = await env.DB.prepare(
    `SELECT e.id, e.ticket_id, e.usage_date, e.event_type, e.message, e.created_at,
      k.name AS keyName, k.key_prefix AS keyPrefix
     FROM key_usage_events e
     JOIN access_keys k ON k.id = e.access_key_id
     WHERE e.usage_date = ?
     ORDER BY e.id DESC
     LIMIT 200`
  ).bind(usageDate).all();
  return json({ ok: true, date: usageDate, events: rows.results });
}

async function createDownloadTicket({ request, env }) {
  const body = await readJson(request);
  const access = await requireAccessKey(env, body.accessKey);
  const parsed = parseKetangpaiUrl(body.targetUrl);
  const usageDate = getUsageDate();
  const now = new Date();
  const nowText = now.toISOString();
  await ensureKeyDailyUsage(env, access.id, usageDate, nowText);

  const update = await env.DB.prepare(
    "UPDATE key_daily_usage SET used_count = used_count + 1, updated_at = ? WHERE access_key_id = ? AND usage_date = ? AND used_count < (? + extra_count)"
  ).bind(nowText, access.id, usageDate, access.daily_limit).run();

  if (!update.meta || update.meta.changes !== 1) {
    const quota = await getKeyQuota(env, access);
    throw httpError(429, "QUOTA_EXHAUSTED", `今日剩余次数不足，当前剩余 ${quota.remaining} 次`);
  }

  const ticketId = randomToken(24);
  const expiresAt = new Date(now.getTime() + TICKET_MINUTES * 60000).toISOString();
  await env.DB.prepare(
    "INSERT INTO key_download_tickets (id, access_key_id, target_hash, usage_date, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'issued', ?, ?)"
  ).bind(ticketId, access.id, await sha256Hex(parsed.normalizedUrl), usageDate, nowText, expiresAt).run();
  await env.DB.prepare("UPDATE access_keys SET last_used_at = ?, updated_at = ? WHERE id = ?")
    .bind(nowText, nowText, access.id).run();
  await env.DB.prepare(
    "INSERT INTO key_usage_events (access_key_id, ticket_id, usage_date, event_type, message, created_at) VALUES (?, ?, ?, 'ticket_created', 'deducted 1', ?)"
  ).bind(access.id, ticketId, usageDate, nowText).run();

  return json({
    ok: true,
    ticket: { id: ticketId, expiresAt, usageDate, contentType: parsed.contentType },
    quota: await getKeyQuota(env, access)
  });
}

async function reportDownloadTicket({ request, env }) {
  const body = await readJson(request);
  const ticketId = String(body.ticketId || "").trim();
  if (!/^[A-Za-z0-9_-]{24,}$/.test(ticketId)) throw httpError(400, "BAD_TICKET", "任务票据不正确");

  const ticket = await env.DB.prepare("SELECT * FROM key_download_tickets WHERE id = ?").bind(ticketId).first();
  if (!ticket) throw httpError(404, "TICKET_NOT_FOUND", "任务票据不存在");

  const now = new Date();
  const nowText = now.toISOString();
  if (ticket.status !== "issued") return json({ ok: true, status: ticket.status }, 200, corsHeaders(request));
  if (Date.parse(ticket.expires_at) <= now.getTime()) {
    await env.DB.prepare("UPDATE key_download_tickets SET status = 'expired', reported_at = ? WHERE id = ?")
      .bind(nowText, ticketId).run();
    throw httpError(410, "TICKET_EXPIRED", "任务票据已过期");
  }

  const success = body.status === "success";
  const status = success ? "reported_success" : "reported_failed";
  const eventType = success ? "report_success" : "report_failed";
  const message = sanitizeMessage(body.message);
  await env.DB.prepare(
    "UPDATE key_download_tickets SET status = ?, reported_at = ?, report_message = ? WHERE id = ? AND status = 'issued'"
  ).bind(status, nowText, message, ticketId).run();
  await env.DB.prepare(
    "INSERT INTO key_usage_events (access_key_id, ticket_id, usage_date, event_type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(ticket.access_key_id, ticketId, ticket.usage_date, eventType, message, nowText).run();

  return json({ ok: true, status }, 200, corsHeaders(request));
}

async function requireAccessKey(env, value) {
  const secret = String(value || "").trim();
  if (!/^ktp_[A-Za-z0-9_-]{20,}$/.test(secret)) throw httpError(401, "BAD_ACCESS_KEY", "密钥格式不正确");
  const access = await env.DB.prepare("SELECT * FROM access_keys WHERE key_hash = ?")
    .bind(await sha256Hex(secret)).first();
  if (!access) throw httpError(401, "BAD_ACCESS_KEY", "密钥不正确");
  if (access.disabled) throw httpError(403, "KEY_DISABLED", "密钥已被禁用");
  return access;
}

async function getCurrentAdmin(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_hash = ? AND s.expires_at > ? AND u.role = 'admin'`
  ).bind(await sha256Hex(token), new Date().toISOString()).first();
}

async function requireAdmin(request, env) {
  const admin = await getCurrentAdmin(request, env);
  if (!admin) throw httpError(401, "ADMIN_REQUIRED", "请先登录管理员后台");
  if (admin.disabled) throw httpError(403, "USER_DISABLED", "管理员账号已禁用");
  return admin;
}

async function getKeyQuota(env, access) {
  const usageDate = getUsageDate();
  const row = await env.DB.prepare(
    "SELECT used_count, extra_count FROM key_daily_usage WHERE access_key_id = ? AND usage_date = ?"
  ).bind(access.id, usageDate).first();
  return quotaFromRow({
    daily_limit: access.daily_limit,
    used_count: row?.used_count || 0,
    extra_count: row?.extra_count || 0,
    usage_date: usageDate
  });
}

async function getPublicAccessKey(env, keyId) {
  const access = await env.DB.prepare("SELECT * FROM access_keys WHERE id = ?").bind(keyId).first();
  return publicAccessKey(access);
}

async function cleanupOldLogs(env) {
  const usageDate = getUsageDate();
  await env.DB.prepare("DELETE FROM key_usage_events WHERE usage_date < ?").bind(usageDate).run();
  await env.DB.prepare("DELETE FROM key_download_tickets WHERE usage_date < ?").bind(usageDate).run();
}
async function deleteAccessKey(env, keyId) {
  await env.DB.prepare("DELETE FROM key_usage_events WHERE access_key_id = ?").bind(keyId).run();
  await env.DB.prepare("DELETE FROM key_quota_events WHERE access_key_id = ?").bind(keyId).run();
  await env.DB.prepare("DELETE FROM key_download_tickets WHERE access_key_id = ?").bind(keyId).run();
  await env.DB.prepare("DELETE FROM key_daily_usage WHERE access_key_id = ?").bind(keyId).run();
  await env.DB.prepare("DELETE FROM access_keys WHERE id = ?").bind(keyId).run();
}

function bookmarkletScript({ request }) {
  const origin = new URL(request.url).origin;
  const source = `
(function(){
  var SITE_ORIGIN=${JSON.stringify(origin)};
  function done(message){ alert(message); }
  function getKey(){
    try {
      var hash = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src).hash : "";
      var params = new URLSearchParams((hash || "").replace(/^#/, ""));
      return params.get("key") || "";
    } catch (e) { return ""; }
  }
  function parseTarget(){
    var url = new URL(location.href);
    var id = url.searchParams.get("id");
    var courseId = url.searchParams.get("courseId") || url.searchParams.get("courseid");
    var contentType = url.searchParams.get("type") || "2";
    if (!id || !courseId) throw new Error("当前页面不是完整的课堂派资料详情链接");
    return { id: id, courseId: courseId, contentType: contentType, href: url.href };
  }
  function token(){
    try { return localStorage.getItem("token") || localStorage.getItem("ktp_token") || ""; } catch (e) { return ""; }
  }
  function clean(name){
    return String(name || "ketangpai-courseware").replace(/[<>:"/\\|?*\\x00-\\x1f]/g, "_").replace(/\\s+/g, " ").trim().slice(0, 120) || "ketangpai-courseware";
  }
  function collect(data){
    var raw = Array.isArray(data.attachment) ? data.attachment : [];
    return raw.map(function(item){ return { name: clean(item.name || item.filename || data.title || "ketangpai-courseware"), url: item.down_url || item.downurl || item.url || item.playurl || item.rurl }; }).filter(function(item){ return item.url; });
  }
  async function api(path, body){
    var res = await fetch(SITE_ORIGIN + "/api/" + path, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body || {}) });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok || data.ok === false) throw new Error(data.message || "网站接口请求失败");
    return data;
  }
  async function main(){
    var accessKey = getKey();
    if (!accessKey) throw new Error("书签缺少使用密钥，请回网站重新安装书签");
    var target = parseTarget();
    var ktpToken = token();
    if (!ktpToken) throw new Error("当前课堂派页面没有找到登录 token，请先登录课堂派");
    var ticket = await api("download-ticket/create", { accessKey: accessKey, targetUrl: target.href });
    try {
      var res = await fetch("https://openapiv5.ketangpai.com/FutureV2/Courseware/query", { method:"POST", headers:{"content-type":"application/json", token: ktpToken}, body: JSON.stringify({ id: target.id, courseid: target.courseId, contenttype: target.contentType, reqtimestamp: Date.now() }) });
      var payload = await res.json();
      if (payload.status !== 1 || !payload.data) throw new Error(payload.message || "课堂派接口没有返回资料");
      var files = collect(payload.data);
      if (!files.length) throw new Error("没有找到可下载附件");
      for (var i = 0; i < files.length; i += 1) {
        var a = document.createElement("a");
        a.href = files[i].url;
        a.download = files[i].name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise(function(resolve){ setTimeout(resolve, 700); });
      }
      await api("download-ticket/report", { ticketId: ticket.ticket.id, status:"success", message:"started " + files.length + " download(s)" });
      done("已触发 " + files.length + " 个下载，今日剩余 " + ticket.quota.remaining + " 次");
    } catch (err) {
      await api("download-ticket/report", { ticketId: ticket.ticket.id, status:"failed", message: err.message }).catch(function(){});
      throw err;
    }
  }
  main().catch(function(err){ done(err.message || String(err)); });
})();`;
  return new Response(source, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
}

function publicAdmin(user) {
  return { id: user.id, username: user.username, role: user.role, disabled: Boolean(user.disabled) };
}

function publicAccessKey(access) {
  return {
    id: access.id,
    name: access.name,
    note: access.note || "",
    keyPrefix: access.key_prefix,
    secret: access.key_secret || "",
    disabled: Boolean(access.disabled),
    dailyLimit: Number(access.daily_limit),
    createdAt: access.created_at,
    updatedAt: access.updated_at,
    lastUsedAt: access.last_used_at || null
  };
}

function quotaFromRow(row) {
  const dailyLimit = normalizeDailyLimit(row.daily_limit, 10);
  const usedCount = Number(row.used_count) || 0;
  const extraCount = Number(row.extra_count) || 0;
  return { date: row.usage_date || getUsageDate(), dailyLimit, usedCount, extraCount, remaining: calculateRemaining({ dailyLimit, usedCount, extraCount }) };
}

async function ensureKeyDailyUsage(env, keyId, usageDate, now) {
  await env.DB.prepare(
    "INSERT INTO key_daily_usage (access_key_id, usage_date, used_count, extra_count, updated_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT(access_key_id, usage_date) DO NOTHING"
  ).bind(keyId, usageDate, now).run();
}

async function adminCount(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first();
  return Number(row?.count) || 0;
}

async function logKeyQuota(env, actorUserId, keyId, eventType, delta, newValue, reason, now) {
  await env.DB.prepare(
    "INSERT INTO key_quota_events (actor_user_id, access_key_id, event_type, delta, new_value, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(actorUserId, keyId, eventType, delta, newValue, sanitizeMessage(reason), now).run();
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_@.-]{3,40}$/.test(username)) throw httpError(400, "BAD_USERNAME", "账号需为 3-40 位，可用字母、数字、下划线、点、横线或 @");
  return username;
}

function normalizeKeyName(value) {
  const name = String(value || "").trim();
  if (name.length < 1 || name.length > 60) throw httpError(400, "BAD_KEY_NAME", "密钥名称需为 1-60 位");
  return name;
}

function requirePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) throw httpError(400, "BAD_PASSWORD", "密码长度需为 8-128 位");
  return password;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const found = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}

function sessionCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}





