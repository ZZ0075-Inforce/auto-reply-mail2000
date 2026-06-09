# CLAUDE.md

給 Claude Code / 開發者在此 repo 工作的指南。

## 專案概述

Mail2000（Openfind）webmail 的 Tampermonkey 使用者腳本：在回信編輯器注入「🤖 AI 生成回覆」按鈕，
讀取原信內容、依主旨規則套用對應 system prompt，呼叫可切換的 LLM（OpenAI / Anthropic / Gemini）
生成繁體中文回覆草稿並寫入內文。**永遠不會自動送信。**

結構走「模組原始碼 + 建置打包 + GitHub 自動更新 + dev-loader」：
原始碼是 `src-userscript/` 下多個裸宣告小模組，`build-userscript.py` 串接成單一 `.user.js`。
**永遠不要手改 `dist/` 的產物**——改 `src-userscript/` 的模組後重新 build。

完整 DOM 結構與選擇器見 `Mail2000_AutoReply_Tampermonkey_規格書.md`；使用者文件見 `README.md`。

## 指令

```bash
python build-userscript.py            # build 一次 → dist/mail2000-ai-reply.user.js（+ dev-loader）
python build-userscript.py --watch    # 監看 src-userscript 與本 script 變動，存檔自動重 build
node --check dist/mail2000-ai-reply.user.js   # 語法驗證（會抓重複宣告 / 漏括號）
```

每次 build 會把 `@version` 戳成 `1.0.{YYYYMMDDhhmm}`，確保 Tampermonkey 偵測到升版。

## 架構（模組責任）

模組為**裸宣告**（無各自 IIFE）；`build()` 在 metadata header 後注入單一共享 IIFE
（`/* eslint-disable no-undef */` + `(function () { 'use strict'; … })();`），依 `BODY_MODULES`
順序串接，全部模組共享同一函式 scope。

| 順序 | 模組 | 責任 | 主要依賴 |
|---|---|---|---|
| 1 | `constants.js` | `STORAGE_KEY` / `BTN_ID` 等 ID、`PROVIDERS`、`DEFAULT_CONFIG` | — |
| 2 | `config-store.js` | `loadConfig` / `saveConfig`（GM_getValue/SetValue） | constants |
| 3 | `utils.js` | `log` / `escapeHtml` / `textToHtml` / `stripRePrefix` / `topDoc` / `toast` | config-store, constants |
| 4 | `frame-utils.js` | `getM2k` / `getMsgWin` / `getComposeWin` / `isComposeFrame` | — |
| 5 | `mail-extract.js` | `extractOriginalMail` | frame-utils |
| 6 | `rules.js` | `pickRule` / `pickSystemPrompt` | utils(stripRePrefix) |
| 7 | `llm-adapter.js` | `shortErr` / `buildRequestSpec` / `callLLM`（三家 adapter） | constants, utils(log), GM_xmlhttpRequest |
| 8 | `insert-reply.js` | `insertReply` | frame-utils, utils(toast) |
| 9 | `generate.js` | `generateReply`（端到端調度） | 上述大部分 |
| 10 | `settings-ui.js` | `openSettings` / `renderSettingsHtml` / `bindSettingsEvents` 等 | constants, config-store, utils |
| 11 | `button-injector.js` | `makeToolbarButton` / `injectComposeButtons` | frame-utils, generate, settings-ui |
| 12 | `boot.js` | `boot()` + 末行 `boot();` | frame-utils, button-injector, settings-ui |

**載入順序規則**：唯一硬性限制是 `boot.js` 必須最後（它是唯一的 top-level 執行碼，須在所有宣告後跑）。
其餘模組間互引都在呼叫時解析，順序可調整。新增模組：在 `BODY_MODULES` 加檔名即可（順序即載入順序）。

**注意事項**：
- 不要在模組檔內各自包 IIFE——會把符號藏起來、互引失敗。模組一律 top-level 裸宣告。
- 不要讓同一符號出現在兩個模組（同一 scope 重複宣告 → `SyntaxError`）；`node --check` 會抓到。
- 程式內全部用單引號 + `+` 拼接字串，**沒有反引號 template literal**；改動時維持此風格以免 build 的字串處理出錯。

## Build pipeline

`build-userscript.py`：
1. 讀 `src-userscript/header.meta.js`，`stamp_version()` 把 `@version` 戳成 `1.0.{YYYYMMDDhhmm}`。
2. 注入 bundle 頂層 `/* eslint-disable no-undef */` + 共享 IIFE 開頭。
3. 依 `BODY_MODULES` 順序讀各模組、`rstrip` 後串接（模組間空行分隔）。
4. 補 IIFE 結尾 `})();`，寫出 `dist/mail2000-ai-reply.user.js`。
5. `write_dev_loader()` 產生 `dist/dev-loader.user.js`（只有 metadata + `@require file://` 本機 dist 絕對路徑）。

## 本機快速開發迴圈（dev-loader 熱重載）

正式 deploy 走 GitHub raw（`@updateURL`），改一行也要 push + 等 CDN，太慢。開發期改用 dev-loader：

1. **Chrome**：`chrome://extensions` → Tampermonkey →「詳細資料」→ 開啟「允許存取檔案網址 / Allow access to file URLs」。
2. **Tampermonkey**：設定 → 進階 →「外部 @require 更新間隔」設為「總是 / Always（0）」（否則 file:// 內容被 cache）。
3. 把 `dist/dev-loader.user.js` 拖進 Tampermonkey 安裝，並**停用正式版那支**避免雙重注入。
4. 之後 `python build-userscript.py`（或 `--watch`）→ 瀏覽器 F5 即生效，全程不碰 git。

> ⚠️ dev-loader 與正式版是兩支不同 script，`GM_setValue` 資料各自獨立；開發期設的 API Key / 規則不會帶到正式版。
> `dev-loader.user.js` 含本機絕對路徑、已列入 `.gitignore`，不要 commit。

## GitHub 自動更新

`header.meta.js` 的 `@updateURL` / `@downloadURL` 指向
`https://raw.githubusercontent.com/ZZ0075-Inforce/auto-reply-mail2000/main/dist/mail2000-ai-reply.user.js`。
把 `dist/` push 到 `main` 後，Tampermonkey 約每 24h 檢查一次、依 `@version`（時間戳單調遞增）自動拉新版。
自動更新需此 repo 為 public。若改 repo / branch，記得同步改 `build-userscript.py` 內 dev-loader 的 `@namespace`。

## Mail2000 DOM 重點（改版易碎處）

- 同源巢狀 frameset：`top → m2k → { msgIframe 讀信, ifrmCompose 回信 }`。腳本在所有同源 frame 執行。
- 讀信：`msgIframe`（`/cgi-bin/msg_read`）的 `#mail_header_data`（`i_szsubject` 屬性 = 主旨）+ `X-HTML` 內文元素。
- 回信：`ifrmCompose`（`/cgi-bin/genMail`）的 `iframe#mailHtml`（contentEditable 編輯器），寫入後呼叫頁面 `SyncEditorContent()` 同步。
- 按鈕注入錨點：回信工具列的 `#TemplateMenu`。
- LLM 請求一律走 `GM_xmlhttpRequest`（繞過頁面 CORS/CSP）；對應網域宣告於 `@connect`。

若 Mail2000 改版導致失效，依規格書重新核對上述選擇器（frame 名稱、`#mailHtml`、`#TemplateMenu`、`mail_header_data` 屬性）。

## 改版後最小驗證清單

1. `python build-userscript.py` 且 `node --check dist/...` 通過。
2. 用 dev-loader：開一封信 → 回信 → 確認「🤖 AI 生成回覆」+「⚙」按鈕出現。
3. 開「⚙」設定、切 provider、增刪規則、儲存（確認設定持久化）。
4. 跑一封測試信，確認回覆寫入內文且**沒有自動送出**。
5. 頂層 Tampermonkey 選單「AI 回覆設定」可開面板。
