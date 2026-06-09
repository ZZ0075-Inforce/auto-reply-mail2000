# Mail2000 AI 自動回覆 — Tampermonkey 使用者腳本

在 Mail2000（Openfind）webmail 的回信編輯器注入「💡 AI 生成回覆」按鈕。開啟一封信並按「回信」後，點該按鈕即可讀取原信內容、依主旨規則套用對應的 system prompt，呼叫可切換的 LLM（OpenAI / Anthropic / Gemini，或你自架的**本機**相容服務）生成繁體中文回覆草稿並寫入內文。

> **安全原則：腳本永遠不會自動送信。** 草稿生成後一律由你檢視、修改，並親自按「傳送」送出。

相關文件：`Mail2000_AutoReply_Tampermonkey_規格書.md`（完整 DOM 結構與設計規格）。

---

## 安裝

1. 在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/) 擴充套件。
2. 安裝腳本（擇一）：
   - **GitHub raw（建議，可自動更新）**：把 `dist/mail2000-ai-reply.user.js` push 到 GitHub 後，點 `@updateURL` 指向的 raw 連結，Tampermonkey 會跳出安裝畫面。之後升版會自動更新（見「開發與維護」）。
   - **本機檔案**：把 `dist/mail2000-ai-reply.user.js` 拖入瀏覽器，Tampermonkey 會跳出安裝畫面。
3. 確認腳本已啟用，且 Tampermonkey 允許跨網域請求（首次呼叫 API 時會詢問，請允許對應網域）。

> 安裝的是**建置產物** `dist/mail2000-ai-reply.user.js`，不是 `src-userscript/` 裡的原始模組。

預設比對網域為 `https://mail.inforce.com.tw/*`。若你的 Mail2000 網域不同，請修改 `src-userscript/header.meta.js` 的 `@match` 後重新 build。

---

## 設定面板

兩種開啟方式：

- Mail2000 頁面上，Tampermonkey 選單 →「AI 回覆設定」。
- 進入回信編輯器後，工具列「💡 AI 生成回覆」旁的「⚙」按鈕（按鈕位於「信件範本」左邊）。

面板分三個分頁，**所有變更即時自動儲存**（沒有「儲存」按鈕，調整完關閉即可）；右上角可切換深／淺色（預設跟隨系統）。

### ① 供應商

左側是供應商清單（內建 OpenAI / Anthropic / Gemini ＋ 你新增的自訂供應商），右側是選中供應商的設定。點供應商卡上的「設為使用中」即**立刻**切換成生成回覆要用的供應商（清單與標題會以該供應商品牌色標示）。

每個供應商各自記住自己的 **API Key** 與 **模型**（per-provider）：

| 內建供應商 | 預設模型 | Endpoint |
|---|---|---|
| OpenAI | `gpt-4o-mini` | `api.openai.com/v1/chat/completions` |
| Anthropic | `claude-3-5-sonnet-latest` | `api.anthropic.com/v1/messages` |
| Gemini | `gemini-1.5-flash` | `generativelanguage.googleapis.com` |

- **API Key**：可按眼睛圖示顯示／隱藏；只存在本機 Tampermonkey。
- **模型**：可手填；OpenAI 與自訂供應商可按「🔄 測試並抓取模型」從 API 取得清單後選取；留空則用該供應商預設模型。

### ② 回覆

- **預設 System Prompt**：沒有任何主旨規則命中時套用。
- **主旨規則**：依主旨套用不同 System Prompt（見下節），可摺疊、新增、刪除。

### ③ 進階

- **原信內文長度上限**：送進 LLM 的內文字元上限（預設 6000，超過截斷）。
- **除錯模式**：在 console 輸出診斷訊息。
- **關於**：版本與安全承諾。

---

## 自訂本機 LLM 供應商

除了內建三家，可在「供應商」分頁點「＋ 新增自訂供應商」接上**本機**的 OpenAI／Anthropic／Gemini 相容服務（例如 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)、Ollama、LM Studio）。

| 欄位 | 說明 |
|---|---|
| 顯示名稱 | 清單上的名稱 |
| 相容協定 | `openai` / `anthropic` / `gemini`，決定請求格式（wire format） |
| Base URL | 服務位址，**僅限 `localhost` / `127.0.0.1`**（例：`http://localhost:51121`）；填到 host:port、不含 `/v1` |
| API Key | 本機服務常可留空 |
| 預設模型 | 主模型欄留空時套用 |

- 按「🔄 測試並抓取模型」會以你填的 Base URL 打 `GET {baseUrl}/v1/models`（OpenAI 相容）取得可用模型清單供選。
- **安全考量**：自訂供應商**只允許本機位址**；填入非本機 URL 會被即時擋下（`@connect` 僅放寬 `localhost` / `127.0.0.1`）。若要連區網／雲端，需自行修改 `src-userscript/header.meta.js` 的 `@connect`（及 build 內 dev-loader 的 `@connect`）後重新 build。

---

## 依主旨套用不同 System Prompt

在設定面板「回覆」分頁的「主旨規則」可新增多條規則，每條規則包含：

- **啟用**：是否生效。
- **規則名稱**：方便辨識。
- **比對方式**：`contains`（包含）／`startsWith`（開頭）／`regex`（正規表示式）。
- **比對字串**：要比對的關鍵字或 regex。
- **System Prompt**：命中此規則時使用的提示詞。

判定邏輯：取原信主旨（自動去除開頭的 `Re:`／`Fw:`），由上而下逐條比對，**第一個命中的規則生效**；都沒命中則用「預設 System Prompt」。生成前會以提示顯示本次套用的規則。

範例：

| 名稱 | 比對方式 | 比對字串 | 用途 |
|---|---|---|---|
| 請假類 | contains | `請假` | 以主管核示語氣回覆 |
| 報價詢問 | regex | `報價|詢價|quote` | 以業務口吻回覆並提醒附報價單 |

---

## 使用流程

1. 開啟一封信（內容載入閱讀窗格）。
2. 點工具列「回信」→ 編輯器自動帶入收件人、`Re:` 主旨與引用原文。
3. 點「💡 AI 生成回覆」（位於「信件範本」左邊）。生成期間按鈕會顯示計時，請稍候（最長 60 秒）。
4. 腳本擷取原信主旨/寄件人/內文 → 選 system prompt → 呼叫**目前使用中**的供應商 → 把回覆插入內文（在引用原文之前）。
5. **檢視、修改後，自行按「傳送」送出。**

---

## 運作原理（摘要）

- Mail2000 為同源巢狀 frameset：`top → m2k → { msgIframe 讀信, ifrmCompose 回信 }`。
- 讀信內容取自 `msgIframe`（`/cgi-bin/msg_read`）的 `#mail_header_data`（主旨）與 `X-HTML` 內文元素。
- 回信內文寫入 `ifrmCompose`（`/cgi-bin/genMail`）的 contentEditable 編輯器 `iframe#mailHtml`，並呼叫頁面的 `SyncEditorContent()` 同步。
- 設定面板（modal）與提示一律掛在頂層 document，避免被 iframe 裁切。
- LLM 請求一律走 `GM_xmlhttpRequest`，繞過頁面 CORS/CSP；對應網域宣告於 `@connect`（三家雲端 + `localhost` / `127.0.0.1`）。

詳見規格書。

---

## 隱私與安全

- **絕不自動送信**：腳本不會呼叫 `HandleBtnSend()`，也不會提交回信表單。
- API Key 僅儲存在本機 Tampermonkey（`GM_setValue`），不寫入網址、不隨信件送出、不寫入 log。
- 信件內容僅送往你設定的 LLM API endpoint（雲端供應商，或你自架的本機服務）。
- 自訂供應商**只允許本機位址**（`localhost` / `127.0.0.1`），非本機 URL 會被擋下。
- 不蒐集帳號 session token，不上傳信件以外的資料。
- 信件內容會送到第三方 LLM 供應商，請依貴公司資安政策評估是否適用；對機敏內容可改用本機自架模型（自訂供應商）。

---

## 疑難排解

| 狀況 | 處理 |
|---|---|
| 沒看到按鈕 | 確認在「回信」編輯器中；腳本以 MutationObserver 等待工具列出現（最多 30 秒） |
| 「尚未設定 API Key」 | 開啟設定、選對應供應商填入 Key（自訂本機供應商可留空） |
| 「讀不到原信內容」 | 先開啟原信再按回信 |
| `HTTP 401/403` | API Key 無效或無權限 |
| `網路錯誤` | 確認 Tampermonkey 已允許 `@connect` 網域、網路可連外 |
| 自訂供應商連線／抓取模型失敗 | 確認本機服務已啟動、Base URL（host:port）正確、首次連線時於 Tampermonkey 允許該 `localhost` 連線 |
| Base URL 紅框、無法「設為使用中」 | 自訂供應商只允許 `localhost` / `127.0.0.1`，請改填本機位址 |
| 回覆格式怪異 | 調整 system prompt，或切換模型 |

---

## 開發與維護

### 專案結構

原始碼拆成多個職責單一的小模組（**裸宣告，無各自 IIFE**）；build 時在 metadata header 後注入單一共享 IIFE，依清單順序串接成單檔。所有模組共享同一函式 scope，`boot.js` 末行的 `boot()` 在所有宣告之後啟動。

```
src-userscript/        ← 原始模組（裸宣告；build 注入共享 IIFE 串接）
  header.meta.js       ← UserScript metadata（@match / @grant / @connect / @updateURL）
  constants.js         ← 常數：STORAGE_KEY / PROVIDERS / DEFAULT_CONFIG（含 customProviders / models）
  config-store.js      ← 設定儲存：loadConfig / saveConfig（含 per-provider model 遷移）
  utils.js             ← 工具：log / escapeHtml / textToHtml / stripRePrefix / topDoc / toast
  frame-utils.js       ← Frame 存取：getM2k / getMsgWin / getComposeWin / isComposeFrame
  mail-extract.js      ← 擷取原信：extractOriginalMail
  rules.js             ← 主旨規則：pickRule / pickSystemPrompt
  llm-adapter.js       ← LLM 呼叫：resolveProvider / buildRequestSpec / callLLM / fetchModels
  insert-reply.js      ← 寫入回信編輯器：insertReply
  generate.js          ← 生成流程：generateReply（含 loading 計時）
  settings-style.js    ← 設定面板樣式：ensureSettingsStyle（注入 scoped CSS）
  settings-ui.js       ← 設定面板：openSettings（master-detail + autosave + per-provider model）
  button-injector.js   ← 按鈕注入：makeToolbarButton / injectComposeButtons
  boot.js              ← 啟動：boot()（末行呼叫 boot()，務必排在 BODY_MODULES 最後）
build-userscript.py    ← 戳版號 + 注入共享 IIFE + 依 BODY_MODULES 串接 → dist 單檔，並產生 dev-loader
dist/
  mail2000-ai-reply.user.js ← 建置產物（commit 進 repo，供 GitHub raw 安裝）
  dev-loader.user.js        ← 本機開發用 loader（.gitignore，不 commit）
```

> 要新增 / 調整模組：在 `build-userscript.py` 的 `BODY_MODULES` 清單增改檔名即可，順序即載入順序（`boot.js` 須最後）。設定面板樣式（`settings-style.js`）以 `m2kai-` 前綴的 scoped CSS 注入頂層 document，取代 inline style，以支援 hover／動效／深淺主題。

### 建置

```bash
python build-userscript.py            # build 一次
python build-userscript.py --watch    # 監看 src 變動自動重 build
node --check dist/mail2000-ai-reply.user.js   # 語法驗證
```

每次 build 會把 `@version` 戳成 `1.0.{YYYYMMDDhhmm}`，確保 Tampermonkey 偵測到升版。

### 本機開發（免重裝、熱重載）

正式 deploy 走 GitHub raw（`@updateURL`），改一行也要 push+等 CDN，太慢。開發期改用 dev-loader：

1. **Chrome**：`chrome://extensions` → Tampermonkey →「詳細資料」→ 開啟「允許存取檔案網址 / Allow access to file URLs」。
2. **Tampermonkey**：設定 → 進階 → 「外部 @require 更新間隔」設為「總是 / Always（0）」（否則 file:// 內容被 cache）。
3. 把 `dist/dev-loader.user.js` 拖進 Tampermonkey 安裝，並**停用正式版那支**避免雙重注入。
4. 之後 `python build-userscript.py`（或 `--watch`）→ 瀏覽器 F5 即生效，全程不碰 git。

> ⚠️ dev-loader 與正式版是兩支不同 script，`GM_setValue` 資料各自獨立；開發期設的 API Key / 規則不會帶到正式版。

### 自動更新

`header.meta.js` 的 `@updateURL` / `@downloadURL` 指向 `https://raw.githubusercontent.com/ZZ0075-Inforce/auto-reply-mail2000/main/dist/mail2000-ai-reply.user.js`。把 `dist/` push 到 `main` 後，Tampermonkey 約每 24h 檢查一次並自動拉新版（前提是 `@version` 有往上加，build 會自動戳）。

> ℹ️ 自動更新需此 repo 為 public，raw URL 才對終端使用者可達。若改用其他 repo / branch，修改 `header.meta.js`（與 build 內 dev-loader 的 `@namespace`）後重新 build 即可。

### 改版後最小驗證清單

1. `python build-userscript.py` 且 `node --check dist/...` 通過。
2. 開一封信 → 回信 → 確認「💡 AI 生成回覆」按鈕出現在「信件範本」左邊、「⚙」可開設定面板。
3. 設定面板：切三個 Tab、master-detail 切換供應商、「設為使用中」即時生效、新增自訂本機供應商 → 測試並抓取模型 → 選取；改任一欄位關閉重開仍在（autosave）。
4. 跑一封測試信，確認內容寫入且**沒有自動送出**。
5. 若 Mail2000 改版導致失效，依 `Mail2000_AutoReply_Tampermonkey_規格書.md` 重新核對選擇器（frame 名稱、`#mailHtml`、`#TemplateMenu`、`mail_header_data` 屬性）。

---

## 版本

- v1.0.0 — 首版：按鈕注入、設定面板、主旨規則、三家 LLM adapter、端到端生成流程。
- 建置流程改為模組化（`src-userscript/` + `build-userscript.py`）、加入 GitHub 自動更新與 dev-loader。
- 重構：`app.js` 拆成多個職責單一的裸宣告模組，build 改為注入單一共享 IIFE 串接。
- 自訂本機 LLM 供應商（OpenAI/Anthropic/Gemini 相容）+ 從 `/v1/models` 抓取模型；主按鈕圖示改 💡、移到「信件範本」左邊；生成時按鈕 loading 計時。
- 設定面板重新設計：三 Tab（供應商 / 回覆 / 進階）+ master-detail 供應商管理 + 全部 autosave + per-provider 模型/Key；注入 scoped CSS（`settings-style.js`）取代 inline style，支援深淺主題。
