(function () {
  const isLocalPreview = location.protocol === "file:";
  const state = { accessKey: "", key: null, quota: null };
  const $ = (id) => document.getElementById(id);
  const nodes = {
    localHint: $("localHint"), keyPanel: $("keyPanel"), accessKey: $("accessKey"), keyStatus: $("keyStatus"),
    accountPanel: $("accountPanel"), keyName: $("keyName"), quotaRemaining: $("quotaRemaining"), quotaUsed: $("quotaUsed"), quotaLimit: $("quotaLimit"), clearKeyButton: $("clearKeyButton"),
    toolPanel: $("toolPanel"), downloadButton: $("downloadButton"), openHelperLink: $("openHelperLink"), downloadStatus: $("downloadStatus")
  };

  async function api(path, options = {}) {
    if (window.KTP_LOCAL_API) return window.KTP_LOCAL_API.request(path, options);
    let response;
    try {
      response = await fetch(`/api/${path}`, {
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...(options.headers || {}) },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch {
      throw new Error("网站接口连接失败，请确认 Cloudflare 部署已完成");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || "请求失败");
    return data;
  }

  function setStatus(node, message, type) {
    node.textContent = message || "";
    node.classList.toggle("error", type === "error");
    node.classList.toggle("ok", type === "ok");
  }

  function render() {
    const verified = Boolean(state.key);
    nodes.keyPanel.classList.toggle("hidden", verified);
    nodes.accountPanel.classList.toggle("hidden", !verified);
    nodes.toolPanel.classList.toggle("hidden", !verified);
    nodes.localHint.classList.toggle("hidden", !isLocalPreview);
    if (!verified) return;
    nodes.keyName.textContent = `${state.key.name} · ${state.key.keyPrefix || "密钥"}`;
    nodes.quotaRemaining.textContent = state.quota?.remaining ?? 0;
    nodes.quotaUsed.textContent = state.quota?.usedCount ?? 0;
    nodes.quotaLimit.textContent = state.quota?.dailyLimit ?? 5;
  }

  nodes.keyPanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(nodes.keyStatus, "正在验证密钥...");
    try {
      state.accessKey = nodes.accessKey.value.trim();
      const data = await api("access-key/verify", { method: "POST", body: { accessKey: state.accessKey } });
      state.key = data.accessKey;
      state.quota = data.quota;
      nodes.openHelperLink.classList.add("hidden");
      nodes.openHelperLink.removeAttribute("href");
      setStatus(nodes.keyStatus, "");
      render();
    } catch (error) {
      setStatus(nodes.keyStatus, error.message, "error");
    }
  });

  nodes.clearKeyButton.addEventListener("click", () => {
    state.accessKey = "";
    state.key = null;
    state.quota = null;
    nodes.accessKey.value = "";
    setStatus(nodes.downloadStatus, "");
    nodes.openHelperLink.classList.add("hidden");
    nodes.openHelperLink.removeAttribute("href");
    render();
  });

  nodes.downloadButton.addEventListener("click", async () => {
    if (isLocalPreview) {
      setStatus(nodes.downloadStatus, "本地预览已模拟扣次；部署到网站后会打开本地下载助手。", "ok");
      nodes.openHelperLink.classList.add("hidden");
      try {
        const data = await api("local-download/start", { method: "POST", body: { accessKey: state.accessKey } });
        state.quota = data.quota;
        render();
      } catch (error) {
        setStatus(nodes.downloadStatus, error.message, "error");
      }
      return;
    }

    nodes.downloadButton.disabled = true;
    nodes.openHelperLink.classList.add("hidden");
    nodes.openHelperLink.removeAttribute("href");
    setStatus(nodes.downloadStatus, "正在扣次数并打开本地助手...");
    try {
      const data = await api("local-download/start", { method: "POST", body: { accessKey: state.accessKey } });
      state.quota = data.quota;
      render();
      nodes.openHelperLink.href = data.launchUrl;
      nodes.openHelperLink.classList.remove("hidden");
      window.location.href = data.launchUrl;
      setStatus(nodes.downloadStatus, "已扣 1 次。如果没有弹出本地窗口，请点击“打开本地助手”。", "ok");
    } catch (error) {
      nodes.openHelperLink.classList.add("hidden");
      nodes.openHelperLink.removeAttribute("href");
      setStatus(nodes.downloadStatus, error.message, "error");
    } finally {
      nodes.downloadButton.disabled = false;
    }
  });

  render();
})();

