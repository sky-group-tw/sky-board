// 資料模型：一個「完整活動」在後台長這樣（含 private），存進 Firestore 時拆成兩份
//   events/{id}          公開欄位（任何人可讀）
//   events_private/{id}  限定報名連結、Zoom、待確認事項、原始公告（只有管理者）
// 圖片另外存在 images/{imageId}，活動只記 { id, caption, ratio }

export const ADMIN_UID = "9yMRUwUT7lMgz4T7kyYZKVHxKEy2";
export const TZ = 8; // 台北時間，沒有日光節約
export const WD = ["日", "一", "二", "三", "四", "五", "六"];
export const CATEGORIES = ["全教會", "同工", "小組"];

// ---------- 日期工具（一律用台北時間） ----------
export function parts(s) { const p = s.split("-").map(Number); return { y: p[0], m: p[1], d: p[2] }; }
export function epoch(date, time, add) {
  const p = parts(date), t = (time || "00:00").split(":").map(Number);
  return Date.UTC(p.y, p.m - 1, p.d + (add || 0), t[0] - TZ, t[1]);
}
export function startMs(e) { return epoch(e.date, e.start || "00:00"); }
export function endMs(e) {
  if (e.kind === "series" || e.kind === "notice") return epoch(e.until || e.date, "23:59");
  const start = e.start || "00:00", end = e.end || "23:59";
  return epoch(e.date, end, end <= start ? 1 : 0);
}
export function weekday(s) { const p = parts(s); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
export function todayTPE() { const n = new Date(Date.now() + TZ * 3600e3); return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() }; }
export function ymd(o) { return o.y + "-" + String(o.m).padStart(2, "0") + "-" + String(o.d).padStart(2, "0"); }
export function addDays(s, n) { const p = parts(s); const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return ymd({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }); }
export function daysUntil(s) { const t = todayTPE(), p = parts(s); return Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(t.y, t.m - 1, t.d)) / 864e5); }
export function md(s) { const p = parts(s); return p.m + "/" + p.d; }
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 用來查詢「最近還沒過期」的活動
export function endDateOf(e) { return e.kind === "series" || e.kind === "notice" ? (e.until || e.date) : e.date; }

// ---------- 拆成公開／私密 ----------
const PUBLIC_FIELDS = [
  "kind", "title", "category", "audience", "date", "until", "weekday", "start", "end", "endUnknown", "allDay",
  "repeatText", "checkin", "location", "address", "mapUrl", "desc", "tips", "dressCode", "restrictedText",
  "noSignupText", "deadline", "status", "note", "images", "calLabel"
];

export function toPublic(full) {
  const out = {};
  PUBLIC_FIELDS.forEach(k => { if (full[k] !== undefined && full[k] !== null && full[k] !== "") out[k] = full[k]; });
  const s = full.signup || {};
  const isPublic = s.public !== false;
  out.signup = { label: s.label || "", public: isPublic, url: isPublic ? (s.url || "") : "" };
  out.endDate = endDateOf(full);
  out.images = (full.images || []).map(im => ({ id: im.id, caption: im.caption || "", ratio: im.ratio || "" }));
  out.tips = (full.tips || []).filter(Boolean);
  if (!out.deadline || !out.deadline.date) out.deadline = null;
  return out;
}

export function toPrivate(full) {
  const s = full.signup || {}, p = full.private || {};
  return {
    signupUrl: s.public === false ? (s.url || "") : "",
    zoom: p.zoom || "",
    flags: (p.flags || []).filter(Boolean),
    announcement: p.announcement || ""
  };
}

export function merge(id, pub, priv) {
  const e = Object.assign({ id }, pub);
  priv = priv || {};
  e.signup = Object.assign({ url: "", label: "", public: true }, pub.signup || {});
  if (!e.signup.url && priv.signupUrl) e.signup.url = priv.signupUrl;
  e.private = { zoom: priv.zoom || "", flags: priv.flags || [], announcement: priv.announcement || "" };
  e.images = e.images || [];
  e.tips = e.tips || [];
  return e;
}

export function newId(kind, date) {
  const r = Math.random().toString(36).slice(2, 6);
  const prefix = kind === "meeting" ? "sky" : kind === "series" ? "series" : kind === "notice" ? "note" : "ev";
  return prefix + "-" + (date || "").replace(/-/g, "") + "-" + r;
}
export function newImageId() { return "img-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }

// 本週／下週（週一到週日算一週，台北時間）
export function weekLabel(date) {
  const t = ymd(todayTPE());
  const monday = addDays(t, -((weekday(t) + 6) % 7));
  const n = Math.floor((Date.UTC(...ymdArr(date)) - Date.UTC(...ymdArr(monday))) / 864e5);
  if (n >= 0 && n < 7) return "本週";
  if (n >= 7 && n < 14) return "下週";
  return "";
}
function ymdArr(s) { const p = parts(s); return [p.y, p.m - 1, p.d]; }

// 月曆格子上顯示的字：後台有填就用填的，沒填照預設
export function calLabel(e) {
  if (e.calLabel) return e.calLabel;
  if (e.kind === "meeting") return "小組" + (e.status === "tbd" ? "（待定）" : "");
  if (e.kind === "series") return "系列講道";
  return e.title;
}

// 站外分享（LINE 內建瀏覽器改開外部瀏覽器）
export function shareUrl() {
  const u = new URL(location.href);
  u.hash = ""; u.search = "?openExternalBrowser=1";
  return u.href;
}
