#!/usr/bin/env python3
"""部署後自動檢查：打開正式網站（手機＋電腦尺寸），截圖並檢查有沒有錯誤。

結果寫到 <out>/：desktop.png、mobile.png、result.json
有錯誤時 exit 1（GitHub Actions 會顯示紅色）。
"""
import asyncio
import json
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

URL = "https://sky-group-tw.github.io/sky-board/"


async def check(browser, name, viewport, scale, out):
    errors = []
    ctx = await browser.new_context(viewport=viewport, device_scale_factor=scale, locale="zh-TW",
                                    timezone_id="Asia/Taipei")
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append("頁面錯誤：" + str(e)))
    page.on("console", lambda m: errors.append("主控台：" + m.text) if m.type == "error" else None)
    page.on("requestfailed", lambda r: errors.append("載入失敗：" + r.url[:120]))
    await page.goto(URL + "?t=" + str(int(time.time())), wait_until="load", timeout=60000)
    # Firestore 會一直保持連線，所以不能等「網路安靜」；改成等畫面出現活動或提示
    try:
        await page.wait_for_function("document.querySelector('#board-view .card, #board-view .meet, #board-view .empty:not(:empty)') && !document.querySelector('#board-view').innerText.includes('載入中')", timeout=30000)
    except Exception:
        errors.append("30 秒內公布欄沒有出現內容")
    await page.wait_for_timeout(4000)  # 等海報
    info = await page.evaluate("""() => ({
      title: document.title,
      cards: document.querySelectorAll('#board-view .card').length,
      meetings: document.querySelectorAll('#board-view .meet').length,
      imagesTotal: document.querySelectorAll('#board-view img[data-img]').length,
      imagesLoaded: [...document.querySelectorAll('#board-view img[data-img]')].filter(i => i.complete && i.naturalWidth > 0).length,
      boardText: (document.getElementById('board-view').innerText || '').slice(0, 200)
    })""")
    ics = await page.evaluate("fetch('ics/sky-calendar.ics',{cache:'no-store'}).then(r => r.status)")
    info["subscribeFeedStatus"] = ics
    await page.screenshot(path=str(out / f"{name}.png"), full_page=True)
    await ctx.close()
    if "載入不了" in info["boardText"]:
        errors.append("公布欄顯示「活動資料暫時載入不了」")
    if info["cards"] + info["meetings"] == 0 and "沒有即將舉行" not in info["boardText"]:
        errors.append("公布欄沒有任何活動或聚會")
    if info["imagesLoaded"] < info["imagesTotal"]:
        errors.append(f"海報只載入 {info['imagesLoaded']}/{info['imagesTotal']} 張")
    if ics != 200:
        errors.append(f"訂閱行事曆檔回應 {ics}")
    info["errors"] = errors
    return info


async def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "checks")
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        result = {"checkedAt": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)) + "（台北）"}
        for name, vp, sc in [("desktop", {"width": 1280, "height": 900}, 1), ("mobile", {"width": 390, "height": 844}, 2)]:
            try:
                result[name] = await check(b, name, vp, sc, out)
            except Exception as x:  # noqa: BLE001
                result[name] = {"errors": ["檢查程式出錯：" + str(x)[:300]]}
        await b.close()
    ok = not result["desktop"]["errors"] and not result["mobile"]["errors"]
    result["ok"] = ok
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
