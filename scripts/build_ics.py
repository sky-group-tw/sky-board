#!/usr/bin/env python3
"""從 Firestore 讀公開活動，產生 iPhone／Mac 用的行事曆檔。

輸出到 <out>/ics/：
  <活動id>.ics      單一活動（「加入行事曆」用）
  sky-calendar.ics  整份訂閱檔（小組聚會＋教會活動＋系列講道）

只讀 events 集合（公開欄位，安全規則允許任何人讀），不需要任何密碼或金鑰。
用法：python3 scripts/build_ics.py _site    （或 --json 本機檔案 測試用）
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT = "sky-group-46daa"
API_KEY = "AIzaSyAClZiXxiTXf9YBB3tjQSykVLwFAvsBa3Y"
SITE_URL = "https://sky-group-tw.github.io/sky-board/"
TPE = timezone(timedelta(hours=8))
CAL_NAME = "Sky 小組・The Hope 活動"


# ---------- 讀 Firestore（REST） ----------
def _val(v):
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return v["doubleValue"]
    if "booleanValue" in v: return v["booleanValue"]
    if "nullValue" in v: return None
    if "arrayValue" in v: return [_val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: _val(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "timestampValue" in v: return v["timestampValue"]
    return None


def fetch_events():
    events, token = [], None
    while True:
        url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/events"
               f"?pageSize=300&key={API_KEY}" + (f"&pageToken={token}" if token else ""))
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.load(r)
        for d in data.get("documents", []):
            e = {k: _val(v) for k, v in d.get("fields", {}).items()}
            e["id"] = d["name"].rsplit("/", 1)[-1]
            events.append(e)
        token = data.get("nextPageToken")
        if not token:
            return events


# ---------- ICS ----------
def esc(s):
    return (str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\n").replace("\n", "\\n"))


def fold(line):
    """RFC 5545：每行最多 75 bytes，超過就折行（不切斷中文字）。"""
    out, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        limit = 75 if not out else 74
        if len(cur) + len(b) > limit:
            out.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    out.append(cur.decode("utf-8"))
    return "\r\n ".join(out)


def utc(date, time, add_days=0):
    y, m, d = map(int, date.split("-"))
    hh, mm = map(int, (time or "00:00").split(":"))
    dt = datetime(y, m, d, hh, mm, tzinfo=TPE) + timedelta(days=add_days)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def dateval(date, add_days=0):
    y, m, d = map(int, date.split("-"))
    return (datetime(y, m, d) + timedelta(days=add_days)).strftime("%Y%m%d")


BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]


def vevent(e, stamp):
    kind = e.get("kind", "event")
    lines = ["BEGIN:VEVENT", f"UID:{e['id']}@sky-group-tw.github.io", f"DTSTAMP:{stamp}"]
    if kind == "series":
        lines.append(f"DTSTART;VALUE=DATE:{dateval(e['date'])}")
        lines.append(f"DTEND;VALUE=DATE:{dateval(e['date'], 1)}")
        until = e.get("until") or e["date"]
        wd = int(e.get("weekday") or 0)
        lines.append(f"RRULE:FREQ=WEEKLY;BYDAY={BYDAY[wd]};UNTIL={dateval(until)}")
    else:
        start, end = e.get("start") or "00:00", e.get("end") or "23:59"
        if e.get("endUnknown"):
            # 結束時間未公布：先抓 2 小時
            sh, sm = map(int, start.split(":"))
            end = f"{min(sh + 2, 23):02d}:{sm:02d}"
        lines.append(f"DTSTART:{utc(e['date'], start)}")
        lines.append(f"DTEND:{utc(e['date'], end, 1 if end <= start else 0)}")

    title = e.get("title", "")
    lines.append("SUMMARY:" + esc(title))
    loc = (e.get("location") or "") + ("，" + e["address"] if e.get("address") else "")
    if loc and kind != "series":
        lines.append("LOCATION:" + esc(loc))
    desc = []
    if e.get("audience"): desc.append("對象：" + e["audience"])
    if e.get("checkin"): desc.append(e["checkin"])
    if e.get("desc"): desc.append(e["desc"])
    if e.get("note"): desc.append(e["note"])
    if e.get("dressCode"): desc.append("Dress code：" + e["dressCode"])
    signup = e.get("signup") or {}
    if signup.get("url"):
        desc.append((signup.get("label") or "報名") + "：" + signup["url"])
    elif signup.get("public") is False and e.get("restrictedText"):
        desc.append(e["restrictedText"])
    if e.get("mapUrl"): desc.append("地圖：" + e["mapUrl"])
    desc.append("公布欄：" + SITE_URL)
    lines.append("DESCRIPTION:" + esc("\n\n".join(desc)))
    lines.append("URL:" + SITE_URL)
    lines.append("END:VEVENT")
    return lines


def calendar(events, stamp, name=None):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sky Group TW//Sky Board//ZH-TW", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    if name:
        lines += [f"X-WR-CALNAME:{esc(name)}", "X-WR-TIMEZONE:Asia/Taipei",
                  "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
    for e in events:
        lines += vevent(e, stamp)
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"


def main():
    args = sys.argv[1:]
    if args[:1] == ["--json"]:
        events = json.loads(Path(args[1]).read_text("utf-8"))
        out = Path(args[2])
    else:
        out = Path(args[0] if args else "_site")
        try:
            events = fetch_events()
        except Exception as x:  # noqa: BLE001
            code = getattr(x, "code", "")
            hint = "Firestore 安全規則還沒發布，或 events 沒開放公開讀取" if code == 403 else "網路或 Firestore 暫時有問題"
            print(f"::warning::讀不到 Firestore（{code or x}）：{hint}。這次不更新行事曆檔，網站照常部署。")
            sys.exit(1)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ics_dir = out / "ics"
    ics_dir.mkdir(parents=True, exist_ok=True)

    usable = [e for e in events if e.get("date") and e.get("status") != "tbd"]
    # 訂閱檔：最近 60 天內＋之後
    cutoff = (datetime.now(TPE) - timedelta(days=60)).strftime("%Y-%m-%d")
    feed = [e for e in usable if (e.get("endDate") or e["date"]) >= cutoff]
    feed.sort(key=lambda e: (e["date"], e.get("start") or ""))
    (ics_dir / "sky-calendar.ics").write_text(calendar(feed, stamp, CAL_NAME), "utf-8", newline="")

    n = 0
    for e in usable:
        if e.get("kind") == "series":
            continue
        (ics_dir / f"{e['id']}.ics").write_text(calendar([e], stamp), "utf-8", newline="")
        n += 1
    print(f"ics：單一活動 {n} 個，訂閱檔 {len(feed)} 個行程（共讀到 {len(events)} 筆）")


if __name__ == "__main__":
    main()
