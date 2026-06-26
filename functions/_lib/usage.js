export const DEFAULT_DAILY_LIMIT = 10;
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export function getUsageDate(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function normalizeDailyLimit(value, fallback = DEFAULT_DAILY_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(9999, Math.floor(numeric)));
}

export function calculateRemaining({ dailyLimit, extraCount = 0, usedCount = 0 }) {
  const total = Math.max(0, Number(dailyLimit) || 0) + (Number(extraCount) || 0);
  const used = Math.max(0, Number(usedCount) || 0);
  return Math.max(0, total - used);
}

export function sanitizeMessage(value, maxLength = 240) {
  return String(value || "")
    .replace(/token\s*[:=]\s*[\w.-]+/gi, "token=[hidden]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function parseKetangpaiUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("请输入有效的课堂派资料链接");
  }

  if (url.protocol !== "https:" || url.hostname !== "w.ketangpai.com") {
    throw new Error("只支持 https://w.ketangpai.com 的课堂派资料链接");
  }

  const id = url.searchParams.get("id");
  const courseId = url.searchParams.get("courseId") || url.searchParams.get("courseid");
  if (!id || !courseId) {
    throw new Error("课堂派链接缺少 id 或 courseId");
  }

  return {
    normalizedUrl: url.toString(),
    id,
    courseId,
    contentType: url.searchParams.get("type") || "2"
  };
}
