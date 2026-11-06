# Sky 小組・教會活動公布欄

網址：https://sky-group-tw.github.io/sky-board/
（分享到 LINE 用後台的「複製分享連結」，會自動加 `?openExternalBrowser=1`）

## 日常怎麼用
- 打開網址 → 右上角「後台」→ Email＋密碼登入
- 新增／編輯／刪除活動、上傳海報、複製原始公告、複製小組時間，都在後台
- 存檔後公布欄**立刻**更新；iPhone 行事曆檔（.ics）**最慢一小時**更新
- 想立刻更新 iPhone 行事曆：GitHub → Actions → Deploy board → Run workflow

## 架構
| 東西 | 放哪 |
|---|---|
| 網頁程式 | 這個儲存庫，GitHub Pages 發布 |
| 活動資料、海報 | Firebase 專案 `sky-group-46daa` 的 Firestore |
| 登入 | Firebase Authentication（只開 Email／密碼） |
| iPhone 行事曆檔 | GitHub Actions 每小時從 Firestore 讀公開資料產生 `ics/` |

Firestore 集合：
- `events/{id}` 公開欄位，任何人可讀
- `events_private/{id}` 限定報名連結、Zoom、待確認事項、原始公告，只有管理者可讀寫
- `images/{id}` 壓縮後的海報（data URL），任何人可讀

安全規則在 `firestore.rules`，改了之後要貼到 Firebase 主控台 → Firestore → 規則 → 發布。

## 檔案
- `index.html`、`css/site.css`：版面（方向 A，跟 The Hope 官網一致）
- `js/app.js` 進入點、`js/board.js` 公開版、`js/admin.js` 後台、`js/store.js` Firebase、`js/model.js` 資料規則
- `scripts/build_ics.py` 產生行事曆檔
- `.github/workflows/pages.yml` 部署＋每小時排程

## 注意
- 公開儲存庫：**不要**把含報名連結／Zoom 的匯入檔或備份檔放進來
- GitHub 對公開儲存庫的排程：60 天沒有任何 commit 會自動暫停，收到通知信時到 Actions 按 Enable 即可
