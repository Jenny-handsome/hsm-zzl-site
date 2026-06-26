(function () {
  const isLocalPreview = location.protocol === "file:";
  const state = { accessKey: "", key: null, quota: null };
  const $ = (id) => document.getElementById(id);
  const nodes = {
    localHint: $("localHint"), keyPanel: $("keyPanel"), accessKey: $("accessKey"), keyStatus: $("keyStatus"),
    accountPanel: $("accountPanel"), keyName: $("keyName"), quotaRemaining: $("quotaRemaining"), quotaUsed: $("quotaUsed"), quotaLimit: $("quotaLimit"), clearKeyButton: $("clearKeyButton"),
    toolPanel: $("toolPanel"), bookmarkletLink: $("bookmarkletLink"), copyBookmarklet: $("copyBookmarklet"), bookmarkStatus: $("bookmarkStatus")
  };

  async function api(path, options = {}) {
    if (window.KTP_LOCAL_API) return window.KTP_LOCAL_API.request(path, options);
    const response = await fetch(`/api/${path}`, {
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
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
    nodes.bookmarkletLink.href = buildBookmarklet(state.accessKey);
  }

  function buildBookmarklet(accessKey) {
    if (isLocalPreview) return "#";
    const scriptUrl = `${location.origin}/api/bookmarklet/script?v=`;
    const loader = `(function(){var s=document.createElement('script');s.src='${scriptUrl}'+Date.now()+'#key='+encodeURIComponent('${accessKey}');document.documentElement.appendChild(s);})();`;
    return `javascript:${encodeURIComponent(loader)}`;
  }

  nodes.keyPanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(nodes.keyStatus, "正在验证密钥...");
    try {
      state.accessKey = nodes.accessKey.value.trim();
      const data = await api("access-key/verify", { method: "POST", body: { accessKey: state.accessKey } });
      state.key = data.accessKey;
      state.quota = data.quota;
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
    setStatus(nodes.bookmarkStatus, "");
    render();
  });

  nodes.bookmarkletLink.addEventListener("click", (event) => {
    if (isLocalPreview) {
      event.preventDefault();
      setStatus(nodes.bookmarkStatus, "本地预览不能安装真实书签，请部署到网站后再安装。", "error");
      return;
    }
    setStatus(nodes.bookmarkStatus, "请把按钮拖到书签栏；直接点击不会在课堂派页面运行。", "ok");
  });

  nodes.copyBookmarklet.addEventListener("click", async () => {
    if (isLocalPreview) {
      setStatus(nodes.bookmarkStatus, "本地预览不能生成可用书签地址。", "error");
      return;
    }
    await navigator.clipboard.writeText(nodes.bookmarkletLink.href);
    setStatus(nodes.bookmarkStatus, "书签地址已复制。", "ok");
  });

  render();
})();
