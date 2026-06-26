(function () {
  const SITE_ORIGIN = new URL(document.currentScript.src).origin;
  const API = `${SITE_ORIGIN}/api/download-ticket/report`;
  const KTP_API = "https://openapiv5.ketangpai.com/FutureV2/Courseware/query";

  function getToken() {
    try {
      return localStorage.getItem("token") || localStorage.getItem("ktp_token") || "";
    } catch {
      return "";
    }
  }

  function parseTargetUrl() {
    const url = new URL(location.href);
    const id = url.searchParams.get("id");
    const courseId = url.searchParams.get("courseId") || url.searchParams.get("courseid");
    const contentType = url.searchParams.get("type") || "2";
    if (!id || !courseId) throw new Error("当前页面不是完整的课堂派资料详情链接");
    return { id, courseId, contentType };
  }

  function sanitizeName(name) {
    return String(name || "ketangpai-courseware")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "ketangpai-courseware";
  }

  function collectAttachments(data) {
    const list = Array.isArray(data.attachment) ? data.attachment : [];
    return list.map((item) => ({
      name: sanitizeName(item.name || item.filename || data.title || "ketangpai-courseware"),
      url: item.down_url || item.downurl || item.url || item.playurl || item.rurl
    })).filter((item) => item.url);
  }

  async function report(ticketId, status, message) {
    try {
      await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId, status, message: String(message || "").slice(0, 200) })
      });
    } catch {
      // 本地下载不因上报失败中断。
    }
  }

  async function main() {
    const ticketId = prompt("请输入你的网站下载票据");
    if (!ticketId) return;

    try {
      const token = getToken();
      if (!token) throw new Error("没有在课堂派页面找到登录 token，请确认当前浏览器已登录课堂派");
      const target = parseTargetUrl();
      const response = await fetch(KTP_API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          token
        },
        body: JSON.stringify({
          id: target.id,
          courseid: target.courseId,
          contenttype: target.contentType,
          reqtimestamp: Date.now()
        })
      });

      const payload = await response.json();
      if (payload.status !== 1 || !payload.data) {
        throw new Error(payload.message || "课堂派接口没有返回资料");
      }

      const attachments = collectAttachments(payload.data);
      if (!attachments.length) throw new Error("没有找到可下载附件");

      for (const attachment of attachments) {
        const link = document.createElement("a");
        link.href = attachment.url;
        link.download = attachment.name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      await report(ticketId, "success", `started ${attachments.length} download(s)`);
      alert(`已触发 ${attachments.length} 个本地下载。`);
    } catch (error) {
      await report(ticketId, "failed", error.message);
      alert(error.message);
    }
  }

  main();
})();
