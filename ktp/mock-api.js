(function () {
  if (location.protocol !== "file:") return;

  const STORE_KEY = "ktp-local-preview-v3";
  const ADMIN_USERNAME = "admin";
  const ADMIN_PASSWORD = "13398362170";

  function today() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const text = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${prefix}_${text}`;
  }

  function load() {
    const fallback = { adminSession: false, keys: [], tickets: [], events: [] };
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return fallback; }
  }

  function save(data) { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }

  function quotaFor(key) {
    const date = today();
    const usage = key.usage?.[date] || { usedCount: 0, extraCount: 0 };
    const dailyLimit = Number(key.dailyLimit) || 0;
    const usedCount = Number(usage.usedCount) || 0;
    const extraCount = Number(usage.extraCount) || 0;
    return { date, dailyLimit, usedCount, extraCount, remaining: Math.max(0, dailyLimit + extraCount - usedCount) };
  }

  function publicKey(key) {
    return {
      id: key.id,
      name: key.name,
      note: key.note || "",
      keyPrefix: key.secret.slice(0, 12),
      secret: key.secret,
      disabled: Boolean(key.disabled),
      dailyLimit: Number(key.dailyLimit) || 5,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      lastUsedAt: key.lastUsedAt || null,
      quota: quotaFor(key)
    };
  }

  function findKey(data, secret) { return data.keys.find((key) => key.secret === String(secret || "").trim()); }
  function requireAdmin(data) { if (!data.adminSession) throw new Error("请先登录管理员后台"); }
  function requireKey(data, secret) {
    const key = findKey(data, secret);
    if (!key) throw new Error("密钥不正确");
    if (key.disabled) throw new Error("密钥已被禁用");
    return key;
  }

  window.KTP_LOCAL_API = {
    async request(path, options = {}) {
      const data = load();
      const body = options.body || {};
      const now = new Date().toISOString();

      if (path === "auth/login") {
        if (body.username === ADMIN_USERNAME && body.password === ADMIN_PASSWORD) {
          data.adminSession = true; save(data);
          return { ok: true, user: { id: 1, username: ADMIN_USERNAME, role: "admin", disabled: false } };
        }
        throw new Error("管理员账号或密码不正确");
      }
      if (path === "auth/logout") { data.adminSession = false; save(data); return { ok: true }; }
      if (path === "auth/me") return data.adminSession ? { ok: true, authenticated: true, user: { id: 1, username: ADMIN_USERNAME, role: "admin", disabled: false } } : { ok: true, authenticated: false };
      if (path === "admin/bootstrap") return { ok: true, setupRequired: false, localPreview: true };

      if (path === "access-key/verify") {
        const key = requireKey(data, body.accessKey);
        key.lastUsedAt = now;
        data.events.unshift({ id: randomId("event"), keyName: key.name, eventType: "key_verified", message: "本地预览验证密钥", createdAt: now });
        save(data);
        return { ok: true, accessKey: publicKey(key), quota: quotaFor(key) };
      }

      if (path === "admin/access-keys") {
        requireAdmin(data);
        if ((options.method || "GET") === "GET") return { ok: true, keys: data.keys.map((key) => publicKey(key)) };
        const secret = randomId("ktp");
        const key = { id: randomId("key"), secret, name: String(body.name || "未命名密钥").trim(), note: String(body.note || "").trim(), disabled: false, dailyLimit: Math.max(0, Number(body.dailyLimit) || 5), createdAt: now, updatedAt: now, usage: {} };
        data.keys.unshift(key); save(data);
        return { ok: true, accessKey: publicKey(key), secret };
      }

      if (path === "admin/access-keys/update") {
        requireAdmin(data);
        const index = data.keys.findIndex((item) => item.id === body.keyId);
        if (index < 0) throw new Error("密钥不存在");
        const key = data.keys[index];
        if (body.action === "delete_key") { data.keys.splice(index, 1); save(data); return { ok: true }; }
        if (body.action === "set_daily_limit") key.dailyLimit = Math.max(0, Number(body.value) || 0);
        if (body.action === "adjust_today_extra") {
          const date = today(); key.usage ||= {}; key.usage[date] ||= { usedCount: 0, extraCount: 0 }; key.usage[date].extraCount += Number(body.delta) || 0;
        }
        if (body.action === "set_disabled") key.disabled = Boolean(body.disabled);
        if (body.action === "update_key") { key.name = String(body.name || key.name).trim(); key.note = String(body.note || "").trim(); }
        if (body.action === "reset_key") key.secret = randomId("ktp");
        key.updatedAt = now; save(data);
        return { ok: true, accessKey: publicKey(key), secret: body.action === "reset_key" ? key.secret : undefined };
      }

      if (path === "admin/usage") { requireAdmin(data); return { ok: true, events: data.events.slice(0, 200) }; }

      if (path === "download-ticket/create") {
        const key = requireKey(data, body.accessKey);
        const date = today(); key.usage ||= {}; key.usage[date] ||= { usedCount: 0, extraCount: 0 };
        if (quotaFor(key).remaining <= 0) throw new Error("今日剩余次数不足");
        key.usage[date].usedCount += 1; key.lastUsedAt = now;
        const ticket = { id: randomId("ticket"), keyId: key.id, status: "issued", createdAt: now };
        data.tickets.unshift(ticket);
        data.events.unshift({ id: randomId("event"), keyName: key.name, ticketId: ticket.id, eventType: "ticket_created", message: "本地预览扣除 1 次", createdAt: now });
        save(data);
        return { ok: true, ticket: { id: ticket.id, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() }, quota: quotaFor(key) };
      }

      if (path === "download-ticket/report") {
        const ticket = data.tickets.find((item) => item.id === body.ticketId);
        if (!ticket) throw new Error("任务票据不存在");
        if (ticket.status === "issued") ticket.status = body.status === "success" ? "reported_success" : "reported_failed";
        const key = data.keys.find((item) => item.id === ticket.keyId);
        data.events.unshift({ id: randomId("event"), keyName: key?.name || "未知密钥", ticketId: ticket.id, eventType: body.status === "success" ? "report_success" : "report_failed", message: String(body.message || "").slice(0, 200), createdAt: now });
        save(data);
        return { ok: true, status: ticket.status };
      }

      throw new Error(`本地预览未实现接口：${path}`);
    }
  };
})();
