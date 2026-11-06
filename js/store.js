// 所有跟 Firebase 打交道的地方都在這個檔案
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { toPublic, toPrivate, merge, ADMIN_UID } from "./model.js";

// 公開設定（不是密碼，放在網頁上是正常的；真正的保護是 firestore.rules）
const firebaseConfig = {
  apiKey: "AIzaSyAClZiXxiTXf9YBB3tjQSykVLwFAvsBa3Y",
  authDomain: "sky-group-46daa.firebaseapp.com",
  projectId: "sky-group-46daa",
  storageBucket: "sky-group-46daa.firebasestorage.app",
  messagingSenderId: "548822812991",
  appId: "1:548822812991:web:f223decd50a59bfa4eeb8a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ---------- 公開 ----------
export async function loadPublicEvents(sinceDate) {
  const q = sinceDate
    ? query(collection(db, "events"), where("endDate", ">=", sinceDate))
    : collection(db, "events");
  const snap = await getDocs(q);
  return snap.docs.map(d => merge(d.id, d.data(), null));
}

const imgCache = new Map();
export function loadImage(id) {
  if (!imgCache.has(id)) {
    imgCache.set(id, getDoc(doc(db, "images", id)).then(s => (s.exists() ? s.data().data : "")));
  }
  return imgCache.get(id);
}
export function cacheImage(id, data) { imgCache.set(id, Promise.resolve(data)); }

// ---------- 登入 ----------
export function onAuth(cb) { return onAuthStateChanged(auth, u => cb(u)); }
export function isAdmin(user) { return !!user && user.uid === ADMIN_UID; }
export function login(email, password) { return signInWithEmailAndPassword(auth, email, password); }
export function logout() { return signOut(auth); }
export function resetPassword(email) { return sendPasswordResetEmail(auth, email); }

// ---------- 後台 ----------
export async function loadAll() {
  const [pub, priv] = await Promise.all([getDocs(collection(db, "events")), getDocs(collection(db, "events_private"))]);
  const privMap = {};
  priv.docs.forEach(d => { privMap[d.id] = d.data(); });
  return pub.docs.map(d => merge(d.id, d.data(), privMap[d.id]));
}

// newImages: [{ id, data, w, h }]  removedImageIds: [id]
export async function saveEvent(full, newImages, removedImageIds) {
  const b = writeBatch(db);
  (newImages || []).forEach(im => {
    b.set(doc(db, "images", im.id), { data: im.data, w: im.w || 0, h: im.h || 0, eventId: full.id });
  });
  (removedImageIds || []).forEach(id => b.delete(doc(db, "images", id)));
  b.set(doc(db, "events", full.id), Object.assign(toPublic(full), { updatedAt: Date.now() }));
  b.set(doc(db, "events_private", full.id), toPrivate(full));
  await b.commit();
  (newImages || []).forEach(im => cacheImage(im.id, im.data));
}

export async function deleteEvent(full) {
  const b = writeBatch(db);
  (full.images || []).forEach(im => b.delete(doc(db, "images", im.id)));
  b.delete(doc(db, "events", full.id));
  b.delete(doc(db, "events_private", full.id));
  await b.commit();
}

// 匯入：{ events: [完整活動], images: { id: { data, w, h } } }
// 一個活動一批寫入，避免單批超過 Firestore 10MB 上限
export async function importData(data, onProgress) {
  const imgs = data.images || {};
  const evs = data.events || [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const newImages = (e.images || []).filter(im => imgs[im.id]).map(im => Object.assign({ id: im.id }, imgs[im.id]));
    await saveEvent(e, newImages, []);
    if (onProgress) onProgress(i + 1, evs.length);
  }
}

export async function exportData() {
  const all = await loadAll();
  const images = {};
  for (const e of all) {
    for (const im of e.images || []) {
      const s = await getDoc(doc(db, "images", im.id));
      if (s.exists()) { const d = s.data(); images[im.id] = { data: d.data, w: d.w || 0, h: d.h || 0 }; }
    }
  }
  return { exportedAt: new Date().toISOString(), events: all, images };
}
