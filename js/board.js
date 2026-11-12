// 公開版公布欄（組員看到的畫面）
import { loadImage } from "./store.js";
import {
  WD, parts, epoch, startMs, endMs, weekday, todayTPE, ymd, daysUntil, esc, weekLabel, calLabel
} from "./model.js";

const CATS = { "全教會": "var(--cat-all)", "同工": "var(--cat-staff)", "小組": "var(--cat-group)" };
let ALL = [];
const state = { view: "board", cat: "全部", calY: 0, calM: 0, selDay: null };

function occursOn(e, key) {
  if (e.kind !== "series") return e.date === key;
  if (key < e.date || key > e.until) return false;
  return key === e.date || weekday(key) === Number(e.weekday);
}
function compact(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function dateLabel(e) { const p = parts(e.date); return p.m + "/" + p.d + "（" + WD[weekday(e.date)] + "）"; }
function timeLabel(e) {
  if (e.kind === "series") return "起・" + (e.repeatText || "");
  if (e.endUnknown) return e.start + " 開始";
  return e.start + "–" + e.end + (e.end <= e.start ? "（跨夜）" : "");
}
function relDay(n) { return n === 0 ? "今天" : n === 1 ? "明天" : n === 2 ? "後天" : "還有 " + n + " 天"; }
function catColor(c) { return CATS[c] || "var(--muted)"; }
function abs(path) { try { return new URL(path, location.href).href; } catch (e) { return path; } }

// ---------- 行事曆連結 ----------
function plainText(e) {
  const l = [e.title, "時間：" + dateLabel(e) + " " + timeLabel(e)];
  if (e.checkin) l.push(e.checkin);
  if (e.location) l.push("地點：" + e.location + (e.address ? "（" + e.address + "）" : ""));
  if (e.audience) l.push("對象：" + e.audience);
  if (e.dressCode) l.push("Dress code：" + e.dressCode);
  if (e.signup && e.signup.url) l.push((e.signup.label || "報名") + "：" + e.signup.url);
  if (e.mapUrl) l.push("地圖：" + e.mapUrl);
  return l.join("\n");
}
function googleUrl(e) {
  const det = [e.audience ? "對象：" + e.audience : "", e.desc || "", e.note || "",
    e.signup && e.signup.url ? "報名：" + e.signup.url : "", e.mapUrl ? "地圖：" + e.mapUrl : ""].filter(Boolean).join("\n\n");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title) +
    "&dates=" + compact(startMs(e)) + "/" + compact(endMs(e)) + "&ctz=Asia/Taipei" +
    "&location=" + encodeURIComponent((e.location || "") + (e.address ? "，" + e.address : "")) + "&details=" + encodeURIComponent(det);
}

// ---------- 圖示 ----------
const I_TIME = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const I_DOOR = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4a1 1 0 0 1 1-1h9v18M15 21h4M3 21h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>';
const I_PIN = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const I_APPLE = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.8"/><path d="M9 15l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const I_G = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18" stroke="currentColor" stroke-width="1.8"/><text x="12" y="18.5" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" font-family="sans-serif">G</text></svg>';
const I_COPY = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// ---------- 活動卡片 ----------
function whenText(e, past) {
  if (past) return "已結束";
  if (Date.now() >= startMs(e)) return "進行中";
  return relDay(daysUntil(e.date));
}
function signupBlock(e, past, inSheet) {
  if (past) return '<span class="info">活動已結束</span>';
  const s = e.signup || {};
  if (s.url) return '<a class="btn btn-primary" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label || "我要報名") + '</a>';
  if (!inSheet) return "";
  if (s.public === false) return '<span class="info">' + esc(e.restrictedText || "報名請洽小組長") + '</span>';
  return '<span class="info">' + esc(e.noSignupText || "免報名") + '</span>';
}
function deadlineHtml(e, past) {
  if (!e.deadline || !e.deadline.date || past) return "";
  const n = daysUntil(e.deadline.date);
  return n >= 0 ? '<div class="deadline">' + esc(e.deadline.text) + '（' + relDay(n).replace("還有 ", "剩 ") + '）</div>' : "";
}
function coverHtml(im, cls, label) {
  return '<span class="' + cls + '"><img class="bg" data-img="' + esc(im.id) + '" alt="" aria-hidden="true"><img class="fg" data-img="' + esc(im.id) + '" alt="' + esc(label) + '"></span>';
}
function placeLine(e) {
  return e.kind === "series" ? "" : (e.location || "");
}
// 摘要卡：結構固定，遠看一格一格對齊；詳細內容放到「詳情」面板
function card(e, past) {
  const p = parts(e.date), imgs = e.images || [], main = imgs[0];
  const place = placeLine(e);
  const s = e.signup || {};
  const restricted = s.public === false && !s.url;
  return '<article class="card' + (past ? ' past' : '') + '" id="ev-' + esc(e.id) + '">' +
    '<button type="button" class="card-hit" data-detail="' + esc(e.id) + '" aria-label="看「' + esc(e.title) + '」詳情">' +
      (main ? coverHtml(main, "card-img", e.title + " 活動圖") : '<span class="card-img noimg"><span>' + esc(e.title) + '</span></span>') +
    '</button>' +
    '<div class="band" style="--c:' + catColor(e.category) + '"><span class="cat">' + esc(e.category) + '</span><span class="d">' + p.m + '/' + p.d + (e.kind === "series" ? ' 起' : ' 週' + WD[weekday(e.date)]) + '</span><span class="p">' + whenText(e, past) + '</span></div>' +
    '<div class="card-body">' +
      '<h3>' + esc(e.title) + '</h3>' +
      '<ul class="meta">' +
        '<li>' + I_TIME + '<span>' + (e.kind === "series" ? esc(e.repeatText || "") : timeLabel(e)) + '</span></li>' +
        (place ? '<li>' + I_PIN + '<span>' + esc(place) + '</span></li>' : '') +
      '</ul>' +
      (e.audience || restricted ? '<div class="flag-row">' + (e.audience ? '<span class="audience">' + esc(e.audience) + '</span>' : '<span class="audience">限定活動</span>') + '</div>' : '') +
      deadlineHtml(e, past) +
      '<div class="actions">' + signupBlock(e, past, false) +
        (past || e.kind === "series" || e.status === "tbd" ? '' : '<button type="button" class="btn btn-ghost" data-cal="' + esc(e.id) + '">＋ 行事曆</button>') +
        '<button type="button" class="btn btn-link" data-detail="' + esc(e.id) + '">詳情 →</button>' +
      '</div>' +
    '</div></article>';
}

// 詳情面板
function detailHtml(e) {
  const past = endMs(e) <= Date.now();
  const imgs = e.images || [], main = imgs[0];
  const meta = '<li>' + I_TIME + '<span>' + dateLabel(e) + ' ' + timeLabel(e) + '</span></li>' +
    (e.checkin ? '<li>' + I_DOOR + '<span>' + esc(e.checkin) + '</span></li>' : '') +
    (e.kind === "series" || !e.location ? '' : '<li>' + I_PIN + '<span>' + esc(e.location) + (e.address ? '<br><span class="muted">' + esc(e.address) + '</span>' : '') +
    (e.mapUrl ? '　<a href="' + esc(e.mapUrl) + '" target="_blank" rel="noopener">開地圖</a>' : '') + '</span></li>');
  const extra = imgs.slice(1).map(im =>
    '<button type="button" class="thumb" data-zoom="' + esc(im.id) + '"><img data-img="' + esc(im.id) + '" alt="">' + esc(im.caption || "更多圖片") + '</button>').join("");
  return (main ? '<button type="button" class="detail-img" data-zoom="' + esc(main.id) + '" aria-label="放大圖片"><img data-img="' + esc(main.id) + '" alt="' + esc(e.title) + ' 活動圖"></button>' : '') +
    '<div class="detail-body">' +
    '<div class="cat-row"><span class="cat"><span class="dot" style="--c:' + catColor(e.category) + '"></span>' + esc(e.category) + '</span>' +
    (e.audience ? '<span class="audience">' + esc(e.audience) + '</span>' : '') + '</div>' +
    '<h3 id="detail-title">' + esc(e.title) + '</h3>' +
    '<ul class="meta">' + meta + '</ul>' + deadlineHtml(e, past) +
    (e.desc ? '<p class="desc">' + esc(e.desc) + '</p>' : '') +
    (e.dressCode ? '<div class="dress"><b>Dress code｜</b>' + esc(e.dressCode) + '</div>' : '') +
    (extra ? '<div class="thumbs">' + extra + '</div>' : '') +
    ((e.tips || []).length ? '<ul class="tips">' + e.tips.map(t => '<li>' + esc(t) + '</li>').join("") + '</ul>' : '') +
    '<div class="actions">' + signupBlock(e, past, true) +
    (past || e.kind === "series" || e.status === "tbd" ? '' : '<button type="button" class="btn btn-ghost" data-cal="' + esc(e.id) + '">＋ 加入行事曆</button>') + '</div>' +
    '</div>';
}
function openDetail(e) {
  document.getElementById("detail-content").innerHTML = detailHtml(e);
  openOverlay("detail");
  hydrateImages(document.getElementById("detail"));
  document.getElementById("detail-close").focus();
}

// ---------- 小組聚會 ----------
function meet(m, isNext) {
  const p = parts(m.date), tbd = m.status === "tbd", past = endMs(m) <= Date.now();
  return '<div class="meet' + (tbd ? ' tbd' : '') + (isNext ? ' next' : '') + '"' + (past ? ' style="opacity:.55"' : '') + '>' +
    '<div class="when"><span class="md">' + p.m + '/' + p.d + '</span><span class="wd">週' + WD[weekday(m.date)] + '</span>' +
    (isNext ? '<span class="tag-next">' + (weekLabel(m.date) || "下一次") + '</span>' : '') + '</div>' +
    (tbd ? '<div class="t">時間地點待確認</div>' :
      '<div class="t">' + m.start + '–' + m.end + '</div><div class="place">' + esc(m.location) + '</div>') +
    (m.note ? '<div class="note">' + esc(m.note) + '</div>' : '') +
    (tbd || past ? '' : '<div class="row">' +
      (m.mapUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(m.mapUrl) + '" target="_blank" rel="noopener">地圖</a>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-cal="' + esc(m.id) + '">＋ 行事曆</button></div>') +
    '</div>';
}

// 主日聚會（台北分部，12/5 起的新時間）。長期資訊，直接寫在這裡；場地名稱確定後補 SUNDAY.place
const SUNDAY = {
  from: "2026-12-05",
  mapUrl: "https://maps.app.goo.gl/gp3awQLB2mWTyizq7",
  place: "",
  days: [
    { wd: "週六", slots: [["14:00", "雙語 Bilingual"], ["16:00", "全中文"]] },
    { wd: "週日", slots: [["09:30", "全中文"], ["11:30", "全中文"]] }
  ]
};
function sundayHtml(today) {
  const p = parts(SUNDAY.from);
  const sub = "台北分部" + (today < SUNDAY.from ? "・" + p.m + "/" + p.d + "（" + WD[weekday(SUNDAY.from)] + "）起新時間" : "");
  return '<div class="section-head"><h2>主日聚會</h2><span class="count">' + sub + '</span></div>' +
    '<div class="meets sunday">' + SUNDAY.days.map(d =>
      '<div class="meet">' +
        '<div class="when"><span class="md">' + d.wd + '</span></div>' +
        d.slots.map(s => '<div class="slot"><span class="t">' + s[0] + '</span><span>' + esc(s[1]) + '</span></div>').join("") +
        (SUNDAY.place ? '<div class="place">' + esc(SUNDAY.place) + '</div>' : '') +
        '<div class="row"><a class="btn btn-ghost btn-sm" href="' + esc(SUNDAY.mapUrl) + '" target="_blank" rel="noopener">地圖</a></div>' +
      '</div>').join("") +
    '</div>';
}

function visible(kind) {
  return ALL.filter(e => (kind ? e.kind === kind : e.kind !== "notice") && (state.cat === "全部" || e.category === state.cat))
    .sort((a, b) => startMs(a) - startMs(b));
}

// ---------- 公布欄 ----------
function renderBoard() {
  const now = Date.now();
  let html = "";
  let meets = visible("meeting");
  const weekAgo = now - 7 * 864e5;
  meets = meets.filter(m => endMs(m) > weekAgo);
  const today = ymd(todayTPE());
  const notes = ALL.filter(n => n.kind === "notice" && n.date <= today && (n.until || n.date) >= today && (state.cat === "全部" || state.cat === "小組"));
  if (meets.length || notes.length) {
    const nextId = (meets.find(m => endMs(m) > now && m.status !== "tbd") || {}).id;
    html += '<div class="section-head"><h2>Sky 小組聚會</h2><span class="count">每週日</span></div>';
    html += notes.map(n => '<div class="notice"><span class="ps">P.S.</span><p>' + esc(n.title) + '</p></div>').join("");
    html += '<div class="meets">' + meets.map(m => meet(m, m.id === nextId)).join("") + '</div>';
  }
  if (state.cat === "全部" || state.cat === "全教會") html += sundayHtml(today);
  const evs = visible().filter(e => e.kind !== "meeting");
  const up = evs.filter(e => endMs(e) > now);
  const past = evs.filter(e => endMs(e) <= now).reverse();
  if (state.cat !== "小組") {
    html += '<div class="section-head"><h2>教會活動</h2><span class="count">' + up.length + ' 個即將舉行</span></div>';
    html += up.length ? '<div class="grid">' + up.map(e => card(e, false)).join("") + '</div>'
                      : '<div class="empty">這個分類目前沒有即將舉行的活動。</div>';
    if (past.length) {
      html += '<div class="section-head"><h2>已結束</h2><span class="count">' + past.length + ' 個</span></div>';
      html += '<div class="grid">' + past.map(e => card(e, true)).join("") + '</div>';
    }
  }
  document.getElementById("board-view").innerHTML = html;
}

// ---------- 月曆 ----------
function renderCalendar() {
  const y = state.calY, m = state.calM;
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = ymd(todayTPE()), byDay = {};
  const vis = visible();
  let html = '<div class="cal"><div class="cal-head">' +
    '<button type="button" class="iconbtn" id="cal-prev" aria-label="上個月"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
    '<h2>' + y + ' 年 ' + m + ' 月</h2>' +
    '<button type="button" class="iconbtn" id="cal-next" aria-label="下個月"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
    '</div><div class="cal-grid">';
  WD.forEach((w, i) => { html += '<div class="cal-dow' + (i === 0 ? ' sun' : '') + '">' + w + '</div>'; });
  const total = Math.ceil((first + dim) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const dt = new Date(Date.UTC(y, m - 1, 1 - first + i));
    const o = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    const key = ymd(o), evs = vis.filter(e => occursOn(e, key)); byDay[key] = evs;
    html += '<button type="button" class="cell' + (o.m !== m ? ' out' : '') + (key === today ? ' today' : '') + '" data-day="' + key + '" aria-pressed="' + (state.selDay === key) + '" aria-label="' + o.m + '月' + o.d + '日' + (evs.length ? '，' + evs.length + ' 個行程' : '') + '">' +
      '<span class="n">' + o.d + '</span>' +
      evs.map(e => '<span class="ev' + (e.status === "tbd" ? ' tbd' : '') + '" style="--c:' + catColor(e.category) + '">' + esc(calLabel(e)) + '</span>').join("") +
      (evs.length ? '<span class="dots">' + evs.map(e => '<span class="dot" style="--c:' + catColor(e.category) + '"></span>').join("") + '</span>' : '') +
      '</button>';
  }
  html += '</div></div><div class="day-list">';
  const sel = state.selDay, now = Date.now(), list = sel ? (byDay[sel] || []) : [];
  if (sel) {
    const sp = parts(sel);
    html += '<div class="section-head" style="margin-bottom:0"><h2>' + sp.m + '/' + sp.d + '（' + WD[weekday(sel)] + '）</h2><span class="count">' + (list.length ? list.length + ' 個行程' : '這天沒有行程') + '</span></div>';
    list.forEach(e => { html += e.kind === "meeting" ? '<div class="meets">' + meet(e, false) + '</div>' : '<div class="grid">' + card(e, endMs(e) <= now) + '</div>'; });
  } else html += '<div class="empty">點月曆上的日期，看當天的行程。</div>';
  html += '</div>';
  document.getElementById("calendar-view").innerHTML = html;
}
function pickDefaultMonth() {
  const now = Date.now(), next = visible().find(e => endMs(e) > now && e.kind !== "series"), t = todayTPE();
  const p = next ? parts(next.date) : t;
  state.calY = p.y; state.calM = p.m; state.selDay = next ? next.date : null;
}
function renderChips() {
  const cats = ["全部"];
  ALL.forEach(e => { if (e.category && cats.indexOf(e.category) < 0) cats.push(e.category); });
  document.getElementById("chips").innerHTML = cats.map(c =>
    '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (state.cat === c) + '">' + (c === "全部" ? "" : '<span class="dot" style="--c:' + catColor(c) + '"></span>') + esc(c) + '</button>'
  ).join("");
}

// 圖片從 Firestore 讀，畫面出來後再補上
function hydrateImages(root) {
  (root || document).querySelectorAll("img[data-img]:not([src])").forEach(img => {
    loadImage(img.dataset.img).then(src => { if (src) img.src = src; });
  });
}

function renderAll() { renderChips(); renderBoard(); renderCalendar(); hydrateImages(); }

export function setView(v, fromHash) {
  state.view = v;
  document.getElementById("board-view").hidden = v !== "board";
  document.getElementById("calendar-view").hidden = v !== "calendar";
  document.getElementById("view-board").setAttribute("aria-pressed", v === "board");
  document.getElementById("view-cal").setAttribute("aria-pressed", v === "calendar");
  if (!fromHash) { try { history.replaceState(null, "", v === "calendar" ? "#calendar" : "#board"); } catch (e) {} }
}

// ---------- 面板 ----------
let current = null, lastFocus = null;
export function openOverlay(id) { lastFocus = document.activeElement; const o = document.getElementById(id); o.classList.add("open"); o.setAttribute("aria-hidden", "false"); }
export function closeOverlay(id) { const o = document.getElementById(id); if (!o.classList.contains("open")) return; o.classList.remove("open"); o.setAttribute("aria-hidden", "true"); if (lastFocus && lastFocus.focus) lastFocus.focus(); }

async function icsExists(id) {
  try { const r = await fetch("ics/" + encodeURIComponent(id) + ".ics", { method: "HEAD", cache: "no-store" }); return r.ok; }
  catch (e) { return false; }
}
async function openCal(e) {
  current = e;
  document.getElementById("sheet-title").textContent = "加入行事曆";
  document.getElementById("sheet-sub").textContent = e.title + "・" + dateLabel(e) + " " + timeLabel(e);
  const render = hasIcs =>
    (hasIcs ? '<a class="opt main" href="' + esc(abs("ics/" + e.id + ".ics")) + '" target="_blank" rel="noopener">' + I_APPLE + '<span><b>iPhone／Mac 行事曆</b><small>點了之後選「加入行事曆」</small></span></a>' : '') +
    '<a class="opt' + (hasIcs ? '' : ' main') + '" href="' + esc(googleUrl(e)) + '" target="_blank" rel="noopener">' + I_G + '<span><b>Google 日曆</b><small>Android 手機，或 iPhone 有登入 Google 帳號</small></span></a>' +
    '<button type="button" class="opt" data-copy="1">' + I_COPY + '<span><b>複製活動資訊</b><small>貼到 LINE 或記事本</small></span></button>';
  const opts = document.getElementById("sheet-opts");
  opts.innerHTML = render(false);
  openOverlay("overlay");
  const f = opts.querySelector(".opt"); if (f) f.focus();
  // 新增的活動要等下一次整點更新才有 iPhone 檔，所以先確認檔案存在再顯示
  if (await icsExists(e.id) && current === e) { opts.innerHTML = render(true); const g = opts.querySelector(".opt"); if (g) g.focus(); }
}
function openSubscribe() {
  current = null;
  const feed = abs("ics/sky-calendar.ics");
  document.getElementById("sheet-title").textContent = "訂閱整份行事曆";
  document.getElementById("sheet-sub").textContent = "小組聚會和教會活動會自動同步到你的行事曆，之後新增或改時間也會跟著更新（大約每小時一次）。";
  document.getElementById("sheet-opts").innerHTML =
    '<a class="opt main" href="' + esc(feed.replace(/^https?:/, "webcal:")) + '">' + I_APPLE + '<span><b>iPhone／Mac 行事曆</b><small>點了之後按「訂閱」</small></span></a>' +
    '<a class="opt" href="' + esc("https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(feed.replace(/^https?:/, "webcal:"))) + '" target="_blank" rel="noopener">' + I_G + '<span><b>Google 日曆</b><small>用電腦開比較順，手機會自動同步</small></span></a>';
  openOverlay("overlay");
  const f = document.querySelector("#sheet-opts .opt"); if (f) f.focus();
}
let toastTimer;
export function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }

export function copyText(text, okMsg) {
  try {
    navigator.clipboard.writeText(text).then(() => toast(okMsg || "已複製"), () => toast("沒辦法自動複製，請手動選取複製"));
  } catch (err) { toast("沒辦法自動複製，請手動選取複製"); }
}

function bind() {
  document.addEventListener("click", ev => {
    const t = ev.target.closest("[data-cal],[data-detail],[data-cat],[data-day],[data-zoom],[data-copy],#view-board,#view-cal,#cal-prev,#cal-next,#sheet-close,#lightbox-close,#btn-subscribe,#detail-close");
    if (!t) { ["overlay", "lightbox", "detail"].forEach(id => { if (ev.target.id === id) closeOverlay(id); }); return; }
    if (t.dataset.cal) { const e = ALL.find(x => x.id === t.dataset.cal); if (e) openCal(e); }
    else if (t.dataset.detail) { const e = ALL.find(x => x.id === t.dataset.detail); if (e) openDetail(e); }
    else if (t.dataset.zoom) {
      const img = document.getElementById("lightbox-img");
      img.removeAttribute("src");
      loadImage(t.dataset.zoom).then(src => { if (src) img.src = src; });
      openOverlay("lightbox"); document.getElementById("lightbox-close").focus();
    }
    else if (t.dataset.copy && current) { copyText(plainText(current), "已複製活動資訊"); closeOverlay("overlay"); }
    else if (t.dataset.cat) { state.cat = t.dataset.cat; pickDefaultMonth(); renderAll(); }
    else if (t.dataset.day) {
      state.selDay = t.dataset.day; renderCalendar(); hydrateImages(document.getElementById("calendar-view"));
      const dl = document.querySelector(".day-list"); if (dl && window.innerWidth < 760) dl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (t.id === "view-board") setView("board");
    else if (t.id === "view-cal") setView("calendar");
    else if (t.id === "btn-subscribe") openSubscribe();
    else if (t.id === "cal-prev" || t.id === "cal-next") {
      state.calM += t.id === "cal-next" ? 1 : -1;
      if (state.calM < 1) { state.calM = 12; state.calY--; } if (state.calM > 12) { state.calM = 1; state.calY++; }
      state.selDay = null; renderCalendar(); hydrateImages(document.getElementById("calendar-view"));
    }
    else if (t.id === "sheet-close") closeOverlay("overlay");
    else if (t.id === "lightbox-close") closeOverlay("lightbox");
    else if (t.id === "detail-close") closeOverlay("detail");
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") { if (document.getElementById("lightbox").classList.contains("open")) closeOverlay("lightbox"); else { closeOverlay("overlay"); closeOverlay("detail"); } } });
}

export function initBoard() { bind(); }

export function showEvents(events) {
  ALL = events.slice();
  if (!state.calY) pickDefaultMonth();
  renderAll();
}
