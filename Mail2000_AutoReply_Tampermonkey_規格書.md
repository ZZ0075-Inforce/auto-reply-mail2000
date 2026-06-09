# Mail2000 AI 自動回信 Tampermonkey 外掛 — 開發規格書

> 版本：v1.0 ／ 日期：2026-06-09
> 目標讀者：負責實作 Tampermonkey 使用者腳本的開發者
> 本規格書中所有 DOM 結構均由實際操作 Mail2000（Openfind）網頁介面解析取得；網址中的 session token、帳號與第三人 email 已一律以佔位符表示。

---

## 1. 專案目標

在 Mail2000 webmail 介面中，透過 Tampermonkey 使用者腳本注入一個「AI 生成回覆」按鈕。使用者開啟一封信並按「回信」後，點擊該按鈕即可：

1. 自動擷取原信的主旨、寄件人與內文。
2. 依「主旨關鍵字 → 對應 system prompt」規則挑選提示詞。
3. 呼叫可切換的 LLM API（OpenAI / Anthropic / Gemini）生成回覆草稿。
4. 將生成內容寫入回信編輯器（置於引用原文之前）。

**重要安全原則：腳本一律不得自動點擊「傳送」。** 一律由使用者人工檢視、編輯後自行送出。腳本最多只能寫入內文，不得呼叫 `HandleBtnSend()` 或提交 `composeform`。

---

## 2. 環境與整體架構

### 2.1 網域與頁面

| 項目 | 值 |
|---|---|
| 網域 | `https://mail.inforce.com.tw`（單一 origin，所有 frame 同源） |
| 主框架頁 | `/cgi-bin/start?m=<session>&wrap=1`，title：`Mail2000電子信箱--<account>` |
| 登入頁 | `/cgi-bin/login` |
| 系統 | Openfind Mail2000 Message System |

### 2.2 Frame 階層（關鍵）

整個應用是巢狀 frameset。所有 frame **同源**，因此可從上層 `window.frames` 直接穿透存取，無跨域限制。

```
top (/cgi-bin/start)
└─ frame name="m2k"  (/cgi-bin/submenu)   ← App 主體：資料夾樹、信件清單、閱讀窗格標頭
   ├─ iframe name="ifrmFormSubmit" (/blank.html)   隱藏送出輔助
   ├─ iframe name="msgIframe"      (/cgi-bin/msg_read)  ★ 讀信內文與中繼資料
   ├─ iframe name="halfIframe"     (/blank.html)   預覽窗格輔助
   ├─ iframe name="fullIframe"     (/fi_restore.html)   全螢幕檢視輔助
   ├─ iframe name="ifrmCompose"    (/cgi-bin/genMail)   ★ 寫信／回信編輯器
   └─ iframe name="ifrmSearch"     (/cgi-bin/submenu)   搜尋
```

存取捷徑（從 top 視窗）：

```js
const m2k     = window.top.frames['m2k'];                 // App 主體
const msgWin  = m2k.frames['msgIframe'];                  // 讀信內容
const cmpWin  = m2k.frames['ifrmCompose'];                // 回信編輯器
```

> `msgIframe`、`ifrmCompose` 在使用者實際開信／回信後才會由 `/blank.html` 動態導向到 `/cgi-bin/msg_read`、`/cgi-bin/genMail`。腳本必須等到它們載入後才能存取，建議用 MutationObserver 或輪詢偵測（見 §6）。

---

## 3. 讀信畫面（msgIframe ＝ /cgi-bin/msg_read）

信件內文與結構化中繼資料都在 `msgIframe` 文件中。

### 3.1 內文

- `msgIframe.document.body`（class `MRFrame font_size_12`）內含一個自訂元素 `<X-HTML-XXXXXXXX>` 包住原信渲染後的 HTML。
- 取純文字內文：`msgIframe.document.body.innerText`
- 取 HTML 內文：找到 `body > [tagName^="X-HTML"]` 的 `innerHTML`。

### 3.2 結構化中繼資料（建議優先採用，比抓畫面穩定）

`msgIframe.document` 內有數個 `<X-M2K-META>` 自訂元素，資料存放在**屬性**中（非 textContent）：

**`#mail_header_data`** — 信件標頭

| 屬性 | 意義 |
|---|---|
| `i_szsubject` | 主旨 |
| `i_szdate` | 日期 |
| `l_from` | 寄件人（子節點/清單形式） |
| `l_to` | 收件人（子節點/清單形式） |

**`#mail_data`** — 信件與工作階段參數（呼叫後端 API 時需要）

| 屬性 | 意義 |
|---|---|
| `i_szmsgid` | 信件 ID |
| `i_szmbox` | 信匣代碼 |
| `i_ntfid` | 資料夾 ID |
| `i_ncrumb` | CSRF crumb（後端請求防偽 token） |
| `i_sznick` | 使用者暱稱 |
| `i_szsorttype` / `i_nviewtype` | 排序／檢視模式 |
| `i_b*`（多個） | 各種布林旗標（簽章、追蹤、純文字模式等） |
| `data-nonce` | nonce |

**`#mail_tag_data`** — 標籤資料

> 取主旨範例：
> ```js
> const subject = msgWin.document.getElementById('mail_header_data')
>                       ?.getAttribute('i_szsubject') || '';
> ```

---

## 4. 信件清單畫面（在 m2k 文件內）

清單直接渲染於 `m2k` 文件，使用 ListView 元件，id 前綴 `lvMsgList`。回信流程本身不需要清單，但批次／自動化情境會用到。

| 元素 | 選擇器 |
|---|---|
| ListView 容器 | `#lvMsgList` |
| 表單 | `#lvMsgList_eform` |
| 表格 | `#lvMsgList_etable` |
| 第 i 列 | `#lvMsgList_er_{i}`（i = 0..N） |
| 第 i 列第 col 格 | `#lvMsgList_ec_{i}_{col}` |
| 主旨格 class | `ML_Subject` |
| 旗標格 class | `ML_FlagImages` |

- 資料欄與間隔欄交錯排列（`ec_{i}_0`、`ec_{i}_1` … 中間夾無 id 的間隔 `<td>`）。欄位順序：旗標／附件／勾選框／主旨／大小／寄件人／日期。
- 資料夾樹：`a.TreeNode`，當前選取為 `a.TreeNode.ActiveTreeNode`，文字如 `收信匣(24/78)`。
- 點主旨格會開信，將內容載入 `msgIframe`；標頭格帶有 `MsgFuncObj.ShowHeaderWin()`。

---

## 5. 回信／寫信編輯器（ifrmCompose ＝ /cgi-bin/genMail）★ 注入目標

按「回信」後，編輯器載入 `ifrmCompose`，並自動帶入收件人、`Re: ` 主旨與引用原文。

### 5.1 表單與欄位

| 用途 | 選擇器 | 備註 |
|---|---|---|
| 主表單 | `form[name="composeform"]` | action：`/cgi-bin/mailSend`（**腳本勿提交**） |
| 寄件人 | `#FromText` | |
| 收件人 | `textarea#ToText`（name `tox`） | 回信時已自動帶入 |
| 副本 CC | `textarea#CcText`（name `ccx`） | |
| 密件 BCC | `textarea#BccText`（name `bccx`） | |
| 主旨 | `input#mailSubject`（name `mailSubject`） | 已自動帶 `Re: <原主旨>` |
| **內文編輯器** | `iframe#mailHtml`（class `EditorArea`） | body 為 `contentEditable=true`，已含引用原文 |
| 內文同步隱藏欄位 | `textarea#mailText`（name `mailText`） | 送出/預覽前由系統同步 |
| 編輯器模式切換 | `HTML編輯` / `純文字編輯` 下拉 | |

### 5.2 內文寫入方式

內文編輯器是一個 contentEditable 的 iframe：

```js
const editorDoc = cmpWin.document.getElementById('mailHtml').contentDocument;
// editorDoc.body.isContentEditable === true
// editorDoc.body 內已有「-----Original message-----」引用原文
```

寫入策略：**在引用原文「之前」插入** AI 生成內容，保留原文引用。

```js
const aiBlock = document.createElement('div');
aiBlock.innerHTML = generatedHtml;          // LLM 生成的回覆（已轉為 HTML/換行）
editorDoc.body.insertBefore(aiBlock, editorDoc.body.firstChild);
```

寫入後建議呼叫系統的同步函式，確保內容在預覽/送出時不遺漏：`cmpWin.SyncEditorContent?.()`。

### 5.3 動作按鈕（供辨識，腳本互動規範）

| 按鈕 | 元素 | handler | 腳本是否可呼叫 |
|---|---|---|---|
| 傳送 | `button`（文字「傳送」） | `HandleBtnSend()` | **禁止**（不得自動送信） |
| 儲存草稿 | `#DraftButton` | `AutoSave()` | 可選（建議也由使用者手動） |
| 預覽 | `#PreviewButton` | `SyncEditorContent()` | 可（唯讀預覽） |
| 返回 | 文字「返回」 | — | 可 |

### 5.4 工具列注入錨點

編輯器工具列上的選單項為 `div.m2k-ui-cssmenu-item`：

| 項目 | id |
|---|---|
| 信件範本 | `#TemplateMenu` ★ 建議注入錨點 |
| 附加檔案 | `#AttButton` / `#AttButtonContainer` |
| 預約寄信 | `#ScheduleButton` |
| 加密 | `#EncodeMenu` |

**建議**：在 `#TemplateMenu` 旁插入「🤖 AI 生成回覆」按鈕（沿用 `m2k-ui-cssmenu-item` class 以維持視覺一致）。另可加一顆「⚙ AI 設定」開啟設定面板。

---

## 6. 觸發與生命週期（SPA / 動態 iframe）

Mail2000 為單頁式、frame 內容動態抽換，腳本不能假設 DOM 在載入時就存在。

建議 Tampermonkey metadata：

```js
// @match        https://mail.inforce.com.tw/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
```

因所有 frame 同源，建議讓腳本在所有 frame 執行（不要 `@noframes`），並依當前 frame 的 `location.pathname` 分流：

- 在 `/cgi-bin/genMail`（回信編輯器）→ 注入按鈕、寫入內文。
- 在 `/cgi-bin/msg_read`（讀信）→ 視需要快取目前信件主旨/內文（供回信時讀取）。
- 用 `MutationObserver` 觀察編輯器工具列出現，再注入按鈕（避免時序問題）。

讀取原信時，回信編輯器可透過 `window.parent.frames['msgIframe']` 取得仍開著的讀信內容。

---

## 7. LLM API 串接（可切換供應商）

### 7.1 共通

- 一律以 `GM_xmlhttpRequest` 發送（繞過頁面 CSP/CORS）。
- API Key、供應商、模型、提示詞規則皆存於 `GM_setValue`/`GM_getValue`。
- API Key 僅存於使用者本機 Tampermonkey storage，**不得**寫入 URL query、不得隨信件送出、不得記錄到 console。

### 7.2 供應商設定（三選一，可於設定切換）

| 供應商 | Endpoint | 認證 | 請求重點 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer <key>` | `messages: [{role:system}, {role:user}]` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key: <key>` + `anthropic-version` | `system` 獨立欄位、`messages` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` | header `x-goog-api-key: <key>` | `systemInstruction` + `contents` |

> 設計成 provider 介面（`buildRequest()` / `parseResponse()`），切換供應商時只換 adapter。

### 7.3 提示詞組裝

```
system = 選定的 system prompt（依主旨規則，見 §8）
user   = 「以下是收到的信件，請依指示撰寫繁體中文回覆。
          主旨：<i_szsubject>
          寄件人：<l_from>
          內文：<msgIframe innerText>」
```

回覆語言預設繁體中文。將生成文字轉為 HTML（換行 → `<br>` 或段落）後寫入編輯器。

---

## 8. 設定功能 — 依主旨（title）套用不同 system prompt ★ 使用者重點需求

### 8.1 資料模型（存於 GM storage）

```jsonc
{
  "provider": "openai",            // openai | anthropic | gemini
  "model": "gpt-4o",
  "apiKeys": { "openai": "", "anthropic": "", "gemini": "" },
  "defaultSystemPrompt": "你是專業的商務信件助理，以禮貌、簡潔的繁體中文撰寫回覆。",
  "rules": [
    {
      "id": "r1",
      "enabled": true,
      "match": "請假",            // 比對字串／關鍵字
      "matchType": "contains",     // contains | startsWith | regex
      "systemPrompt": "這是請假相關信件，請以主管核示語氣回覆…"
    },
    {
      "id": "r2",
      "enabled": true,
      "match": "報價|報價單",
      "matchType": "regex",
      "systemPrompt": "這是報價詢問，請以業務口吻回覆並提醒附上報價單…"
    }
  ]
}
```

### 8.2 選用邏輯

1. 取得原信主旨（`i_szsubject`，去掉開頭的 `Re:`/`Fw:`）。
2. 依序比對 `rules`（只看 `enabled` 為 true 者），第一個命中的規則使用其 `systemPrompt`。
3. 無命中 → 用 `defaultSystemPrompt`。
4. 建議於生成前以小提示顯示「本次套用規則：<rule 名稱/match>」，讓使用者知道用了哪組提示詞。

### 8.3 設定 UI

- 以 `GM_registerMenuCommand('AI 回覆設定', openSettings)` 或工具列「⚙ AI 設定」按鈕開啟。
- 面板（注入的 modal）提供：供應商/模型/各家 API Key、預設 system prompt、規則清單的新增/編輯/刪除/排序/啟用切換。
- 儲存即寫入 `GM_setValue`。

---

## 9. 使用者操作流程（端到端）

1. 使用者開啟一封信（內容載入 `msgIframe`）。
2. 點工具列「回信」→ 編輯器載入 `ifrmCompose`，自動帶入收件人、`Re:` 主旨與引用原文。
3. 腳本偵測到編輯器，於工具列注入「🤖 AI 生成回覆」按鈕。
4. 使用者點該按鈕 →
   a. 擷取原信主旨/寄件人/內文；
   b. 依主旨規則選 system prompt；
   c. `GM_xmlhttpRequest` 呼叫 LLM；
   d. 生成內容插入編輯器內文（引用原文之前）；
   e. 顯示完成提示。
5. **使用者自行檢視/修改，並親自點「傳送」送出**（腳本絕不代送）。

---

## 10. 例外與邊界處理

| 情境 | 處理 |
|---|---|
| 未設定 API Key | 點按鈕時提示前往設定，不發送請求 |
| `msgIframe` 尚未載入完成 | 擷取失敗時提示「請先開啟原信」 |
| 編輯器 iframe 未就緒 | MutationObserver 重試注入，逾時則提示 |
| LLM 逾時／HTTP 非 2xx | 顯示錯誤訊息與狀態碼，不寫入內文 |
| 內文過長（token 超限） | 截斷原信內文並提示已截斷 |
| 純文字編輯模式 | 寫入 `#mailText` 或對應純文字區，避免插入 HTML 標籤 |
| 多次點擊 | 生成期間禁用按鈕，避免重複請求 |

---

## 11. 安全與隱私規範

- **絕不自動送信**：不得呼叫 `HandleBtnSend()`、不得 submit `composeform`。
- API Key 僅存本機，不外流、不入 log、不入 URL。
- 信件內容只送往使用者設定的 LLP API endpoint，不得送往其他來源。
- 不蒐集、不上傳信件以外的個資；session token（網址 `m=` 參數）不得記錄或外送。
- 設定面板對 API Key 欄位採遮蔽顯示。

---

## 12. 待開發者確認/決策事項

1. LLM 預設供應商與預設模型（建議於設定提供下拉）。
2. 生成內容格式：純段落 / 含問候語與署名範本。
3. 是否需要「重新生成」「多版本草稿」等延伸功能（目前需求為一鍵生成單一草稿 + 人工檢視）。
4. 是否要支援「全回」「轉寄」情境（本規格以「回信」為主，DOM 結構相同）。

---

## 附錄 A：關鍵選擇器速查表

```
// Frame 存取
top.frames['m2k']                                   // App 主體
top.frames['m2k'].frames['msgIframe']               // 讀信 (/cgi-bin/msg_read)
top.frames['m2k'].frames['ifrmCompose']             // 回信 (/cgi-bin/genMail)

// 讀信（msgIframe.document）
#mail_header_data[i_szsubject]                       // 主旨
#mail_header_data[i_szdate]                          // 日期
#mail_header_data[l_from] / [l_to]                   // 寄件/收件
#mail_data[i_szmsgid] / [i_szmbox] / [i_ntfid] / [i_ncrumb]
body > [tagName^="X-HTML"]                            // 內文 HTML
body.innerText                                       // 內文純文字

// 回信（ifrmCompose.document）
form[name="composeform"]                             // 主表單（勿提交）
#mailSubject                                         // 主旨輸入
#ToText / #CcText / #BccText                          // 收件/副本/密件
iframe#mailHtml -> contentDocument.body              // 內文編輯器（contentEditable）
#mailText                                            // 內文同步隱藏欄位
#TemplateMenu                                        // 工具列注入錨點
button「傳送」 -> HandleBtnSend()                     // 禁止自動呼叫
#DraftButton -> AutoSave()                           // 儲存草稿
#PreviewButton -> SyncEditorContent()                // 預覽/同步

// 清單（m2k.document）
#lvMsgList_etable / #lvMsgList_er_{i} / #lvMsgList_ec_{i}_{col}
a.TreeNode（.ActiveTreeNode 為目前資料夾）
```
