// 進入點：載入公開資料、處理「後台」登入與畫面切換
import * as store from "./store.js";
import { initBoard, showEvents, setView, openOverlay, closeOverlay, toast } from "./board.js";
import { addDays, ymd, todayTPE } from "./model.js";

let user = null, adminLoaded = false;

async function loadPublic() {
  try {
    const events = await store.loadPublicEvents(addDays(ymd(todayTPE()), -45));
    showEvents(events);
  } catch (x) {
    console.error(x);
    document.getElementById("board-view").innerHTML = '<div class="empty">活動資料暫時載入不了，請稍後重新整理。</div>';
  }
}

function setMode(mode) {
  const admin = mode === "admin";
  document.getElementById("admin-view").hidden = !admin;
  document.getElementById("public-head").hidden = admin;
  document.getElementById("board-view").hidden = admin || location.hash === "#calendar";
  document.getElementById("calendar-view").hidden = admin || location.hash !== "#calendar";
  document.getElementById("btn-admin").textContent = admin ? "回公布欄" : "後台";
  if (!admin) setView(location.hash === "#calendar" ? "calendar" : "board", true);
  window.scrollTo(0, 0);
}

async function enterAdmin() {
  if (!store.isAdmin(user)) { openLogin(); return; }
  if (location.hash !== "#admin") history.replaceState(null, "", "#admin");
  setMode("admin");
  if (!adminLoaded) {
    adminLoaded = true;
    const mod = await import("./admin.js");
    try { await mod.initAdmin(all => showEvents(all)); }
    catch (x) { adminLoaded = false; console.error(x); toast("後台資料載入失敗：" + (x.code || x.message)); }
  }
}
function leaveAdmin() { history.replaceState(null, "", "#board"); setMode("public"); }

function openLogin() {
  document.getElementById("login-msg").textContent = "";
  openOverlay("login");
  setTimeout(() => document.getElementById("login-email").focus(), 30);
}

const AUTH_MSG = {
  "auth/invalid-credential": "Email 或密碼不對",
  "auth/wrong-password": "Email 或密碼不對",
  "auth/user-not-found": "Email 或密碼不對",
  "auth/invalid-email": "Email 格式不對",
  "auth/too-many-requests": "嘗試太多次，請稍後再試",
  "auth/network-request-failed": "網路連不上，請檢查網路"
};

function bind() {
  document.getElementById("btn-admin").addEventListener("click", () => {
    if (!document.getElementById("admin-view").hidden) leaveAdmin(); else enterAdmin();
  });
  document.getElementById("login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const msg = document.getElementById("login-msg"), btn = document.getElementById("login-submit");
    btn.disabled = true; msg.textContent = "登入中…";
    try {
      const cred = await store.login(document.getElementById("login-email").value.trim(), document.getElementById("login-pw").value);
      if (!store.isAdmin(cred.user)) { msg.textContent = "這個帳號沒有後台權限"; await store.logout(); return; }
      document.getElementById("login-pw").value = ""; msg.textContent = "";
      closeOverlay("login");
      user = cred.user;
      enterAdmin();
    } catch (x) { msg.textContent = AUTH_MSG[x.code] || ("登入失敗：" + (x.code || x.message)); }
    finally { btn.disabled = false; }
  });
  document.getElementById("login-forgot").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim(), msg = document.getElementById("login-msg");
    if (!email) { msg.textContent = "先填 Email，再按忘記密碼"; return; }
    try { await store.resetPassword(email); msg.textContent = "已寄出重設密碼信，請到信箱收信"; }
    catch (x) { msg.textContent = AUTH_MSG[x.code] || ("寄送失敗：" + (x.code || x.message)); }
  });
  document.getElementById("login-close").addEventListener("click", () => closeOverlay("login"));
  document.getElementById("login").addEventListener("click", ev => { if (ev.target.id === "login") closeOverlay("login"); });
  document.getElementById("editor").addEventListener("click", ev => { if (ev.target.id === "editor") closeOverlay("editor"); });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") { closeOverlay("login"); closeOverlay("editor"); } });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#admin") enterAdmin();
    else setMode("public");
  });
}

initBoard();
bind();
setMode("public");
loadPublic();

store.onAuth(u => {
  user = u;
  document.body.classList.toggle("is-admin", store.isAdmin(u));
  if (!u) {
    adminLoaded = false;
    if (!document.getElementById("admin-view").hidden) { leaveAdmin(); toast("已登出"); }
    return;
  }
  if (location.hash === "#admin" && store.isAdmin(u)) enterAdmin();
});
if (location.hash === "#admin") setTimeout(() => { if (!store.isAdmin(user)) openLogin(); }, 1200);

// ---------- 加到主畫面（PWA） ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
let installPrompt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const installBtn = document.getElementById("btn-install");
if (standalone()) installBtn.hidden = true;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
window.addEventListener("appinstalled", () => { installBtn.hidden = true; toast("已加到主畫面"); });

const I_HOME = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v7M9 11l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
function step(n, html) { return '<div class="opt"><span class="stepn">' + n + '</span><span>' + html + '</span></div>'; }
installBtn.addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const r = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (r && r.outcome === "accepted") installBtn.hidden = true;
    return;
  }
  const ua = navigator.userAgent;
  const inLine = /\bLine\//i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  let html;
  if (inLine) {
    html = '<a class="opt main" href="./?openExternalBrowser=1">' + I_HOME + '<span><b>先用瀏覽器打開</b><small>LINE 裡面不能加到主畫面，點這裡會改用 ' + (ios ? "Safari" : "Chrome") + ' 開，再按一次「加到主畫面」</small></span></a>';
  } else if (ios) {
    html = step(1, '點畫面下方（或網址列旁）的 <b>分享</b> 按鈕 <span aria-hidden="true">⬆︎</span>') +
      step(2, '往下滑，選 <b>加入主畫面</b>') + step(3, '右上角按 <b>新增</b>');
  } else if (android) {
    html = step(1, '點右上角 <b>⋮</b>') + step(2, '選 <b>加到主畫面</b> 或 <b>安裝應用程式</b>');
  } else {
    html = step(1, '點網址列右邊的 <b>安裝</b> 圖示') + step(2, '或是用手機打開這個網頁再加到主畫面');
  }
  document.getElementById("sheet-title").textContent = "加到主畫面";
  document.getElementById("sheet-sub").textContent = "加了之後點圖示就能直接打開，像 App 一樣。";
  document.getElementById("sheet-opts").innerHTML = html;
  openOverlay("overlay");
});
