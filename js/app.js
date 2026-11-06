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
      document.getElementById("login-pw").value = "";
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
