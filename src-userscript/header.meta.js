// ==UserScript==
// @name         Mail2000 AI 自動回覆
// @namespace    https://github.com/inforce/mail2000-ai-reply
// @version      1.0.0
// @description  在 Mail2000(Openfind) 回信編輯器注入「AI 生成回覆」按鈕；讀取原信內容、依主旨規則套用 system prompt，呼叫可切換的 LLM(OpenAI/Anthropic/Gemini) 生成繁中回覆草稿。絕不自動送信。
// @author       cowork
// @match        https://mail.inforce.com.tw/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @updateURL    https://raw.githubusercontent.com/inforce/mail2000-ai-reply/main/dist/mail2000-ai-reply.user.js
// @downloadURL  https://raw.githubusercontent.com/inforce/mail2000-ai-reply/main/dist/mail2000-ai-reply.user.js
// ==/UserScript==
