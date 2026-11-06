// 後台（只有 Sonia 登入後看得到）
import * as store from "./store.js";
import {
  WD, CATEGORIES, parts, epoch, endMs, weekday, daysUntil, md, esc, newId, newImageId, shareUrl, todayTPE, ymd
} from "./model.js";
import { toast, copyText, openOverlay, closeOverlay } from "./board.js";

let ALL = [];
let draft = null;          // 正在編輯的活動
let removedImages = [];    // 這次編輯刪掉的圖片
let onChanged = () => {};  // 存檔後通知公開版重畫

const CAT_COLOR = { "全教會": "var(--cat-all)", "同工": "var(--cat-staff)", "小組": "var(--cat-group)" };
const KIND_LABEL = { event: "活動", series: "系列（每週）", meeting: "小組聚會", notice: "小組公告" };

function wdOf(s) { return WD[weekday(s)]; }
function rel(n) { return n < 0 ? "已過" : n === 0 ? "今天" : n === 1 ? "明天" : n + " 天後"; }
function sortKey(e) { return epoch(e.date, e.start || "00:00"); }
function linkRow(k, url, priv) {
  if (!url) return "";
  const shown = url.length > 60 ? url.replace(/^https?:\/\//, "").split("/")[0] + "/…（點開）" : url;
  return '<div><span class="k">' + esc(k) + '</span><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(shown) + '</a>' + (priv ? '<span class="lock">只在後台</span>' : '') + '</div>';
}

// ---------- 清單 ----------
function render() {
  const now = Date.now();
  const sorted = ALL.slice().sort((a, b) => sortKey(a) - sortKey(b));

  // 待處理
  const todo = [];
  sorted.forEach(e => {
    if (endMs(e) <= now) return;
    if (e.deadline && e.deadline.date && daysUntil(e.deadline.date) >= 0) todo.push({ d: e.deadline.date, soft: false, id: e.id, text: e.title + "：" + e.deadline.text });
    if (e.status === "tbd") todo.push({ d: e.date, soft: false, id: e.id, text: md(e.date) + " " + e.title + "：" + (e.note || "時間地點待確認") });
    (e.private.flags || []).forEach(f => todo.push({ d: e.date, soft: true, id: e.id, text: e.title + "：" + f }));
  });
  todo.sort((a, b) => (a.d < b.d ? -1 : 1));
  document.getElementById("adm-todo").innerHTML = todo.length ? todo.map(t =>
    '<li class="' + (t.soft ? "soft" : "") + '"><span class="when">' + (t.soft ? "確認" : rel(daysUntil(t.d))) + '</span><span class="txt">' + esc(t.text) + '</span><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(t.id) + '">處理</button></li>'
  ).join("") : '<li class="soft"><span class="txt">目前沒有待處理的事</span></li>';

  // 小組聚會（最近 2 週＋之後）
  const twoWeeksAgo = now - 14 * 864e5;
  const meets = sorted.filter(e => e.kind === "meeting" && endMs(e) > twoWeeksAgo);
  document.getElementById("adm-meets").innerHTML = meets.length ? meets.map(m => {
    const tbd = m.status === "tbd";
    return '<div class="arow' + (endMs(m) <= now ? ' past' : '') + '"><div class="adate"><div class="amd">' + md(m.date) + '</div><div class="awd">週' + wdOf(m.date) + '</div></div><div class="abody">' +
      '<h3>' + (tbd ? '時間地點待確認' : esc(m.start + '–' + m.end + '・' + (m.location || ''))) + '</h3>' +
      '<div class="pills">' + (tbd ? '<span class="pill tbd">待確認・公開版不能加行事曆</span>' : '<span class="pill pub">已確認</span>') + '</div>' +
      (m.note ? '<div class="sub">' + esc(m.note) + '</div>' : '') +
      '<div class="links">' + linkRow("地圖", m.mapUrl) + '</div>' +
      '<div class="tools"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(m.id) + '">編輯</button><button type="button" class="btn btn-ghost btn-sm" data-dup="' + esc(m.id) + '">複製成下週</button></div>' +
      '</div></div>';
  }).join("") : '<div class="empty">還沒有小組聚會，按上面「新增小組聚會」。</div>';

  // 小組公告
  const notes = sorted.filter(e => e.kind === "notice" && endMs(e) > now - 7 * 864e5);
  document.getElementById("adm-notes").innerHTML = notes.length ? notes.map(n => {
    const live = n.date <= ymd(todayTPE()) && endMs(n) > now;
    return '<div class="arow' + (endMs(n) <= now ? ' past' : '') + '"><div class="adate"><div class="amd">' + md(n.date) + '</div><div class="awd">到 ' + md(n.until || n.date) + '</div></div><div class="abody">' +
      '<h3>' + esc(n.title) + '</h3><div class="pills">' + (live ? '<span class="pill pub">公開版顯示中</span>' : endMs(n) <= now ? '<span class="pill">已過期</span>' : '<span class="pill">' + md(n.date) + ' 開始顯示</span>') + '</div>' +
      '<div class="tools"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(n.id) + '">編輯</button></div></div></div>';
  }).join("") : '<div class="empty">沒有公告。要在小組聚會上方加 P.S.，按「新增小組公告」。</div>';

  // 教會活動
  const evs = sorted.filter(e => e.kind !== "meeting" && e.kind !== "notice");
  const upcoming = evs.filter(e => endMs(e) > now), past = evs.filter(e => endMs(e) <= now).reverse();
  const row = e => {
    const s = e.signup || {}, p = e.private || {};
    const pubState = s.url ? (s.public === false ? '<span class="pill priv">連結只在後台</span>' : '<span class="pill pub">公開版有連結</span>') : '<span class="pill pub">免報名</span>';
    return '<div class="arow' + (endMs(e) <= now ? ' past' : '') + '"><div class="adate"><div class="amd">' + md(e.date) + '</div><div class="awd">週' + wdOf(e.date) + '</div></div><div class="abody">' +
      '<h3>' + esc(e.title) + '</h3>' +
      '<div class="sub">' + (e.kind === "series" ? md(e.date) + ' 起・' + esc(e.repeatText || '') + '（月曆標到 ' + md(e.until || e.date) + '）'
        : esc((e.start || '') + (e.endUnknown ? ' 開始（結束時間未公布）' : '–' + (e.end || '')) + (e.checkin ? '・' + e.checkin : '') + (e.location ? '・' + e.location : '') + (e.address ? '（' + e.address + '）' : ''))) + '</div>' +
      '<div class="pills"><span class="pill cat" style="--c:' + (CAT_COLOR[e.category] || "var(--muted)") + '">' + esc(e.category || "未分類") + '</span>' + pubState +
      (e.status === "tbd" ? '<span class="pill tbd">待確認</span>' : '') +
      (e.audience ? '<span class="pill">' + esc(e.audience) + '</span>' : '') + '</div>' +
      ((p.flags || []).length ? '<div class="flags">' + p.flags.map(f => '<p>⚠ ' + esc(f) + '</p>').join("") + '</div>' : '') +
      '<div class="links">' + linkRow(s.label || "報名", s.url, s.public === false) + linkRow("Zoom", p.zoom, true) + linkRow("地圖", e.mapUrl) + '</div>' +
      (s.public === false ? '<div class="sub">公開版顯示：「' + esc(e.restrictedText || "報名請洽小組長") + '」</div>' : '') +
      '<div class="tools"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(e.id) + '">編輯</button>' +
      (p.announcement ? '<button type="button" class="btn btn-ghost btn-sm" data-ann="' + esc(e.id) + '">複製原始公告</button>' : '') + '</div>' +
      (p.announcement ? '<details><summary>看原始公告</summary><pre>' + esc(p.announcement) + '</pre></details>' : '') +
      '</div></div>';
  };
  document.getElementById("adm-events").innerHTML =
    (upcoming.length ? upcoming.map(row).join("") : '<div class="empty">沒有即將舉行的活動。</div>') +
    (past.length ? '<details class="past-wrap"><summary>已結束（' + past.length + '）</summary><div class="alist">' + past.map(row).join("") + '</div></details>' : '');
}

function meetsText() {
  const now = Date.now();
  return "【Sky 小組聚會時間】\n" + ALL.filter(m => m.kind === "meeting" && endMs(m) > now)
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map(m => md(m.date) + "（" + wdOf(m.date) + "）" + (m.status === "tbd" ? "時間地點待確認" : m.start + "–" + m.end + " " + (m.location || "") + (m.mapUrl ? " " + m.mapUrl : "")) + (m.note && m.status !== "tbd" ? "　※" + m.note : ""))
    .join("\n");
}

// ---------- 編輯表單 ----------
function blank(kind) {
  const base = {
    id: "", kind, title: kind === "meeting" ? "Sky 小組聚會" : "", category: kind === "meeting" ? "小組" : "全教會",
    audience: "", date: "", start: kind === "meeting" ? "16:00" : "19:00", end: kind === "meeting" ? "18:00" : "21:00",
    checkin: "", location: "", address: "", mapUrl: "", desc: "", tips: [], dressCode: "", note: "",
    signup: { url: "", label: "", public: true }, restrictedText: "", noSignupText: "", deadline: null,
    status: "confirmed", images: [], private: { zoom: "", flags: [], announcement: "" }
  };
  if (kind === "series") Object.assign(base, { until: "", weekday: 0, repeatText: "每週主日", start: "00:00", end: "23:59", allDay: true });
  if (kind === "notice") Object.assign(base, { title: "", category: "小組", date: ymd(todayTPE()), until: "", start: "00:00", end: "23:59" });
  return base;
}

const f = (label, html, hint) => '<label class="fld"><span class="fl">' + label + '</span>' + html + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
const inp = (name, val, type, extra) => '<input name="' + name + '" type="' + (type || "text") + '" value="' + esc(val == null ? "" : val) + '"' + (extra || "") + '>';
const area = (name, val, rows) => '<textarea name="' + name + '" rows="' + (rows || 3) + '">' + esc(val || "") + '</textarea>';

function formHtml(e) {
  const k = e.kind, isNew = !e.id;
  const s = e.signup || {}, p = e.private || {}, dl = e.deadline || {};
  let h = '<form id="ed-form" novalidate>';
  if (isNew) {
    h += '<div class="seg kind-seg" role="group" aria-label="類型">' + ["event", "series", "meeting", "notice"].map(x =>
      '<button type="button" data-kind="' + x + '" aria-pressed="' + (x === k) + '">' + KIND_LABEL[x] + '</button>').join("") + '</div>';
  }
  if (k === "notice") {
    h += '<fieldset><legend>小組公告（顯示在公開版「Sky 小組聚會」上方，標 P.S.）</legend>' +
      f("公告內容", area("title", e.title, 3)) +
      '<div class="two">' + f("開始顯示", inp("date", e.date, "date")) + f("顯示到（這天之後自動消失）", inp("until", e.until, "date")) + '</div></fieldset>' +
      '<div class="ed-actions">' + (isNew ? '' : '<button type="button" class="btn btn-danger" id="ed-delete">刪除</button>') +
      '<span class="sp"></span><button type="button" class="btn btn-ghost" id="ed-cancel">取消</button><button type="submit" class="btn btn-primary" id="ed-save">儲存</button></div></form>';
    return h;
  }
  h += '<fieldset><legend>基本</legend>';
  h += f("標題", inp("title", e.title, "text", ' required'));
  if (k !== "meeting") {
    h += '<div class="two">' + f("分類", '<select name="category">' + CATEGORIES.map(c => '<option' + (c === e.category ? ' selected' : '') + '>' + c + '</option>').join("") + '</select>') +
      f("對象（限定活動才寫）", inp("audience", e.audience), "例：限小組長、區長") + '</div>';
  }
  h += f("狀態", '<select name="status"><option value="confirmed"' + (e.status !== "tbd" ? ' selected' : '') + '>已確認</option><option value="tbd"' + (e.status === "tbd" ? ' selected' : '') + '>待確認（公開版不能加行事曆）</option></select>');
  h += '</fieldset>';

  h += '<fieldset><legend>時間</legend>';
  if (k === "series") {
    h += '<div class="two">' + f("開始日期", inp("date", e.date, "date", ' required')) + f("結束日期", inp("until", e.until, "date")) + '</div>';
    h += '<div class="two">' + f("每週哪一天", '<select name="weekday">' + WD.map((w, i) => '<option value="' + i + '"' + (Number(e.weekday) === i ? ' selected' : '') + '>週' + w + '</option>').join("") + '</select>') +
      f("顯示文字", inp("repeatText", e.repeatText), "例：每週主日・全日") + '</div>';
  } else {
    h += f("日期", inp("date", e.date, "date", ' required'));
    h += '<div class="two">' + f("開始", inp("start", e.start, "time")) + f("結束", inp("end", e.end, "time")) + '</div>';
    if (k === "event") {
      h += '<label class="chk"><input type="checkbox" name="endUnknown"' + (e.endUnknown ? ' checked' : '') + '> 結束時間還沒公布（只顯示開始時間）</label>';
      h += f("報到／進場", inp("checkin", e.checkin), "例：18:30 進場");
    }
  }
  h += '</fieldset>';

  if (k !== "series") {
    h += '<fieldset><legend>地點</legend>' + f("地點", inp("location", e.location));
    if (k === "event") h += f("地址", inp("address", e.address));
    h += f("地圖連結", inp("mapUrl", e.mapUrl, "url"), "Google 地圖分享連結");
    if (k === "meeting") h += f("備註（公開版會顯示）", inp("note", e.note), "例：時間跟平常不同");
    h += '</fieldset>';
  }

  if (k !== "meeting") {
    h += '<fieldset><legend>內容</legend>' + f("介紹", area("desc", e.desc, 3)) +
      f("提醒（一行一個）", area("tips", (e.tips || []).join("\n"), 3)) +
      f("Dress code", inp("dressCode", e.dressCode)) +
      '<div class="two">' + f("截止日", inp("deadlineDate", dl.date || "", "date")) + f("截止提醒文字", inp("deadlineText", dl.text || ""), "例：11/7 前一定要填表") + '</div>' +
      '</fieldset>';

    h += '<fieldset><legend>報名</legend>' + f("報名連結", inp("signupUrl", s.url, "url")) +
      f("按鈕文字", inp("signupLabel", s.label), "空白＝「我要報名」") +
      '<label class="chk"><input type="checkbox" name="signupPublic"' + (s.public !== false ? ' checked' : '') + '> 組員看得到報名連結（限定活動請取消勾選）</label>' +
      f("不公開連結時，公開版顯示", inp("restrictedText", e.restrictedText), "例：表單連結請詢問組長 Sonia") +
      f("免報名時，公開版顯示", inp("noSignupText", e.noSignupText), "例：免報名，直接來") +
      '</fieldset>';

    h += '<fieldset><legend>圖片</legend><div id="ed-imgs" class="ed-imgs"></div>' +
      '<label class="btn btn-ghost upl"><input type="file" id="ed-file" accept="image/*" multiple hidden>＋ 上傳海報／圖片</label>' +
      '<small class="hint">第一張是封面。會自動壓縮，原檔不用先縮。</small></fieldset>';
  }

  h += '<fieldset class="privfs"><legend>只在後台（組員看不到）</legend>';
  if (k !== "meeting") h += f("Zoom 連結", inp("zoom", p.zoom, "url"));
  h += f("待確認事項（一行一個，會出現在「待處理」）", area("flags", (p.flags || []).join("\n"), 2));
  if (k !== "meeting") h += f("原始公告", area("announcement", p.announcement, 6));
  h += '</fieldset>';

  h += '<div class="ed-actions">' + (isNew ? '' : '<button type="button" class="btn btn-danger" id="ed-delete">刪除</button>') +
    '<span class="sp"></span><button type="button" class="btn btn-ghost" id="ed-cancel">取消</button><button type="submit" class="btn btn-primary" id="ed-save">儲存</button></div>';
  h += '</form>';
  return h;
}

function renderImgs() {
  const box = document.getElementById("ed-imgs");
  if (!box) return;
  box.innerHTML = draft.images.length ? draft.images.map((im, i) =>
    '<div class="ed-img" data-i="' + i + '"><img data-src-id="' + esc(im.id) + '" alt="">' +
    '<div class="ed-img-body">' + (i === 0 ? '<b class="cover">封面</b>' : '') +
    '<input type="text" data-cap="' + i + '" value="' + esc(im.caption || "") + '" placeholder="說明（例：Dress code：墨鏡）">' +
    (i === 0 ? '<label class="chk sm"><input type="checkbox" data-natural="1"' + (im.ratio === "natural" ? ' checked' : '') + '> 封面照原比例顯示（長條橫幅用）</label>' : '') +
    '<div class="ed-img-tools">' + (i > 0 ? '<button type="button" class="btn btn-ghost btn-sm" data-cover="' + i + '">設為封面</button>' : '') +
    '<button type="button" class="btn btn-ghost btn-sm" data-rmimg="' + i + '">移除</button></div></div></div>'
  ).join("") : '<div class="empty sm">還沒有圖片</div>';
  box.querySelectorAll("img[data-src-id]").forEach(img => {
    const im = draft.images.find(x => x.id === img.dataset.srcId);
    if (im && im._new) img.src = im._new.data;
    else store.loadImage(img.dataset.srcId).then(src => { if (src) img.src = src; });
  });
}

function openEditor(e) {
  draft = JSON.parse(JSON.stringify(e));
  draft.images = (draft.images || []).map(im => Object.assign({}, im));
  removedImages = [];
  document.getElementById("ed-title").textContent = e.id ? "編輯：" + (e.title || KIND_LABEL[e.kind]) : "新增" + KIND_LABEL[e.kind];
  document.getElementById("ed-body").innerHTML = formHtml(draft);
  renderImgs();
  openOverlay("editor");
  const first = document.querySelector('#ed-form input[name="title"]'); if (first && !e.id) first.focus();
}

function readForm() {
  const fm = document.getElementById("ed-form");
  const v = n => { const el = fm.elements[n]; return el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : undefined; };
  const lines = n => (v(n) || "").split("\n").map(x => x.trim()).filter(Boolean);
  const e = draft;
  e.title = v("title") || "";
  if (v("category") !== undefined) e.category = v("category");
  if (v("audience") !== undefined) e.audience = v("audience");
  e.status = v("status") || e.status || "confirmed";
  e.date = v("date") || "";
  if (e.kind === "notice") {
    e.until = v("until") || ""; e.category = "小組"; e.start = "00:00"; e.end = "23:59"; e.status = "confirmed";
    e.private = e.private || { zoom: "", flags: [], announcement: "" };
    return e;
  }
  if (e.kind === "series") {
    e.until = v("until") || e.date; e.weekday = Number(v("weekday")); e.repeatText = v("repeatText");
    e.start = "00:00"; e.end = "23:59"; e.allDay = true;
  } else {
    e.start = v("start") || ""; e.end = v("end") || "";
    if (e.kind === "event") { e.endUnknown = !!v("endUnknown"); e.checkin = v("checkin"); }
  }
  if (v("location") !== undefined) e.location = v("location");
  if (v("address") !== undefined) e.address = v("address");
  if (v("mapUrl") !== undefined) e.mapUrl = v("mapUrl");
  if (v("note") !== undefined) e.note = v("note");
  if (e.kind !== "meeting") {
    e.desc = v("desc"); e.tips = lines("tips"); e.dressCode = v("dressCode");
    e.deadline = v("deadlineDate") ? { date: v("deadlineDate"), text: v("deadlineText") || "截止" } : null;
    e.signup = { url: v("signupUrl"), label: v("signupLabel"), public: !!v("signupPublic") };
    e.restrictedText = v("restrictedText"); e.noSignupText = v("noSignupText");
  }
  e.private = e.private || {};
  if (v("zoom") !== undefined) e.private.zoom = v("zoom");
  e.private.flags = lines("flags");
  if (v("announcement") !== undefined) e.private.announcement = fm.elements.announcement.value;
  return e;
}

function validate(e) {
  if (!e.title) return e.kind === "notice" ? "請填公告內容" : "請填標題";
  if (e.kind === "notice") return !e.date ? "請填開始顯示日期" : !e.until ? "請填顯示到哪一天" : e.until < e.date ? "結束日期不能早於開始日期" : "";
  if (!e.date) return "請填日期";
  if (e.kind !== "series" && e.status !== "tbd" && (!e.start || (!e.end && !e.endUnknown))) return "請填開始和結束時間（還不確定可以把狀態改成「待確認」）";
  if (e.kind === "series" && e.until && e.until < e.date) return "結束日期不能早於開始日期";
  return "";
}

async function save() {
  const e = readForm();
  const err = validate(e);
  if (err) { toast(err); return; }
  if (e.kind === "meeting" && e.status === "tbd" && !e.start) { e.start = "16:00"; e.end = "18:00"; }
  if (!e.id) e.id = newId(e.kind, e.date);
  const newImages = e.images.filter(im => im._new).map(im => Object.assign({ id: im.id }, im._new));
  const clean = JSON.parse(JSON.stringify(e));
  clean.images = e.images.map(im => ({ id: im.id, caption: im.caption || "", ratio: im.ratio || "" }));
  const btn = document.getElementById("ed-save"); btn.disabled = true; btn.textContent = "儲存中…";
  try {
    await store.saveEvent(clean, newImages, removedImages);
    closeOverlay("editor");
    toast("已儲存");
    await reload();
  } catch (x) {
    console.error(x);
    toast("儲存失敗：" + (x.code || x.message || "請再試一次"));
    btn.disabled = false; btn.textContent = "儲存";
  }
}

async function remove() {
  const btn = document.getElementById("ed-delete");
  if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.textContent = "再按一次確認刪除"; setTimeout(() => { if (btn) { delete btn.dataset.armed; btn.textContent = "刪除"; } }, 4000); return; }
  btn.disabled = true;
  try {
    const orig = ALL.find(x => x.id === draft.id) || draft;
    await store.deleteEvent(orig);
    closeOverlay("editor"); toast("已刪除"); await reload();
  } catch (x) { console.error(x); toast("刪除失敗：" + (x.code || x.message)); btn.disabled = false; }
}

// ---------- 圖片壓縮（瀏覽器端，存進 Firestore 不能超過 1MB） ----------
function loadImgFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("讀不到這張圖")); };
    img.src = url;
  });
}
export async function compressImage(file) {
  const img = await loadImgFile(file);
  const LIMIT = 700000; // base64 字元數上限，留空間給其他欄位
  let maxEdge = 1800, q = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    let data = c.toDataURL("image/webp", q);
    if (!data.startsWith("data:image/webp")) data = c.toDataURL("image/jpeg", q);
    if (data.length <= LIMIT) return { data, w, h };
    if (q > 0.6) q -= 0.1; else maxEdge = Math.round(maxEdge * 0.8);
  }
  throw new Error("圖片太大，壓不下來");
}

async function addFiles(files) {
  for (const file of files) {
    try {
      toast("壓縮中…");
      const out = await compressImage(file);
      draft.images.push({ id: newImageId(), caption: "", ratio: "", _new: out });
      renderImgs();
      toast("已加入，記得按儲存");
    } catch (x) { toast(file.name + "：" + x.message); }
  }
}

// ---------- 匯入／匯出 ----------
async function doImport(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (x) { toast("這個檔案不是正確的匯入檔"); return; }
  if (!data || !Array.isArray(data.events)) { toast("這個檔案不是正確的匯入檔"); return; }
  const exists = new Set(ALL.map(e => e.id));
  const overwrite = data.events.filter(e => exists.has(e.id)).length;
  const status = document.getElementById("adm-status");
  status.textContent = "匯入中… 0/" + data.events.length + (overwrite ? "（其中 " + overwrite + " 個會覆蓋現有活動）" : "");
  try {
    await store.importData(data, (n, t) => { status.textContent = "匯入中… " + n + "/" + t; });
    status.textContent = "";
    toast("匯入完成：" + data.events.length + " 個");
    await reload();
  } catch (x) { console.error(x); status.textContent = "匯入失敗：" + (x.code || x.message); }
}
async function doExport() {
  const status = document.getElementById("adm-status");
  status.textContent = "準備備份檔…";
  try {
    const data = await store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "sky-board-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    status.textContent = "";
  } catch (x) { console.error(x); status.textContent = "備份失敗：" + (x.code || x.message); }
}

// ---------- 事件 ----------
function dupNextWeek(id) {
  const m = ALL.find(x => x.id === id); if (!m) return;
  const c = JSON.parse(JSON.stringify(m));
  const p = parts(m.date), d = new Date(Date.UTC(p.y, p.m - 1, p.d + 7));
  c.id = ""; c.date = d.toISOString().slice(0, 10); c.note = ""; c.private = { zoom: "", flags: [], announcement: "" };
  openEditor(c);
}

function bind() {
  document.getElementById("admin-view").addEventListener("click", ev => {
    const t = ev.target.closest("button,[data-edit]"); if (!t) return;
    if (t.dataset.edit) { const e = ALL.find(x => x.id === t.dataset.edit); if (e) openEditor(e); }
    else if (t.dataset.ann) { const e = ALL.find(x => x.id === t.dataset.ann); if (e) copyText(e.private.announcement, "已複製原始公告"); }
    else if (t.dataset.dup) dupNextWeek(t.dataset.dup);
    else if (t.id === "adm-new-event") openEditor(blank("event"));
    else if (t.id === "adm-new-meet") openEditor(blank("meeting"));
    else if (t.id === "adm-new-note") openEditor(blank("notice"));
    else if (t.id === "adm-copy-meets") copyText(meetsText(), "已複製小組時間");
    else if (t.id === "adm-copy-link") copyText(shareUrl(), "已複製分享連結（LINE 會用外部瀏覽器開）");
    else if (t.id === "adm-export") doExport();
    else if (t.id === "adm-logout") store.logout();
  });
  document.getElementById("adm-import").addEventListener("change", ev => { const fl = ev.target.files[0]; ev.target.value = ""; if (fl) doImport(fl); });

  const ed = document.getElementById("editor");
  ed.addEventListener("click", ev => {
    const t = ev.target.closest("button"); if (!t) return;
    if (t.dataset.kind) { readForm(); const keep = { title: draft.title, date: draft.date }; const b = blank(t.dataset.kind); if (keep.title && draft.kind !== "meeting") b.title = keep.title; b.date = keep.date || b.date; openEditor(b); }
    else if (t.dataset.cover) { readForm(); const i = Number(t.dataset.cover); const [im] = draft.images.splice(i, 1); draft.images.unshift(im); draft.images.forEach((x, j) => { if (j > 0 && x.ratio === "natural") x.ratio = ""; }); renderImgs(); }
    else if (t.dataset.rmimg) { readForm(); const i = Number(t.dataset.rmimg); const [im] = draft.images.splice(i, 1); if (!im._new) removedImages.push(im.id); renderImgs(); }
    else if (t.id === "ed-cancel" || t.id === "ed-x") closeOverlay("editor");
    else if (t.id === "ed-delete") remove();
  });
  ed.addEventListener("input", ev => {
    const t = ev.target;
    if (t.dataset.cap !== undefined) draft.images[Number(t.dataset.cap)].caption = t.value;
    if (t.dataset.natural) draft.images[0].ratio = t.checked ? "natural" : "";
  });
  ed.addEventListener("change", ev => { if (ev.target.id === "ed-file") { addFiles(Array.from(ev.target.files)); ev.target.value = ""; } });
  ed.addEventListener("submit", ev => { ev.preventDefault(); save(); });
}

export async function reload() {
  ALL = await store.loadAll();
  render();
  onChanged(ALL);
}

let bound = false;
export async function initAdmin(changed) {
  onChanged = changed || onChanged;
  if (!bound) { bind(); bound = true; }
  await reload();
}
