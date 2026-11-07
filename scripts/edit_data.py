#!/usr/bin/env python3
"""讓 Claude 不用登入後台也能改活動資料（GitHub Actions 用服務帳戶金鑰執行）。

修改單放在 data/edits/*.json，push 到 main 後由 .github/workflows/data.yml 執行。
執行完把結果（改了什麼、改之前的值、目前所有公開資料）推到 data-log 分支，
Claude 用 `git fetch origin data-log` 讀取。

只碰「公開欄位」（events/{id}）。限定報名連結、Zoom 這類私密資料不走這條路，
因為修改單放在公開儲存庫，任何人都看得到；那些仍然在後台改。

修改單格式：
{
  "note": "這次要做什麼（給人看的）",
  "ops": [
    {"op": "update", "match": {"kind": "meeting", "date": "2026-11-08"}, "set": {"location": "華視-玻璃屋"}},
    {"op": "update", "match": {"kind": "event", "titleContains": "CRTV"}, "set": {"location": "華視-玻璃屋"}},
    {"op": "create", "data": {"kind": "notice", "title": "公告內容", "date": "2026-11-07", "until": "2026-11-30"}},
    {"op": "delete", "match": {"id": "ev-20261101-abcd"}}
  ]
}
- match 一定要剛好對到 1 筆，對到 0 筆或多筆就整張修改單都不執行（避免改錯）
- match 可用：id、任何公開欄位（完全相等）、titleContains（標題包含）
- create 時如果已經有同類型、同標題、同日期的資料，就跳過（重跑不會重複新增）
- 加 "dryRun": true 只檢查、不寫入

用法：
  python3 scripts/edit_data.py apply data/edits/xxx.json [更多檔案] --out out
  python3 scripts/edit_data.py snapshot --out out
金鑰從環境變數 FIREBASE_SERVICE_ACCOUNT 讀（整份 JSON 內容）。
"""
import json
import os
import random
import string
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

TPE = timezone(timedelta(hours=8))

# 跟 js/model.js 的 PUBLIC_FIELDS 一致；signup、images 刻意不開放（避免把限定連結寫進公開欄位、弄壞海報）
EDITABLE = {
    "kind", "title", "category", "audience", "date", "until", "weekday", "start", "end", "endUnknown", "allDay",
    "repeatText", "checkin", "location", "address", "mapUrl", "desc", "tips", "dressCode", "restrictedText",
    "noSignupText", "deadline", "status", "note", "calLabel",
}
KINDS = {"event", "series", "meeting", "notice"}

DEFAULTS = {
    "meeting": {"title": "Sky 小組聚會", "category": "小組", "start": "16:00", "end": "18:00", "status": "confirmed"},
    "event": {"category": "全教會", "start": "19:00", "end": "21:00", "status": "confirmed"},
    "series": {"category": "全教會", "start": "00:00", "end": "23:59", "allDay": True, "weekday": 0,
               "repeatText": "每週主日", "status": "confirmed"},
    "notice": {"category": "小組", "start": "00:00", "end": "23:59", "status": "confirmed"},
}


class EditError(Exception):
    pass


# ---------- 資料規則（對應 js/model.js） ----------
def end_date_of(e):
    return (e.get("until") or e.get("date")) if e.get("kind") in ("series", "notice") else e.get("date")


def new_id(kind, date):
    r = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(4))
    prefix = {"meeting": "sky", "series": "series", "notice": "note"}.get(kind, "ev")
    return f"{prefix}-{(date or '').replace('-', '')}-{r}"


def clean_public(d):
    """跟 toPublic 一樣：空值不存，補 signup / images / tips / endDate。"""
    out = {k: v for k, v in d.items() if v is not None and v != ""}
    out.setdefault("signup", {"label": "", "public": True, "url": ""})
    out.setdefault("images", [])
    out["tips"] = [t for t in out.get("tips", []) if t]
    if not (out.get("deadline") or {}).get("date"):
        out["deadline"] = None
    out["endDate"] = end_date_of(out)
    return out


def check_fields(d, where):
    bad = sorted(set(d) - EDITABLE)
    if bad:
        raise EditError(f"{where}：這些欄位不能用修改單改：{', '.join(bad)}（限定連結／海報請到後台改）")
    if "kind" in d and d["kind"] not in KINDS:
        raise EditError(f"{where}：kind 只能是 {sorted(KINDS)}")
    for k in ("date", "until"):
        if d.get(k):
            try:
                datetime.strptime(d[k], "%Y-%m-%d")
            except ValueError:
                raise EditError(f"{where}：{k} 要寫成 2026-11-08 這種格式")


def matches(doc_id, e, m):
    for k, v in m.items():
        if k == "id":
            if doc_id != v:
                return False
        elif k == "titleContains":
            if v not in (e.get("title") or ""):
                return False
        elif e.get(k) != v:
            return False
    return True


# ---------- 套用（store 只要有 all() / set() / update() / delete()，方便測試） ----------
def plan(store, edit):
    """先全部檢查一遍、算出要寫什麼；有任何問題就整張不寫。"""
    docs = store.all()  # {id: data}
    steps = []
    for i, op in enumerate(edit.get("ops", []), 1):
        where = f"第 {i} 項"
        kind = op.get("op")
        if kind in ("update", "delete"):
            m = op.get("match") or {}
            if not m:
                raise EditError(f"{where}：缺 match")
            hit = [(i_, d) for i_, d in docs.items() if matches(i_, d, m)]
            if len(hit) != 1:
                desc = "、".join(f"{i_}（{d.get('date')} {d.get('title')}）" for i_, d in hit) or "沒有"
                raise EditError(f"{where}：條件 {json.dumps(m, ensure_ascii=False)} 要剛好對到 1 筆，現在對到：{desc}")
            doc_id, before = hit[0]
            if kind == "delete":
                steps.append({"op": "delete", "id": doc_id, "before": before})
                continue
            changes = op.get("set") or {}
            unset = op.get("unset") or []
            check_fields(changes, where)
            check_fields({k: "" for k in unset}, where)
            after = dict(before)
            after.update(changes)
            for k in unset:
                after.pop(k, None)
            after = clean_public(after)
            after["updatedAt"] = int(time.time() * 1000)
            steps.append({"op": "update", "id": doc_id, "before": before, "after": after})
        elif kind == "create":
            data = dict(op.get("data") or {})
            check_fields(data, where)
            k = data.get("kind")
            if not k or not data.get("title") or not data.get("date"):
                raise EditError(f"{where}：新增至少要有 kind、title、date")
            if k in ("series", "notice") and not data.get("until"):
                raise EditError(f"{where}：{k} 要有 until（顯示到哪天）")
            dup = [i_ for i_, d in docs.items()
                   if d.get("kind") == k and d.get("title") == data["title"] and d.get("date") == data["date"]]
            if dup:
                steps.append({"op": "skip", "reason": f"已經有一樣的資料（{dup[0]}），不重複新增"})
                continue
            full = dict(DEFAULTS.get(k, {}))
            full.update(data)
            after = clean_public(full)
            after["updatedAt"] = int(time.time() * 1000)
            steps.append({"op": "create", "id": new_id(k, data["date"]), "after": after})
        else:
            raise EditError(f"{where}：op 只能是 update / create / delete")
    return steps


def execute(store, steps):
    for s in steps:
        if s["op"] == "update":
            store.set(s["id"], s["after"])
        elif s["op"] == "create":
            store.create(s["id"], s["after"])
        elif s["op"] == "delete":
            store.delete(s["id"], s["before"])


# ---------- Firestore ----------
class FirestoreStore:
    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
        if not raw:
            raise EditError("找不到金鑰：GitHub Secret「FIREBASE_SERVICE_ACCOUNT」還沒設定")
        try:
            info = json.loads(raw)
        except json.JSONDecodeError:
            raise EditError("金鑰格式不對：Secret 要貼整份 JSON 檔的內容（從 { 到 }）")
        firebase_admin.initialize_app(credentials.Certificate(info))
        self.db = firestore.client()

    def all(self):
        return {d.id: d.to_dict() for d in self.db.collection("events").stream()}

    def set(self, doc_id, data):
        self.db.collection("events").document(doc_id).set(data)

    def create(self, doc_id, data):
        b = self.db.batch()
        b.set(self.db.collection("events").document(doc_id), data)
        b.set(self.db.collection("events_private").document(doc_id),
              {"signupUrl": "", "zoom": "", "flags": [], "announcement": ""})
        b.commit()

    def delete(self, doc_id, before):
        b = self.db.batch()
        for im in before.get("images") or []:
            b.delete(self.db.collection("images").document(im["id"]))
        b.delete(self.db.collection("events").document(doc_id))
        b.delete(self.db.collection("events_private").document(doc_id))
        b.commit()


# ---------- 輸出 ----------
def write_snapshot(store, out):
    docs = store.all()
    rows = sorted(({"id": i, **d} for i, d in docs.items()), key=lambda e: (e.get("date") or "", e.get("start") or ""))
    (out / "events.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    lines = [f"{e.get('date')}  {e.get('kind'):8}  {e.get('title')}  ｜{e.get('start') or ''}–{e.get('end') or ''}"
             f"  {e.get('location') or ''}  {('〔' + e['note'] + '〕') if e.get('note') else ''}  ({e['id']})"
             for e in rows]
    (out / "events.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(rows)


def main(argv):
    if len(argv) < 2 or argv[1] not in ("apply", "snapshot"):
        print(__doc__)
        return 2
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else Path("out")
    out.mkdir(parents=True, exist_ok=True)
    files = [a for a in argv[2:] if a.endswith(".json")]
    report = {"ranAt": datetime.now(TPE).strftime("%Y-%m-%d %H:%M（台北）"), "ok": True, "files": []}
    try:
        store = FirestoreStore()
        for f in files:
            entry = {"file": f}
            try:
                edit = json.loads(Path(f).read_text(encoding="utf-8"))
                entry.update(note=edit.get("note", ""), dryRun=bool(edit.get("dryRun")))
                steps = plan(store, edit)
                if not edit.get("dryRun"):
                    execute(store, steps)
                entry["steps"] = steps
                entry["ok"] = True
            except EditError as e:
                entry["ok"], entry["error"] = False, str(e)
                report["ok"] = False
            except Exception as e:  # 其他意外（檔案不見、JSON 寫錯）也要留紀錄
                entry["ok"], entry["error"] = False, f"{type(e).__name__}: {e}"
                report["ok"] = False
            report["files"].append(entry)
        report["eventCount"] = write_snapshot(store, out)
    except Exception as e:
        report["ok"], report["error"] = False, f"{type(e).__name__}: {e}" if not isinstance(e, EditError) else str(e)
    (out / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1, default=str))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
