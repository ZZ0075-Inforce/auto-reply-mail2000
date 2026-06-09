# Mail2000 AI 自動回覆 — Tampermonkey 使用者腳本

在 Mail2000（Openfind）webmail 的回信編輯器注入「🤖 AI 生成回覆」按鈕。開啟一封信並按「回信」後，點該按鈕即可讀取原信內容、依主旨規則套用對應的 system prompt，呼叫可切換的 LLM（OpenAI / Anthropic / Gemini）生成繁體中文回覆草稿並寫入內文。

> **安全原則：腳本永遠不會自動送信。** 草稿生成後一律由你檢視、修改，並親自按「傳送」送出。

相關文件：`Mail2000_AutoReply_Tampermonkey_規格書.md`（完整 DOM 結構與設計規格）。

---

## 安裝

1. 在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/) 擴充套件。
2. 開啟 Tampermonkey → 「建立新腳本」。
3. 將 `mail2000-ai-reply.user.js` 的內容整個貼上，存檔（Ctrl+S）。
   - 或：把 `.user.js` 檔拖入瀏覽器，Tampermonkey 會跳出安裝畫面。
4. 確認腳本已啟用，且 Tampermonkey 允許跨網域請求（首次呼叫 API 時會詢問，請允許對應網域）。

預設比對網域為 `https://mail.inforce.com.tw/*`。若你的 Mail2000 網域不同，請修改腳本開頭的 `@match`。

---

## 首次設定

開啟設定面板的兩種方式：

- Mail2000 頁面上，Tampermonkey 選單 →「AI 回覆設定」。
- 進入回信編輯器後，工具列上的「⚙」按鈕。

設定項目：

| 項目 | 說明 |
|---|---|
| LLM 供應商 | OpenAI / Anthropic / Gemini，可隨時切換 |
| 模型 | 留空則用該供應商預設模型（見下表） |
| API Key | 各供應商分別儲存，只存在本機 Tampermonkey |
| 預設 System Prompt | 沒有規則命中時使用 |
| 原信內文長度上限 | 送進 LLM 的內文字元上限（預設 6000） |
| 主旨規則 | 依主旨套用不同 system prompt（見下節） |
| 除錯模式 | 在 console 輸出診斷訊息 |

預設模型：

| 供應商 | 預設模型 | Endpoint |
|---|---|---|
| OpenAI | `gpt-4o-mini` | `api.openai.com/v1/chat/completions` |
| Anthropic | `claude-3-5-sonnet-latest` | `api.anthropic.com/v1/messages` |
| Gemini | `gemini-1.5-flash` | `generativelanguage.googleapis.com` |

> 模型名稱可在設定的「模型」欄自行覆蓋，請填入你的帳號實際可用的模型。

---

## 依主旨套用不同 System Prompt

在設定面板的「主旨規則」可新增多條規則，每條規則包含：

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
3. 點「🤖 AI 生成回覆」。
4. 腳本擷取原信主旨/寄件人/內文 → 選 system prompt → 呼叫 LLM → 把回覆插入內文（在引用原文之前）。
5. **檢視、修改後，自行按「傳送」送出。**

---

## 運作原理（摘要）

- Mail2000 為同源巢狀 frameset：`top → m2k → { msgIframe 讀信, ifrmCompose 回信 }`。
- 讀信內容取自 `msgIframe`（`/cgi-bin/msg_read`）的 `#mail_header_data`（主旨）與 `X-HTML` 內文元素。
- 回信內文寫入 `ifrmCompose`（`/cgi-bin/genMail`）的 contentEditable 編輯器 `iframe#mailHtml`，並呼叫頁面的 `SyncEditorContent()` 同步。
- LLM 請求一律走 `GM_xmlhttpRequest`，繞過頁面 CORS/CSP；對應網域已宣告於 `@connect`。

詳見規格書。

---

## 隱私與安全

- **絕不自動送信**：腳本不會呼叫 `HandleBtnSend()`，也不會提交回信表單。
- API Key 僅儲存在本機 Tampermonkey（`GM_setValue`），不寫入網址、不隨信件送出、不寫入 log。
- 信件內容僅送往你設定的 LLM API endpoint。
- 不蒐集帳號 session token，不上傳信件以外的資料。
- 信件內容會送到第三方 LLM 供應商，請依貴公司資安政策評估是否適用，必要時改用內部/自架模型 endpoint。

---

## 疑難排解

| 狀況 | 處理 |
|---|---|
| 沒看到按鈕 | 確認在「回信」編輯器中；腳本以 MutationObserver 等待工具列出現（最多 30 秒） |
| 「尚未設定 API Key」 | 開啟設定填入對應供應商的 Key |
| 「讀不到原信內容」 | 先開啟原信再按回信 |
| `HTTP 401/403` | API Key 無效或無權限 |
| `網路錯誤` | 確認 Tampermonkey 已允許 `@connect` 網域、網路可連外 |
| 回覆格式怪異 | 調整 system prompt，或切換模型 |

---

## 版本

- v1.0.0 — 首版：按鈕注入、設定面板、主旨規則、三家 LLM adapter、端到端生成流程。
