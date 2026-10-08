# 資產脈動 Asset Pulse

個人資產盤點 PWA。每週挑一天，把各個帳戶的餘額填一次，看淨資產怎麼走。
資料全部存在**你自己的 Google Sheet** 裡 —— 哪天不想用這個 App 了，直接打開試算表繼續用就好。

支援的帳戶：銀行、期貨戶（填權益數）、虛擬貨幣交易所（USD 計價自動換算台幣）、
證券、現金、信用貸款（負債），以及預留給未來的房產／車輛。

---

## 架構

```
iPhone PWA (React + Vite，裝到主畫面)
      │  fetch /api/*（PIN 簽發的 token）
      ▼
Vercel Serverless Functions（Node 22）
      │  google-auth-library + Service Account
      ▼
Google Sheet（真正的資料庫）
```

Google 金鑰只存在 Vercel 環境變數，不會進到瀏覽器。
瀏覽器端用 IndexedDB 存最後一份資料，開 App 秒出畫面、離線也能看、離線也能盤點。

### Google Sheet 的四個分頁

| 分頁 | 內容 |
|---|---|
| `Accounts` | 帳戶主檔（名稱、類型、幣別、是否為負債、排序、狀態） |
| `Snapshots` | 每個帳戶每次盤點一列（原幣別金額、當次匯率、換算後台幣） |
| `Reviews` | 每次盤點一列（日期、匯率、資產／負債／淨資產合計） |
| `Settings` | `key` / `value` 兩欄的設定 |

讀取時以**分頁第一列的表頭為準**，所以你在 Sheet 上插入欄位、搬動欄位順序、
改大小寫，App 都還讀得懂。

**金額的唯一規則**：`amount` 永遠填正數（信貸填 `120000`，不是 `-120000`），
是資產還是負債由 `Accounts.is_liability` 決定，淨資產 = Σ資產 − Σ負債。

App 顯示的台幣值一律由 `amount × fx_rate` 現算，不直接相信 `amount_twd` 那一格 ——
這樣你在 Sheet 上手改金額，App 立刻就是對的。設定頁的「重新計算彙總」會把
Sheet 上的 `amount_twd` 與 `Reviews` 合計補成一致。

---

## 設定（只需要做一次）

### 1. 建立 Google Service Account

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建一個專案
2. 「API 和服務」→ 啟用 **Google Sheets API**
3. 「憑證」→ 建立憑證 → **服務帳戶** → 建好後進去「金鑰」→ 新增金鑰 → **JSON**
4. 下載的 JSON 裡會有 `client_email` 和 `private_key`，待會要用

### 2. 建立 Google Sheet

1. 開一份新的空白試算表
2. 右上角「共用」→ 把上一步的 `client_email` 加進去，權限選**編輯者**
3. 從網址抄下 ID：`https://docs.google.com/spreadsheets/d/<這一段就是 SHEET_ID>/edit`

分頁不用自己建 —— 第一次進 App 會有一個「幫我建立分頁」按鈕。

### 3. 環境變數

```bash
cp .env.example .env.local
npm run pin          # 產生 APP_PIN_HASH 與 AUTH_SECRET，貼進 .env.local
```

`.env.local` 需要五個值：

| 變數 | 來源 |
|---|---|
| `SHEET_ID` | 試算表網址 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | JSON 金鑰的 `client_email` |
| `GOOGLE_PRIVATE_KEY` | JSON 金鑰的 `private_key` |
| `APP_PIN_HASH` | `npm run pin` |
| `AUTH_SECRET` | `npm run pin` |

同一組值也要設到 Vercel 專案的 Environment Variables。

> **貼 `GOOGLE_PRIVATE_KEY` 時注意**
> `.env.local` 的值含換行，必須用雙引號包住；但 **Vercel 的輸入框是字面值，不要加引號** ——
> 加了的話引號會變成金鑰的一部分，Google 會回 `error:1E08010C:DECODER routines::unsupported`。
> 程式會自動去掉外層引號、還原 `\n`，所以兩種貼法其實都救得回來；真的壞掉時，
> PIN 畫面會逐項列出是哪個環境變數有問題，而不是丟 OpenSSL 的原始錯誤給你。

---

## 開發

```bash
nvm use              # 讀 .nvmrc → Node 22
npm install
npx vercel dev       # 前端 + /api 一起跑
```

只跑前端（API 會 404）：`npm run dev`

在 iPhone 實機測試：手機連同一個 Wi-Fi，用 `npx vercel dev --listen 0.0.0.0:3000`，
然後在手機瀏覽器開 `http://<你的電腦區網 IP>:3000`。

| 指令 | 作用 |
|---|---|
| `npm run check:google` | **連線診斷**：拿 `.env.local` 真的去連一次 Google，逐項檢查金鑰格式、認證、試算表讀寫權限 |
| `npm test` | 單元測試 + 畫面 smoke test |
| `npm run typecheck` | TypeScript 檢查 |
| `npm run build` | 正式建置（含 PWA service worker） |
| `npm run icons` | 重新產生 PWA 圖示 |
| `npm run pin` | 產生新的 PIN hash |

---

## 部署

推到 GitHub 後在 Vercel 匯入這個 repo，填好五個環境變數即可。
Vercel 會自動辨識 Vite，`api/` 下的檔案自動成為 serverless function。

部署完在 iPhone Safari 開啟 → 分享 → **加入主畫面**。
之後它就是全螢幕的獨立 App，底部導覽列會避開 home indicator。

---

## 離線行為

- **讀**：開 App 先畫 IndexedDB 裡的上一份資料，同時在背景抓新的
- **寫**：飛航模式下照樣可以走完整個盤點流程，送出時會進待送佇列；
  恢復連線自動補送，設定頁可以看到佇列狀態、手動重試或捨棄
- 同一天重複送出會被擋下（回 409），所以佇列重送不會寫出兩筆

---

## 專案結構

```
shared/       前後端共用：資料模型、金額計算、Sheet 列 ⇄ 物件、盤點組裝（有測試）
api/          Vercel serverless functions
  _lib/       Sheets 存取、PIN/token、HTTP 錯誤處理、repository
src/
  routes/     Dashboard / Accounts / Review / History / Settings / Unlock
  components/ UI 元件與三張圖表
  lib/        API client、IndexedDB、衍生數字、格式化、色票
  hooks/      TanStack Query 的 query 與 mutation
```

圖表配色沿用一組經過色盲模擬驗證的八色分類色票（亮色與暗色各自選步階，
不是直接翻轉）。分類色綁定「帳戶類型」而不是排名，所以銀行永遠是同一個顏色。
漲跌同時用箭頭、正負號與顏色三重編碼，每張圖都有對應的表格檢視。
