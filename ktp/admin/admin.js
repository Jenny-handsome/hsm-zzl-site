(function () {
  const isLocalPreview = location.protocol === "file:";
  const state = { user: null, newSecret: "" };
  const $ = (id) => document.getElementById(id);
  const nodes = {
    setupPanel: $("setupPanel"), setupForm: $("setupForm"), setupToken: $("setupToken"), setupUsername: $("setupUsername"), setupPassword: $("setupPassword"), setupStatus: $("setupStatus"),
    loginPanel: $("loginPanel"), loginForm: $("loginForm"), loginUsername: $("loginUsername"), loginPassword: $("loginPassword"), loginStatus: $("loginStatus"), localHint: $("localHint"),
    adminPanel: $("adminPanel"), adminName: $("adminName"), logoutButton: $("logoutButton"),
    createKeyForm: $("createKeyForm"), keyNameInput: $("keyNameInput"), keyDailyLimit: $("keyDailyLimit"), keyNote: $("keyNote"), createStatus: $("createStatus"), newKeyBox: $("newKeyBox"), newKeySecret: $("newKeySecret"), copyNewKey: $("copyNewKey"),
    refreshKeys: $("refreshKeys"), keysBody: $("keysBody"), keysStatus: $("keysStatus"), refreshUsage: $("refreshUsage"), usageBody: $("usageBody"), usageStatus: $("usageStatus")
  };

  async function api(path, options = {}) {
    if (window.KTP_LOCAL_API) return window.KTP_LOCAL_API.request(path, options);
    const response = await fetch(`/api/${path}`, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.code ? `${data.message || "请求失败"}（${data.code}）` : (data.message || "请求失败"));
    return data;
  }

  function setStatus(node, message, type) {
    node.textContent = message || "";
    node.classList.toggle("error", type === "error");
    node.classList.toggle("ok", type === "ok");
  }

  function render() {
    const isAdmin = state.user?.role === "admin";
    nodes.adminPanel.classList.toggle("hidden", !isAdmin);
    nodes.loginPanel.classList.toggle("hidden", Boolean(state.user));
    nodes.localHint.classList.toggle("hidden", !isLocalPreview);
    if (isAdmin) nodes.adminName.textContent = `${state.user.username} · 管理员${isLocalPreview ? " · 本地预览" : ""}`;
  }

  async function init() {
    const setup = await api("admin/bootstrap", { method: "GET" });
    nodes.setupPanel.classList.toggle("hidden", !setup.setupRequired || isLocalPreview);
    if (setup.setupRequired && !isLocalPreview) { nodes.loginPanel.classList.add("hidden"); return; }
    const me = await api("auth/me", { method: "GET" });
    state.user = me.authenticated ? me.user : null;
    render();
    if (state.user?.role === "admin") await Promise.all([loadKeys(), loadUsage()]);
  }

  nodes.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(nodes.setupStatus, "正在创建管理员...");
    try {
      await api("admin/bootstrap", { method: "POST", body: { setupToken: nodes.setupToken.value, username: nodes.setupUsername.value, password: nodes.setupPassword.value } });
      setStatus(nodes.setupStatus, "管理员已创建，请登录", "ok");
      nodes.setupPanel.classList.add("hidden");
      nodes.loginPanel.classList.remove("hidden");
    } catch (error) { setStatus(nodes.setupStatus, error.message, "error"); }
  });

  nodes.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(nodes.loginStatus, "正在登录...");
    try {
      const data = await api("auth/login", { method: "POST", body: { username: nodes.loginUsername.value, password: nodes.loginPassword.value } });
      if (data.user.role !== "admin") throw new Error("该账号不是管理员");
      state.user = data.user;
      nodes.loginPassword.value = "";
      setStatus(nodes.loginStatus, "");
      render();
      await Promise.all([loadKeys(), loadUsage()]);
    } catch (error) { setStatus(nodes.loginStatus, error.message, "error"); }
  });

  nodes.logoutButton.addEventListener("click", async () => { await api("auth/logout", { method: "POST" }).catch(() => null); state.user = null; render(); });

  nodes.createKeyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    nodes.newKeyBox.classList.add("hidden");
    setStatus(nodes.createStatus, "正在生成...");
    try {
      const data = await api("admin/access-keys", { method: "POST", body: { name: nodes.keyNameInput.value, dailyLimit: Number(nodes.keyDailyLimit.value), note: nodes.keyNote.value } });
      state.newSecret = data.secret;
      nodes.newKeySecret.textContent = data.secret;
      nodes.newKeyBox.classList.remove("hidden");
      setStatus(nodes.createStatus, "密钥已生成，可在列表中继续复制", "ok");
      await loadKeys();
    } catch (error) { setStatus(nodes.createStatus, error.message, "error"); }
  });

  nodes.copyNewKey.addEventListener("click", async () => { if (!state.newSecret) return; await copyText(state.newSecret); setStatus(nodes.createStatus, "密钥已复制", "ok"); });

  async function loadKeys() {
    setStatus(nodes.keysStatus, "正在加载...");
    try {
      const data = await api("admin/access-keys", { method: "GET" });
      nodes.keysBody.innerHTML = data.keys.map(renderKeyRow).join("");
      setStatus(nodes.keysStatus, `已加载 ${data.keys.length} 个密钥`, "ok");
    } catch (error) { setStatus(nodes.keysStatus, error.message, "error"); }
  }

  function renderKeyRow(key) {
    const status = key.disabled ? '<span class="badge danger">禁用</span>' : '<span class="badge ok">启用</span>';
    const secret = key.secret || key.keySecret || "";
    return `
      <tr data-key-id="${escapeHtml(key.id)}" data-disabled="${key.disabled}" data-secret="${escapeHtml(secret)}">
        <td><strong>${escapeHtml(key.name)}</strong><br><span class="muted">${escapeHtml(key.note || "")}</span></td>
        <td><div class="code">${escapeHtml(secret || key.keyPrefix || "")}</div><button data-action="copy_key" type="button">复制密钥</button></td>
        <td>${status}</td>
        <td>剩余 ${key.quota.remaining} / 已用 ${key.quota.usedCount}</td>
        <td><form class="small-form" data-action="set_daily_limit"><input name="value" type="number" min="0" max="9999" value="${key.quota.dailyLimit}"><button type="submit">保存</button></form></td>
        <td><form class="small-form" data-action="adjust_today_extra"><input name="delta" type="number" value="1"><button type="submit">调整</button></form><span class="muted">当前 ${key.quota.extraCount}</span></td>
        <td><div class="actions"><button data-action="toggle_disabled" type="button">${key.disabled ? "启用" : "禁用"}</button><button data-action="reset_key" type="button">重置</button><button class="danger" data-action="delete_key" type="button">删除</button></div></td>
      </tr>`;
  }

  nodes.keysBody.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const row = event.target.closest("tr");
    if (!form || !row) return;
    const body = { keyId: row.dataset.keyId, action: form.dataset.action };
    if (body.action === "set_daily_limit") body.value = Number(form.elements.value.value);
    if (body.action === "adjust_today_extra") body.delta = Number(form.elements.delta.value);
    await runKeyAction(body);
  });

  nodes.keysBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    const row = event.target.closest("tr");
    if (!button || !row) return;
    const action = button.dataset.action;
    if (action === "copy_key") { await copyText(row.dataset.secret || ""); setStatus(nodes.keysStatus, "密钥已复制", "ok"); }
    if (action === "toggle_disabled") await runKeyAction({ keyId: row.dataset.keyId, action: "set_disabled", disabled: row.dataset.disabled !== "true" });
    if (action === "reset_key") {
      if (!confirm("重置后旧密钥会失效，继续吗？")) return;
      const data = await runKeyAction({ keyId: row.dataset.keyId, action: "reset_key" }, true);
      if (data?.secret) { state.newSecret = data.secret; nodes.newKeySecret.textContent = data.secret; nodes.newKeyBox.classList.remove("hidden"); setStatus(nodes.createStatus, "新密钥已生成，可在列表中继续复制", "ok"); }
    }
    if (action === "delete_key") {
      if (!confirm("确定删除这个密钥吗？删除后该密钥不能再使用。")) return;
      await runKeyAction({ keyId: row.dataset.keyId, action: "delete_key" });
      await loadUsage();
    }
  });

  async function runKeyAction(body, returnData) {
    setStatus(nodes.keysStatus, "正在保存...");
    try {
      const data = await api("admin/access-keys/update", { method: "POST", body });
      setStatus(nodes.keysStatus, "已保存", "ok");
      await loadKeys();
      return returnData ? data : null;
    } catch (error) { setStatus(nodes.keysStatus, error.message, "error"); return null; }
  }

  async function loadUsage() {
    setStatus(nodes.usageStatus, "正在加载...");
    try {
      const data = await api("admin/usage", { method: "GET" });
      nodes.usageBody.innerHTML = data.events.map((event) => `<tr><td>${new Date(event.created_at || event.createdAt).toLocaleString()}</td><td>${escapeHtml(event.keyName || event.keyPrefix || "")}</td><td>${escapeHtml(event.event_type || event.eventType)}</td><td>${escapeHtml(event.message || "")}</td></tr>`).join("");
      setStatus(nodes.usageStatus, `已加载 ${data.events.length} 条记录`, "ok");
    } catch (error) { setStatus(nodes.usageStatus, error.message, "error"); }
  }

  async function copyText(text) {
    if (!text) throw new Error("没有可复制的密钥");
    await navigator.clipboard.writeText(text);
  }

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }

  nodes.refreshKeys.addEventListener("click", loadKeys);
  nodes.refreshUsage.addEventListener("click", loadUsage);
  init().catch((error) => { nodes.loginPanel.classList.remove("hidden"); setStatus(nodes.loginStatus, error.message, "error"); });
})();

