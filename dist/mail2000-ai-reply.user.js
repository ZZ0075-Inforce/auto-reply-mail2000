// ==UserScript==
// @name         Mail2000 AI 自動回覆
// @namespace    https://github.com/ZZ0075-Inforce/auto-reply-mail2000
// @version      1.0.202606092354
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
// @connect      localhost
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/ZZ0075-Inforce/auto-reply-mail2000/main/dist/mail2000-ai-reply.user.js
// @downloadURL  https://raw.githubusercontent.com/ZZ0075-Inforce/auto-reply-mail2000/main/dist/mail2000-ai-reply.user.js
// ==/UserScript==

/* eslint-disable no-undef */
(function () {
  'use strict';

// =========================================================================
// 0. 常數
// =========================================================================
const STORAGE_KEY = 'm2k_ai_reply_config_v1';
const BTN_ID = 'm2kAiGenBtn';
const SETTINGS_BTN_ID = 'm2kAiSettingsBtn';
const MODAL_ID = 'm2kAiSettingsModal';
const TOAST_ID = 'm2kAiToast';

const PROVIDERS = {
  openai: {
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-3-5-sonnet-latest',
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }
};

const DEFAULT_CONFIG = {
  provider: 'openai',
  model: '',                       // 空字串 => 用該 provider 預設模型
  apiKeys: { openai: '', anthropic: '', gemini: '' },
  defaultSystemPrompt:
    '你是專業的商務信件助理。請以禮貌、簡潔、得體的繁體中文，根據來信內容撰寫一封完整的回覆。' +
    '只輸出信件正文（含適當的問候與結尾敬語），不要加任何說明或標記。',
  maxBodyChars: 6000,              // 送進 LLM 的原信內文長度上限
  debug: false,
  rules: [
    // 範例規則（預設停用）
    {
      id: 'sample-leave',
      enabled: false,
      name: '請假類',
      match: '請假',
      matchType: 'contains',       // contains | startsWith | regex
      systemPrompt: '這是請假/出勤相關信件，請以主管核示的語氣回覆，明確表達是否同意並提醒交接事項。'
    }
  ],
  // 自訂供應商（僅限本機 localhost／127.0.0.1）：每項 { id, label, protocol, baseUrl, defaultModel }
  // protocol ∈ openai | anthropic | gemini（相容協定，沿用既有三種 wire format）
  customProviders: [],
  // per-provider 模型記憶：{ [providerId]: model }；切供應商各自記住上次選的模型
  models: {}
};

// =========================================================================
// 1. 設定儲存
// =========================================================================
function loadConfig() {
  let raw;
  try { raw = GM_getValue(STORAGE_KEY, null); } catch (e) { raw = null; }
  let cfg;
  if (!raw) {
    cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  } else {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      cfg = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed);
      cfg.apiKeys = Object.assign({}, DEFAULT_CONFIG.apiKeys, parsed.apiKeys || {});
      if (!Array.isArray(cfg.rules)) cfg.rules = [];
      if (!Array.isArray(cfg.customProviders)) cfg.customProviders = [];
      // per-provider 模型守門
      if (!cfg.models || typeof cfg.models !== 'object') cfg.models = {};
      // 向後相容遷移：舊全域 cfg.model 非空且該供應商尚無記錄時，補進 cfg.models（保留 cfg.model 當 legacy fallback）
      if (cfg.model && !cfg.models[cfg.provider]) cfg.models[cfg.provider] = cfg.model;
    } catch (e) {
      cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }
  return cfg;
}

function saveConfig(cfg) {
  GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
}

// =========================================================================
// 2. 工具函式
// =========================================================================
function log() {
  try {
    if (loadConfig().debug) console.log('[M2K-AI]', ...arguments);
  } catch (e) { /* noop */ }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 將 LLM 純文字輸出轉成適合塞進 HTML 編輯器的片段
function textToHtml(text) {
  const safe = escapeHtml(text).replace(/\r\n/g, '\n');
  const paras = safe.split(/\n{2,}/).map(function (p) {
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  });
  return paras.join('');
}

function stripRePrefix(subject) {
  return String(subject || '').replace(/^\s*((re|fw|fwd|回覆|轉寄)\s*[:：]\s*)+/i, '').trim();
}

// 取得頂層 document（modal/toast 一律掛在 top，避免被 iframe 裁切）
function topDoc() {
  try { return window.top.document; } catch (e) { return document; }
}

function toast(msg, type) {
  const d = topDoc();
  let el = d.getElementById(TOAST_ID);
  if (!el) {
    el = d.createElement('div');
    el.id = TOAST_ID;
    el.style.cssText =
      'position:fixed;z-index:2147483647;right:20px;bottom:20px;max-width:360px;' +
      'padding:12px 16px;border-radius:8px;font-size:14px;line-height:1.5;color:#fff;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);font-family:"Microsoft JhengHei",sans-serif;' +
      'transition:opacity .3s;opacity:0;white-space:pre-wrap;';
    d.body.appendChild(el);
  }
  const colors = { info: '#2563eb', ok: '#16a34a', warn: '#d97706', err: '#dc2626' };
  el.style.background = colors[type] || colors.info;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.style.opacity = '0'; }, type === 'err' ? 7000 : 4000);
}

// =========================================================================
// 3. Frame 存取
// =========================================================================
// 腳本在所有同源 frame 執行；按鈕注入發生在 ifrmCompose(/cgi-bin/genMail)。
function getM2k() {
  try { return window.top.frames['m2k']; } catch (e) { return null; }
}
function getMsgWin() {
  const m2k = getM2k();
  try { return m2k ? m2k.frames['msgIframe'] : null; } catch (e) { return null; }
}
function getComposeWin() {
  const m2k = getM2k();
  try { return m2k ? m2k.frames['ifrmCompose'] : null; } catch (e) { return null; }
}
function isComposeFrame() {
  return /\/cgi-bin\/genMail/.test(location.pathname);
}

// =========================================================================
// 4. 擷取原信內容
// =========================================================================
function extractOriginalMail() {
  const result = { subject: '', from: '', body: '', source: 'none' };
  const msgWin = getMsgWin();

  // 4.1 由 msgIframe 的結構化中繼資料 + X-HTML 內文擷取（最穩定）
  if (msgWin && msgWin.document) {
    const mdoc = msgWin.document;
    const header = mdoc.getElementById('mail_header_data');
    if (header) {
      result.subject = header.getAttribute('i_szsubject') || '';
      const fromEl = header.querySelector('l_from, [l_from], x-l-from');
      if (fromEl) result.from = (fromEl.textContent || '').trim();
    }
    // 內文：優先 X-HTML 自訂元素，其次 body.innerText
    let bodyText = '';
    const xhtml = Array.prototype.find.call(
      mdoc.body ? mdoc.body.children : [],
      function (c) { return /^X-HTML/i.test(c.tagName); }
    );
    if (xhtml) bodyText = xhtml.innerText || '';
    if (!bodyText && mdoc.body) bodyText = mdoc.body.innerText || '';
    result.body = bodyText.trim();
    if (result.subject || result.body) result.source = 'msgIframe';
  }

  // 4.2 後備：從回信編輯器的引用原文擷取
  if (!result.body) {
    const cmpWin = getComposeWin() || (isComposeFrame() ? window : null);
    if (cmpWin && cmpWin.document) {
      const subjEl = cmpWin.document.getElementById('mailSubject');
      if (subjEl && !result.subject) result.subject = subjEl.value || '';
      const editor = cmpWin.document.getElementById('mailHtml');
      if (editor && editor.contentDocument && editor.contentDocument.body) {
        result.body = (editor.contentDocument.body.innerText || '').trim();
        result.source = 'composeQuote';
      }
    }
  }

  if (result.subject) result.subject = result.subject.trim();
  return result;
}

// =========================================================================
// 5. 主旨規則 → 挑選 system prompt
// =========================================================================
function pickRule(subject, cfg) {
  const subj = stripRePrefix(subject);
  const rules = (cfg.rules || []).filter(function (r) { return r && r.enabled && r.match; });
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    try {
      if (r.matchType === 'regex') {
        if (new RegExp(r.match, 'i').test(subj)) return r;
      } else if (r.matchType === 'startsWith') {
        if (subj.toLowerCase().indexOf(String(r.match).toLowerCase()) === 0) return r;
      } else { // contains
        if (subj.toLowerCase().indexOf(String(r.match).toLowerCase()) >= 0) return r;
      }
    } catch (e) { /* 無效 regex 略過 */ }
  }
  return null;
}

function pickSystemPrompt(subject, cfg) {
  const r = pickRule(subject, cfg);
  return {
    systemPrompt: r ? r.systemPrompt : cfg.defaultSystemPrompt,
    ruleName: r ? (r.name || r.match) : null
  };
}

// =========================================================================
// 6. LLM 呼叫（OpenAI / Anthropic / Gemini，可切換；支援本機自訂供應商）
// =========================================================================
// 從 API 錯誤回應中萃取簡短訊息
function shortErr(responseText) {
  if (!responseText) return '';
  try {
    const j = JSON.parse(responseText);
    const m = (j.error && (j.error.message || j.error.status)) ||
      (j.message) ||
      (Array.isArray(j) && j[0] && j[0].error && j[0].error.message);
    if (m) return String(m).slice(0, 200);
  } catch (e) { /* 非 JSON */ }
  return String(responseText).replace(/\s+/g, ' ').slice(0, 160);
}

// base URL 正規化：trim + 去尾斜線
function normalizeBaseUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

// 僅允許本機（@connect 只放寬 localhost / 127.0.0.1）
function isLocalBaseUrl(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch (e) { return false; }
}

// 解析當前供應商（內建或自訂）→ { id, protocol, endpointBase, defaultModel, label, isCustom }
// 內建：endpointBase = 既有完整 endpoint；自訂：endpointBase = 正規化後的 baseUrl。找不到回 null。
function resolveProvider(cfg) {
  const id = cfg.provider;
  if (PROVIDERS[id]) {
    return {
      id: id, protocol: id, label: PROVIDERS[id].label,
      defaultModel: PROVIDERS[id].defaultModel,
      endpointBase: PROVIDERS[id].endpoint, isCustom: false
    };
  }
  const cp = (cfg.customProviders || []).find(function (p) { return p && p.id === id; });
  if (cp) {
    return {
      id: cp.id, protocol: cp.protocol, label: cp.label || cp.id,
      defaultModel: cp.defaultModel || '',
      endpointBase: normalizeBaseUrl(cp.baseUrl), isCustom: true
    };
  }
  return null;
}

// 依協定 + endpointBase 組出實際請求 URL（內建用完整 endpoint；自訂補各協定標準 path）
function providerUrl(protocol, base, isCustom, model) {
  if (protocol === 'openai') {
    return isCustom ? base + '/v1/chat/completions' : base;
  }
  if (protocol === 'anthropic') {
    return isCustom ? base + '/v1/messages' : base;
  }
  if (protocol === 'gemini') {
    const m = encodeURIComponent(model);
    return isCustom ? base + '/v1beta/models/' + m + ':generateContent'
                    : base + '/' + m + ':generateContent';
  }
  throw new Error('未知的相容協定：' + protocol);
}

// 依供應商組出請求規格 { url, headers, data, parse }（按 resolved.protocol 分流，三套 wire format）
function buildRequestSpec(resolved, key, model, system, user) {
  const url = providerUrl(resolved.protocol, resolved.endpointBase, resolved.isCustom, model);
  if (resolved.protocol === 'openai') {
    return {
      url: url,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      data: JSON.stringify({
        model: model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      parse: function (j) { return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; }
    };
  }
  if (resolved.protocol === 'anthropic') {
    return {
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      data: JSON.stringify({
        model: model,
        max_tokens: 1500,
        temperature: 0.7,
        system: system,
        messages: [{ role: 'user', content: user }]
      }),
      parse: function (j) {
        return j.content && j.content.map(function (b) { return b.text || ''; }).join('');
      }
    };
  }
  if (resolved.protocol === 'gemini') {
    return {
      url: url,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      data: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7 }
      }),
      parse: function (j) {
        return j.candidates && j.candidates[0] && j.candidates[0].content &&
          j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
      }
    };
  }
  throw new Error('未知的相容協定：' + resolved.protocol);
}

// 透過 GM_xmlhttpRequest 呼叫（繞過頁面 CORS/CSP）→ Promise<string>
function callLLM(cfg, system, user) {
  const resolved = resolveProvider(cfg);
  if (!resolved) return Promise.reject(new Error('找不到供應商設定：' + cfg.provider));
  const key = (cfg.apiKeys || {})[resolved.id];
  const model = (cfg.models && cfg.models[resolved.id]) || cfg.model || resolved.defaultModel;
  if (!model) return Promise.reject(new Error('未指定模型，請於「AI 設定」填入模型名稱'));
  const spec = buildRequestSpec(resolved, key, model, system, user);
  log('callLLM', resolved.id, resolved.protocol, model);
  return new Promise(function (resolve, reject) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: spec.url,
      headers: spec.headers,
      data: spec.data,
      timeout: 60000,
      onload: function (res) {
        if (res.status < 200 || res.status >= 300) {
          reject(new Error('HTTP ' + res.status + '：' + shortErr(res.responseText)));
          return;
        }
        let json;
        try { json = JSON.parse(res.responseText); }
        catch (e) { reject(new Error('回應非 JSON')); return; }
        let text;
        try { text = spec.parse(json); }
        catch (e) { reject(new Error('回應格式不符：' + e.message)); return; }
        if (!text || !String(text).trim()) { reject(new Error('回應無有效內容')); return; }
        resolve(String(text));
      },
      onerror: function () { reject(new Error('網路錯誤（請確認 @connect 與連線）')); },
      ontimeout: function () { reject(new Error('請求逾時（60s）')); }
    });
  });
}

// 用使用者填的 baseUrl 打 OpenAI 相容的 GET {baseUrl}/v1/models 取可用模型 → Promise<string[]>
// baseUrl 一律來自使用者輸入（不寫死任何 host/port）；key 有才帶 Authorization。
function fetchModels(baseUrl, key) {
  const url = normalizeBaseUrl(baseUrl) + '/v1/models';
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return new Promise(function (resolve, reject) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      headers: headers,
      timeout: 20000,
      onload: function (res) {
        if (res.status < 200 || res.status >= 300) {
          reject(new Error('HTTP ' + res.status + '：' + shortErr(res.responseText)));
          return;
        }
        let json;
        try { json = JSON.parse(res.responseText); }
        catch (e) { reject(new Error('回應非 JSON')); return; }
        const arr = json.data || json.models || [];
        const list = arr.map(function (m) { return m.id || m.name || ''; }).filter(Boolean);
        if (!list.length) { reject(new Error('未取得任何模型')); return; }
        resolve(list);
      },
      onerror: function () { reject(new Error('網路錯誤（請確認本機服務已啟動、@connect）')); },
      ontimeout: function () { reject(new Error('請求逾時（20s）')); }
    });
  });
}

// =========================================================================
// 7. 將生成內容寫入回信編輯器
// =========================================================================
function insertReply(html) {
  const cmpWin = isComposeFrame() ? window : getComposeWin();
  if (!cmpWin || !cmpWin.document) { toast('找不到回信編輯器', 'err'); return false; }
  const editor = cmpWin.document.getElementById('mailHtml');
  if (!editor || !editor.contentDocument || !editor.contentDocument.body) {
    toast('回信內文編輯器尚未就緒', 'err');
    return false;
  }
  const edoc = editor.contentDocument;
  const block = edoc.createElement('div');
  block.setAttribute('data-m2k-ai', '1');
  block.innerHTML = html + '<br>';
  edoc.body.insertBefore(block, edoc.body.firstChild);
  // 同步到隱藏欄位（供預覽/送出使用）
  try { if (typeof cmpWin.SyncEditorContent === 'function') cmpWin.SyncEditorContent(); } catch (e) { /* noop */ }
  return true;
}

// =========================================================================
// 8. 生成流程
// =========================================================================
async function generateReply() {
  const cfg = loadConfig();
  const btn = (isComposeFrame() ? document : (getComposeWin() && getComposeWin().document) || document)
    .getElementById(BTN_ID);

  const mail = extractOriginalMail();
  if (!mail.subject && !mail.body) {
    toast('讀不到原信內容，請先開啟原信再回信。', 'err');
    return;
  }
  const picked = pickSystemPrompt(mail.subject, cfg);
  log('extracted', mail, 'rule', picked.ruleName);

  const resolved = resolveProvider(cfg);
  if (!resolved) { toast('目前供應商設定不存在，請開啟「AI 設定」重選。', 'err'); return; }
  const key = (cfg.apiKeys || {})[resolved.id];
  // 自訂（本機）供應商常不需 key（Ollama/CLIProxyAPI 等），故僅內建供應商缺 key 時提示
  if (!key && !resolved.isCustom) {
    toast('尚未設定「' + resolved.label + '」的 API Key，請先開啟「AI 設定」。', 'warn');
    return;
  }

  const body = mail.body.slice(0, cfg.maxBodyChars);
  const truncated = mail.body.length > cfg.maxBodyChars;
  const userContent =
    '以下是收到的信件，請依指示撰寫繁體中文回覆。\n\n' +
    '主旨：' + stripRePrefix(mail.subject) + '\n' +
    (mail.from ? '寄件人：' + mail.from + '\n' : '') +
    '內文：\n' + body + (truncated ? '\n…(內文過長已截斷)' : '');

  // loading 動畫：按鈕文字改為計時並逐秒跳動，讓使用者知道仍在生成（可達數十秒、非當機）
  if (btn) {
    btn.dataset.busy = '1';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.85';
    const origText = btn.textContent;
    const t0 = Date.now();
    const frames = ['⏳', '⌛'];
    let fi = 0;
    const tick = function () {
      const s = Math.round((Date.now() - t0) / 1000);
      btn.textContent = frames[fi++ % frames.length] + ' 生成中… ' + s + 's';
    };
    tick();
    const busyTimer = setInterval(tick, 1000);
    btn._restore = function () { clearInterval(busyTimer); btn.textContent = origText; };
  }
  toast('AI 生成中…（規則：' + (picked.ruleName || '預設') + '）', 'info');
  try {
    const reply = await callLLM(cfg, picked.systemPrompt, userContent);
    if (!reply || !reply.trim()) { toast('LLM 回傳空白內容。', 'err'); return; }
    if (insertReply(textToHtml(reply.trim()))) {
      toast('已寫入回覆草稿，請檢視後再自行送出。', 'ok');
    }
  } catch (err) {
    toast('生成失敗：' + (err && err.message ? err.message : err), 'err');
    log('error', err);
  } finally {
    if (btn) {
      btn.dataset.busy = '';
      btn.style.pointerEvents = '';
      btn.style.opacity = '';
      if (btn._restore) { btn._restore(); btn._restore = null; }
    }
  }
}

// settings-style.js — 設定面板樣式注入
// 來源：mockups/settings-redesign.html 的 <style>，取 .m2kai-root 以下全部規則
//（含 @supports OKLCH fallback、深色 token、prefers-reduced-motion、@keyframes、reset）。
// 已剔除 mockup 的「預覽舞台」規則（body{} / .m2kai-stage / 針對 body 的 prefers-dark），
// 並新增 .m2kai-overlay modal 遮罩（讓面板置中，點遮罩關閉由 JS 處理）。
//
// 風格鐵則：CSS 以陣列 join 串接、外層 JS 用單引號；CSS 內部字串（font-family 引號、
// content）用雙引號，與外層單引號不衝突。全檔無反引號 template literal。
// 匯出：ensureSettingsStyle（裸宣告 function）。topDoc 沿用 utils.js 既有定義。

function ensureSettingsStyle() {
  var d = topDoc();
  if (d.getElementById('m2kaiStyle')) return;

  var css = [
    '/* ---- Modal 遮罩：讓面板置中浮在宿主頁面之上（點遮罩關閉由 JS 處理） ---- */',
    '.m2kai-overlay {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 2147483646;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  background: rgba(0, 0, 0, .45);',
    '}',
    '',
    '/* =========================================================================',
    '   Design tokens — 全部 OKLCH（關鍵色補 rgb fallback，見下方 @supports 段）',
    '   淺色預設；深色由共享規則覆寫同一組變數。',
    '   spacing scale（嚴格 4 模數，全檔只用這六階）。',
    '   ========================================================================= */',
    '.m2kai-root {',
    '  --m2kai-accent: oklch(0.55 0.19 264);',
    '  --m2kai-accent-strong: oklch(0.49 0.20 264);',
    '  --m2kai-accent-weak: oklch(0.55 0.19 264 / 0.12);',
    '  --m2kai-accent-ring: oklch(0.55 0.19 264 / 0.40);',
    '  --m2kai-on-accent: oklch(0.99 0 0);',
    '',
    '  --m2kai-brand: var(--m2kai-accent);',
    '  --m2kai-brand-weak: oklch(0.55 0.19 264 / 0.12);',
    '',
    '  --m2kai-bg: oklch(0.99 0.002 264);',
    '  --m2kai-surface: oklch(1 0 0);',
    '  --m2kai-surface-2: oklch(0.965 0.004 264);',
    '  --m2kai-surface-3: oklch(0.93 0.006 264);',
    '  --m2kai-fg: oklch(0.22 0.01 264);',
    '  --m2kai-fg-muted: oklch(0.50 0.01 264);',
    '  --m2kai-fg-faint: oklch(0.64 0.01 264);',
    '  --m2kai-border: oklch(0.90 0.005 264);',
    '  --m2kai-border-strong: oklch(0.83 0.006 264);',
    '  --m2kai-field-bg: oklch(0.995 0.002 264);',
    '',
    '  --m2kai-success: oklch(0.58 0.14 152);',
    '  --m2kai-success-weak: oklch(0.58 0.14 152 / 0.14);',
    '  --m2kai-success-border: oklch(0.58 0.14 152 / 0.45);',
    '  --m2kai-warn: oklch(0.60 0.14 75);',
    '  --m2kai-warn-weak: oklch(0.74 0.15 85 / 0.16);',
    '  --m2kai-danger: oklch(0.58 0.21 27);',
    '  --m2kai-danger-weak: oklch(0.58 0.21 27 / 0.12);',
    '  --m2kai-danger-border: oklch(0.58 0.21 27 / 0.45);',
    '  --m2kai-link: oklch(0.55 0.16 250);',
    '',
    '  --m2kai-s1: 4px;',
    '  --m2kai-s2: 8px;',
    '  --m2kai-s3: 12px;',
    '  --m2kai-s4: 16px;',
    '  --m2kai-s5: 24px;',
    '  --m2kai-s6: 32px;',
    '',
    '  --m2kai-radius-lg: 10px;',
    '  --m2kai-radius-md: 8px;',
    '  --m2kai-radius-sm: 6px;',
    '  --m2kai-shadow: 0 8px 40px oklch(0 0 0 / 0.08);',
    '  --m2kai-shadow-pop: 0 12px 48px oklch(0 0 0 / 0.18);',
    '',
    '  --m2kai-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;',
    '  --m2kai-sans: "Microsoft JhengHei", "PingFang TC", ui-sans-serif, system-ui, sans-serif;',
    '}',
    '',
    '/* ---- 深色變數：prefers 與手動 data-theme 共用 ---- */',
    '@media (prefers-color-scheme: dark) {',
    '  .m2kai-root:not([data-m2kai-theme="light"]) { color-scheme: dark; }',
    '}',
    '.m2kai-root[data-m2kai-theme="dark"],',
    '.m2kai-dark-vars {',
    '  color-scheme: dark;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  .m2kai-root:not([data-m2kai-theme="light"]) {',
    '    --m2kai-accent: oklch(0.68 0.16 264);',
    '    --m2kai-accent-strong: oklch(0.74 0.15 264);',
    '    --m2kai-accent-weak: oklch(0.68 0.16 264 / 0.18);',
    '    --m2kai-accent-ring: oklch(0.68 0.16 264 / 0.45);',
    '    --m2kai-on-accent: oklch(0.16 0.01 264);',
    '    --m2kai-brand: var(--m2kai-accent);',
    '    --m2kai-brand-weak: oklch(0.68 0.16 264 / 0.18);',
    '    --m2kai-bg: oklch(0.16 0.006 264);',
    '    --m2kai-surface: oklch(0.205 0.007 264);',
    '    --m2kai-surface-2: oklch(0.245 0.008 264);',
    '    --m2kai-surface-3: oklch(0.30 0.010 264);',
    '    --m2kai-fg: oklch(0.94 0.004 264);',
    '    --m2kai-fg-muted: oklch(0.72 0.008 264);',
    '    --m2kai-fg-faint: oklch(0.58 0.01 264);',
    '    --m2kai-border: oklch(1 0 0 / 0.10);',
    '    --m2kai-border-strong: oklch(1 0 0 / 0.16);',
    '    --m2kai-field-bg: oklch(0.185 0.007 264);',
    '    --m2kai-success: oklch(0.70 0.14 152);',
    '    --m2kai-success-weak: oklch(0.70 0.14 152 / 0.16);',
    '    --m2kai-success-border: oklch(0.70 0.14 152 / 0.40);',
    '    --m2kai-warn: oklch(0.80 0.14 85);',
    '    --m2kai-warn-weak: oklch(0.80 0.14 85 / 0.16);',
    '    --m2kai-danger: oklch(0.68 0.18 27);',
    '    --m2kai-danger-weak: oklch(0.68 0.18 27 / 0.16);',
    '    --m2kai-danger-border: oklch(0.68 0.18 27 / 0.40);',
    '    --m2kai-link: oklch(0.72 0.13 250);',
    '    --m2kai-shadow: 0 8px 40px oklch(0 0 0 / 0.45);',
    '    --m2kai-shadow-pop: 0 16px 60px oklch(0 0 0 / 0.6);',
    '  }',
    '}',
    '.m2kai-root[data-m2kai-theme="dark"] {',
    '  --m2kai-accent: oklch(0.68 0.16 264);',
    '  --m2kai-accent-strong: oklch(0.74 0.15 264);',
    '  --m2kai-accent-weak: oklch(0.68 0.16 264 / 0.18);',
    '  --m2kai-accent-ring: oklch(0.68 0.16 264 / 0.45);',
    '  --m2kai-on-accent: oklch(0.16 0.01 264);',
    '  --m2kai-brand: var(--m2kai-accent);',
    '  --m2kai-brand-weak: oklch(0.68 0.16 264 / 0.18);',
    '  --m2kai-bg: oklch(0.16 0.006 264);',
    '  --m2kai-surface: oklch(0.205 0.007 264);',
    '  --m2kai-surface-2: oklch(0.245 0.008 264);',
    '  --m2kai-surface-3: oklch(0.30 0.010 264);',
    '  --m2kai-fg: oklch(0.94 0.004 264);',
    '  --m2kai-fg-muted: oklch(0.72 0.008 264);',
    '  --m2kai-fg-faint: oklch(0.58 0.01 264);',
    '  --m2kai-border: oklch(1 0 0 / 0.10);',
    '  --m2kai-border-strong: oklch(1 0 0 / 0.16);',
    '  --m2kai-field-bg: oklch(0.185 0.007 264);',
    '  --m2kai-success: oklch(0.70 0.14 152);',
    '  --m2kai-success-weak: oklch(0.70 0.14 152 / 0.16);',
    '  --m2kai-success-border: oklch(0.70 0.14 152 / 0.40);',
    '  --m2kai-warn: oklch(0.80 0.14 85);',
    '  --m2kai-warn-weak: oklch(0.80 0.14 85 / 0.16);',
    '  --m2kai-danger: oklch(0.68 0.18 27);',
    '  --m2kai-danger-weak: oklch(0.68 0.18 27 / 0.16);',
    '  --m2kai-danger-border: oklch(0.68 0.18 27 / 0.40);',
    '  --m2kai-link: oklch(0.72 0.13 250);',
    '  --m2kai-shadow: 0 8px 40px oklch(0 0 0 / 0.45);',
    '  --m2kai-shadow-pop: 0 16px 60px oklch(0 0 0 / 0.6);',
    '}',
    '',
    '/* =========================================================================',
    '   OKLCH fallback — 舊瀏覽器解析失敗時退到 sRGB 近似值。',
    '   ========================================================================= */',
    '@supports not (color: oklch(0.5 0.1 264)) {',
    '  .m2kai-root {',
    '    --m2kai-accent: #4f46e5;',
    '    --m2kai-accent-strong: #4338ca;',
    '    --m2kai-accent-weak: rgba(79, 70, 229, 0.12);',
    '    --m2kai-accent-ring: rgba(79, 70, 229, 0.40);',
    '    --m2kai-on-accent: #ffffff;',
    '    --m2kai-brand: #4f46e5;',
    '    --m2kai-brand-weak: rgba(79, 70, 229, 0.12);',
    '    --m2kai-bg: #fbfbfc;',
    '    --m2kai-surface: #ffffff;',
    '    --m2kai-surface-2: #f1f2f5;',
    '    --m2kai-surface-3: #e3e5ea;',
    '    --m2kai-fg: #23262e;',
    '    --m2kai-fg-muted: #6b7080;',
    '    --m2kai-fg-faint: #9aa0ad;',
    '    --m2kai-border: #e2e4ea;',
    '    --m2kai-border-strong: #cbcfd8;',
    '    --m2kai-field-bg: #fdfdfe;',
    '    --m2kai-success: #1f9d5b;',
    '    --m2kai-success-weak: rgba(31, 157, 91, 0.14);',
    '    --m2kai-success-border: rgba(31, 157, 91, 0.45);',
    '    --m2kai-warn: #9a6b00;',
    '    --m2kai-warn-weak: rgba(214, 158, 46, 0.16);',
    '    --m2kai-danger: #d33636;',
    '    --m2kai-danger-weak: rgba(211, 54, 54, 0.12);',
    '    --m2kai-danger-border: rgba(211, 54, 54, 0.45);',
    '    --m2kai-link: #3b6fe0;',
    '  }',
    '}',
    '',
    '/* =========================================================================',
    '   Scope reset — 把面板內元素從宿主頁面的樣式中隔離。',
    '   ========================================================================= */',
    '.m2kai-root, .m2kai-root * {',
    '  box-sizing: border-box;',
    '}',
    '.m2kai-root {',
    '  font-family: var(--m2kai-sans);',
    '  font-size: 14px;',
    '  line-height: 1.45;',
    '  color: var(--m2kai-fg);',
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '.m2kai-root button,',
    '.m2kai-root input,',
    '.m2kai-root select,',
    '.m2kai-root textarea {',
    '  font-family: inherit;',
    '  font-size: inherit;',
    '  line-height: normal;',
    '  color: inherit;',
    '  margin: 0;',
    '  letter-spacing: inherit;',
    '  text-transform: none;',
    '}',
    '',
    '/* =========================================================================',
    '   面板外殼',
    '   ========================================================================= */',
    '.m2kai-panel {',
    '  width: 840px;',
    '  max-width: 96vw;',
    '  height: 600px;',
    '  max-height: 92vh;',
    '  background: var(--m2kai-surface);',
    '  border: 1px solid var(--m2kai-border);',
    '  border-radius: var(--m2kai-radius-lg);',
    '  box-shadow: var(--m2kai-shadow);',
    '  display: flex;',
    '  flex-direction: column;',
    '  overflow: hidden;',
    '  animation: m2kai-pop 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);',
    '}',
    '@keyframes m2kai-pop {',
    '  from { opacity: 0; transform: translateY(6px) scale(0.985); }',
    '  to   { opacity: 1; transform: translateY(0) scale(1); }',
    '}',
    '',
    '/* ---- Header ---- */',
    '.m2kai-header {',
    '  position: relative;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s3);',
    '  padding: var(--m2kai-s4) var(--m2kai-s4);',
    '  border-bottom: 1px solid var(--m2kai-border);',
    '  background:',
    '    linear-gradient(180deg, var(--m2kai-brand-weak), transparent 90%),',
    '    var(--m2kai-surface);',
    '  transition: background 0.4s ease;',
    '}',
    '.m2kai-logo {',
    '  position: relative;',
    '  width: 34px; height: 34px;',
    '  flex: none;',
    '  display: grid;',
    '  place-items: center;',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-brand-weak);',
    '  color: var(--m2kai-brand);',
    '  transition: background 0.4s ease, color 0.4s ease;',
    '}',
    '.m2kai-logo::after {',
    '  content: "";',
    '  position: absolute;',
    '  inset: -4px;',
    '  border-radius: inherit;',
    '  background: var(--m2kai-brand);',
    '  opacity: 0;',
    '  z-index: -1;',
    '  animation: m2kai-breathe 3.2s ease-in-out infinite;',
    '}',
    '@keyframes m2kai-breathe {',
    '  0%, 100% { opacity: 0.06; transform: scale(1); }',
    '  50%      { opacity: 0.18; transform: scale(1.06); }',
    '}',
    '.m2kai-title-wrap { display: flex; flex-direction: column; gap: 1px; }',
    '.m2kai-title-row { display: flex; align-items: center; gap: var(--m2kai-s2); }',
    '.m2kai-title {',
    '  margin: 0;',
    '  font-size: 16px;',
    '  font-weight: 700;',
    '  letter-spacing: -0.01em;',
    '}',
    '.m2kai-subtitle {',
    '  font-size: 12px;',
    '  color: var(--m2kai-fg-muted);',
    '}',
    '.m2kai-header-spacer { flex: 1; }',
    '.m2kai-iconbtn {',
    '  width: 30px; height: 30px;',
    '  display: grid; place-items: center;',
    '  border: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface);',
    '  border-radius: var(--m2kai-radius-md);',
    '  color: var(--m2kai-fg-muted);',
    '  cursor: pointer;',
    '  transition: background 0.13s, color 0.13s, border-color 0.13s;',
    '}',
    '.m2kai-iconbtn:hover { background: var(--m2kai-surface-2); color: var(--m2kai-fg); }',
    '.m2kai-iconbtn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '.m2kai-close { font-size: 20px; line-height: 1; }',
    '',
    '.m2kai-safety-badge {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s1);',
    '  height: 19px;',
    '  padding: 0 var(--m2kai-s2);',
    '  border-radius: 999px;',
    '  font-size: 11px;',
    '  font-weight: 600;',
    '  background: var(--m2kai-success-weak);',
    '  color: var(--m2kai-success);',
    '  border: 1px solid var(--m2kai-success-border);',
    '  white-space: nowrap;',
    '}',
    '.m2kai-safety-badge .m2kai-ico { width: 12px; height: 12px; }',
    '',
    '/* ---- Tabs ---- */',
    '.m2kai-tabs {',
    '  display: flex;',
    '  gap: 2px;',
    '  padding: var(--m2kai-s2) var(--m2kai-s3) 0;',
    '  border-bottom: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface);',
    '}',
    '.m2kai-tab {',
    '  position: relative;',
    '  appearance: none;',
    '  border: none;',
    '  background: transparent;',
    '  padding: var(--m2kai-s2) var(--m2kai-s3) 10px;',
    '  font-size: 13px;',
    '  font-weight: 500;',
    '  color: var(--m2kai-fg-muted);',
    '  cursor: pointer;',
    '  border-radius: var(--m2kai-radius-sm) var(--m2kai-radius-sm) 0 0;',
    '  transition: color 0.13s, background 0.13s;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s1);',
    '}',
    '.m2kai-tab:hover { color: var(--m2kai-fg); background: var(--m2kai-surface-2); }',
    '.m2kai-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '.m2kai-tab[aria-selected="true"] { color: var(--m2kai-accent-strong); font-weight: 700; }',
    '.m2kai-tab .m2kai-ico { width: 15px; height: 15px; }',
    '.m2kai-tab::after {',
    '  content: "";',
    '  position: absolute;',
    '  left: 10px; right: 10px; bottom: -1px;',
    '  height: 2px;',
    '  border-radius: 2px;',
    '  background: var(--m2kai-accent);',
    '  transform: scaleX(0);',
    '  transform-origin: center;',
    '  transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);',
    '}',
    '.m2kai-tab[aria-selected="true"]::after { transform: scaleX(1); }',
    '',
    '/* ---- Body ---- */',
    '.m2kai-body {',
    '  flex: 1;',
    '  overflow: hidden;',
    '  position: relative;',
    '}',
    '.m2kai-page {',
    '  position: absolute;',
    '  inset: 0;',
    '  overflow: auto;',
    '  opacity: 0;',
    '  visibility: hidden;',
    '  transform: translateY(4px);',
    '  transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s linear 0.15s;',
    '  pointer-events: none;',
    '}',
    '.m2kai-page.is-active {',
    '  opacity: 1;',
    '  visibility: visible;',
    '  transform: none;',
    '  pointer-events: auto;',
    '  transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s linear 0s;',
    '}',
    '',
    '/* =========================================================================',
    '   Tab 1 供應商 — master-detail',
    '   ========================================================================= */',
    '.m2kai-md {',
    '  display: grid;',
    '  grid-template-columns: 248px 1fr;',
    '  height: 100%;',
    '}',
    '.m2kai-md-list {',
    '  border-right: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface-2);',
    '  overflow: auto;',
    '  padding: var(--m2kai-s3);',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: var(--m2kai-s2);',
    '}',
    '.m2kai-list-label {',
    '  font-size: 11px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.06em;',
    '  text-transform: uppercase;',
    '  color: var(--m2kai-fg-faint);',
    '  padding: 2px var(--m2kai-s1);',
    '}',
    '',
    '.m2kai-pcard {',
    '  position: relative;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  border: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface);',
    '  border-radius: var(--m2kai-radius-md);',
    '  cursor: pointer;',
    '  text-align: left;',
    '  width: 100%;',
    '  transition: border-color 0.13s, box-shadow 0.13s, transform 0.13s, background 0.13s;',
    '}',
    '.m2kai-pcard:hover { border-color: var(--m2kai-border-strong); transform: translateY(-1px); }',
    '.m2kai-pcard:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '',
    '.m2kai-pcard.is-selected {',
    '  background: var(--m2kai-surface-3);',
    '  border-color: var(--m2kai-border-strong);',
    '}',
    '',
    '.m2kai-pcard.is-active {',
    '  border-color: var(--m2kai-brand);',
    '  box-shadow: 0 0 0 1px var(--m2kai-brand), 0 4px 16px var(--m2kai-brand-weak);',
    '}',
    '.m2kai-pcard.is-active::before {',
    '  content: "";',
    '  position: absolute;',
    '  left: 0; top: 6px; bottom: 6px;',
    '  width: 3px;',
    '  border-radius: 0 3px 3px 0;',
    '  background: var(--m2kai-brand);',
    '}',
    '.m2kai-avatar {',
    '  width: 30px; height: 30px;',
    '  flex: none;',
    '  display: grid;',
    '  place-items: center;',
    '  border-radius: var(--m2kai-radius-sm);',
    '  font-size: 13px;',
    '  font-weight: 700;',
    '  color: var(--m2kai-on-accent);',
    '}',
    '.m2kai-avatar.av-openai    { background: oklch(0.62 0.13 168); }',
    '.m2kai-avatar.av-anthropic { background: oklch(0.64 0.14 47); }',
    '.m2kai-avatar.av-gemini    { background: oklch(0.60 0.15 255); }',
    '.m2kai-avatar.av-custom    { background: var(--m2kai-surface-3); color: var(--m2kai-accent-strong); border: 1px solid var(--m2kai-border-strong); }',
    '@supports not (color: oklch(0.5 0.1 264)) {',
    '  .m2kai-avatar.av-openai    { background: #19a974; }',
    '  .m2kai-avatar.av-anthropic { background: #d97757; }',
    '  .m2kai-avatar.av-gemini    { background: #4385f5; }',
    '}',
    '.m2kai-pcard-main { flex: 1; min-width: 0; }',
    '.m2kai-pcard-name {',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  white-space: nowrap;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '}',
    '.m2kai-pcard-meta {',
    '  font-size: 11px;',
    '  color: var(--m2kai-fg-faint);',
    '  white-space: nowrap;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '}',
    '',
    '.m2kai-active-dot {',
    '  width: 8px; height: 8px;',
    '  flex: none;',
    '  border-radius: 50%;',
    '  background: var(--m2kai-brand);',
    '  position: relative;',
    '  display: none;',
    '}',
    '.m2kai-pcard.is-active .m2kai-active-dot { display: block; }',
    '.m2kai-active-dot::after {',
    '  content: "";',
    '  position: absolute;',
    '  inset: 0;',
    '  border-radius: 50%;',
    '  background: var(--m2kai-brand);',
    '  animation: m2kai-pulse 2.4s ease-out infinite;',
    '}',
    '@keyframes m2kai-pulse {',
    '  0%   { transform: scale(1); opacity: 0.5; }',
    '  70%  { transform: scale(2); opacity: 0; }',
    '  100% { transform: scale(2); opacity: 0; }',
    '}',
    '',
    '.m2kai-addcard {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: var(--m2kai-s1);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  border: 1px dashed var(--m2kai-border-strong);',
    '  background: transparent;',
    '  border-radius: var(--m2kai-radius-md);',
    '  color: var(--m2kai-fg-muted);',
    '  font-size: 13px;',
    '  font-weight: 500;',
    '  cursor: pointer;',
    '  transition: border-color 0.13s, color 0.13s, background 0.13s;',
    '}',
    '.m2kai-addcard:hover { border-color: var(--m2kai-accent); color: var(--m2kai-accent-strong); background: var(--m2kai-accent-weak); }',
    '.m2kai-addcard:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '',
    '/* Detail 右欄 */',
    '.m2kai-md-detail {',
    '  overflow: auto;',
    '  padding: var(--m2kai-s5) var(--m2kai-s5);',
    '}',
    '.m2kai-detail-head {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s3);',
    '  margin-bottom: var(--m2kai-s1);',
    '}',
    '.m2kai-detail-head .m2kai-avatar { width: 36px; height: 36px; font-size: 15px; }',
    '.m2kai-detail-title { font-size: 16px; font-weight: 700; }',
    '.m2kai-detail-sub { font-size: 12px; color: var(--m2kai-fg-muted); }',
    '',
    '.m2kai-onboard {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: var(--m2kai-s2);',
    '  margin-top: var(--m2kai-s3);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-accent-weak);',
    '  color: var(--m2kai-accent-strong);',
    '  font-size: 12px;',
    '  line-height: 1.5;',
    '}',
    '.m2kai-onboard .m2kai-ico { width: 14px; height: 14px; flex: none; margin-top: 2px; }',
    '',
    '.m2kai-use-row {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  margin: var(--m2kai-s3) 0 var(--m2kai-s1);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface-2);',
    '  border: 1px solid var(--m2kai-border);',
    '  font-size: 12px;',
    '  color: var(--m2kai-fg-muted);',
    '}',
    '.m2kai-use-row.is-active {',
    '  background: var(--m2kai-brand-weak);',
    '  border-color: var(--m2kai-brand);',
    '  color: var(--m2kai-accent-strong);',
    '  font-weight: 600;',
    '}',
    '.m2kai-use-row .m2kai-spacer { flex: 1; }',
    '',
    '/* =========================================================================',
    '   表單元件',
    '   ========================================================================= */',
    '.m2kai-field { margin-top: var(--m2kai-s4); }',
    '.m2kai-field.is-tight { margin-top: var(--m2kai-s2); }',
    '.m2kai-label {',
    '  display: block;',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  color: var(--m2kai-fg);',
    '  margin-bottom: var(--m2kai-s2);',
    '}',
    '.m2kai-label .m2kai-req { color: var(--m2kai-danger); margin-left: 2px; }',
    '.m2kai-hint {',
    '  font-size: 12px;',
    '  color: var(--m2kai-fg-faint);',
    '  margin-top: var(--m2kai-s1);',
    '}',
    '.m2kai-hint code {',
    '  font-family: var(--m2kai-mono);',
    '  font-size: 11px;',
    '  padding: 1px 4px;',
    '  border-radius: 4px;',
    '  background: var(--m2kai-surface-3);',
    '}',
    '.m2kai-field-err {',
    '  display: none;',
    '  font-size: 12px;',
    '  color: var(--m2kai-danger);',
    '  margin-top: var(--m2kai-s1);',
    '}',
    '.m2kai-field.has-err .m2kai-field-err { display: block; }',
    '',
    '.m2kai-input,',
    '.m2kai-select,',
    '.m2kai-textarea {',
    '  width: 100%;',
    '  height: 32px;',
    '  padding: 0 10px;',
    '  background: var(--m2kai-field-bg);',
    '  border: 1px solid var(--m2kai-border-strong);',
    '  border-radius: var(--m2kai-radius-md);',
    '  color: var(--m2kai-fg);',
    '  outline: none;',
    '  appearance: none;',
    '  -webkit-appearance: none;',
    '  transition: border-color 0.13s, box-shadow 0.13s;',
    '}',
    '.m2kai-textarea {',
    '  height: auto;',
    '  min-height: 72px;',
    '  padding: var(--m2kai-s2) 10px;',
    '  resize: vertical;',
    '  line-height: 1.5;',
    '}',
    '.m2kai-input:focus,',
    '.m2kai-select:focus,',
    '.m2kai-textarea:focus {',
    '  border-color: var(--m2kai-accent);',
    '  box-shadow: 0 0 0 3px var(--m2kai-accent-ring);',
    '}',
    '.m2kai-input::placeholder,',
    '.m2kai-textarea::placeholder { color: var(--m2kai-fg-faint); }',
    '.m2kai-field.has-err .m2kai-input {',
    '  border-color: var(--m2kai-danger);',
    '  box-shadow: 0 0 0 3px var(--m2kai-danger-weak);',
    '}',
    '.m2kai-mono { font-family: var(--m2kai-mono); font-size: 13px; }',
    '',
    '.m2kai-select {',
    '  background-image:',
    '    linear-gradient(45deg, transparent 50%, var(--m2kai-fg-muted) 50%),',
    '    linear-gradient(135deg, var(--m2kai-fg-muted) 50%, transparent 50%);',
    '  background-position:',
    '    calc(100% - 16px) 13px,',
    '    calc(100% - 11px) 13px;',
    '  background-size: 5px 5px, 5px 5px;',
    '  background-repeat: no-repeat;',
    '  padding-right: 28px;',
    '  cursor: pointer;',
    '}',
    '',
    '.m2kai-row {',
    '  display: flex;',
    '  gap: var(--m2kai-s2);',
    '  align-items: center;',
    '}',
    '.m2kai-row .m2kai-input,',
    '.m2kai-row .m2kai-select { flex: 1; }',
    '',
    '/* Button */',
    '.m2kai-btn {',
    '  height: 32px;',
    '  padding: 0 var(--m2kai-s3);',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: var(--m2kai-s1);',
    '  border-radius: var(--m2kai-radius-md);',
    '  border: 1px solid var(--m2kai-border-strong);',
    '  background: var(--m2kai-surface);',
    '  color: var(--m2kai-fg);',
    '  font-size: 13px;',
    '  font-weight: 500;',
    '  cursor: pointer;',
    '  white-space: nowrap;',
    '  transition: background 0.13s, border-color 0.13s, transform 0.06s, box-shadow 0.13s;',
    '}',
    '.m2kai-btn .m2kai-ico { width: 14px; height: 14px; }',
    '.m2kai-btn:hover { background: var(--m2kai-surface-2); border-color: var(--m2kai-fg-faint); }',
    '.m2kai-btn:active { transform: translateY(1px); }',
    '.m2kai-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '.m2kai-btn:disabled { opacity: 0.55; cursor: default; }',
    '.m2kai-btn:disabled:hover { background: var(--m2kai-surface); border-color: var(--m2kai-border-strong); transform: none; }',
    '.m2kai-btn-primary {',
    '  background: var(--m2kai-accent);',
    '  border-color: var(--m2kai-accent);',
    '  color: var(--m2kai-on-accent);',
    '  font-weight: 600;',
    '}',
    '.m2kai-btn-primary:hover { background: var(--m2kai-accent-strong); border-color: var(--m2kai-accent-strong); }',
    '.m2kai-btn-primary:disabled:hover { background: var(--m2kai-accent); border-color: var(--m2kai-accent); }',
    '.m2kai-btn-ghost { border-color: transparent; background: transparent; color: var(--m2kai-fg-muted); }',
    '.m2kai-btn-ghost:hover { background: var(--m2kai-surface-2); color: var(--m2kai-fg); }',
    '.m2kai-btn-danger {',
    '  border-color: transparent;',
    '  background: var(--m2kai-danger-weak);',
    '  color: var(--m2kai-danger);',
    '}',
    '.m2kai-btn-danger:hover { background: var(--m2kai-danger); color: oklch(0.99 0 0); }',
    '.m2kai-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; }',
    '',
    '/* password 顯示/隱藏 + 測試連線 同列 */',
    '.m2kai-key-wrap { position: relative; flex: 1; }',
    '.m2kai-key-wrap .m2kai-input { padding-right: 40px; }',
    '.m2kai-key-toggle {',
    '  position: absolute;',
    '  right: 4px; top: 4px;',
    '  width: 24px; height: 24px;',
    '  display: grid; place-items: center;',
    '  border: none;',
    '  background: transparent;',
    '  color: var(--m2kai-fg-faint);',
    '  border-radius: 5px;',
    '  cursor: pointer;',
    '  transition: color 0.12s, background 0.12s;',
    '}',
    '.m2kai-key-toggle .m2kai-ico { width: 15px; height: 15px; }',
    '.m2kai-key-toggle:hover { color: var(--m2kai-fg); background: var(--m2kai-surface-3); }',
    '.m2kai-key-toggle:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--m2kai-accent-ring); }',
    '',
    '/* Spinner */',
    '.m2kai-spinner {',
    '  width: 13px; height: 13px;',
    '  border: 2px solid currentColor;',
    '  border-right-color: transparent;',
    '  border-radius: 50%;',
    '  animation: m2kai-spin 0.6s linear infinite;',
    '  display: inline-block;',
    '}',
    '@keyframes m2kai-spin { to { transform: rotate(360deg); } }',
    '',
    '/* 測試＋抓取 合一狀態訊息 */',
    '.m2kai-status {',
    '  display: none;',
    '  align-items: center;',
    '  gap: var(--m2kai-s1);',
    '  margin-top: var(--m2kai-s2);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  border-radius: var(--m2kai-radius-md);',
    '  font-size: 12px;',
    '  font-weight: 500;',
    '}',
    '.m2kai-status.is-shown { display: flex; animation: m2kai-fade 0.18s; }',
    '@keyframes m2kai-fade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }',
    '.m2kai-status.st-loading { background: var(--m2kai-surface-2); color: var(--m2kai-fg-muted); border: 1px solid var(--m2kai-border); }',
    '.m2kai-status.st-ok      { background: var(--m2kai-success-weak); color: var(--m2kai-success); border: 1px solid var(--m2kai-success-border); }',
    '.m2kai-status.st-err     { background: var(--m2kai-danger-weak); color: var(--m2kai-danger); border: 1px solid var(--m2kai-danger-border); }',
    '.m2kai-status .m2kai-spacer { flex: 1; }',
    '.m2kai-status .m2kai-ico { width: 14px; height: 14px; flex: none; }',
    '',
    '/* 可搜尋模型下拉 */',
    '.m2kai-modelpicker { position: relative; margin-top: var(--m2kai-s2); display: none; }',
    '.m2kai-modelpicker.is-shown { display: block; animation: m2kai-fade 0.18s; }',
    '.m2kai-search-wrap { position: relative; }',
    '.m2kai-search-icon {',
    '  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);',
    '  color: var(--m2kai-fg-faint); pointer-events: none;',
    '  width: 14px; height: 14px;',
    '}',
    '.m2kai-modelpicker .m2kai-input { padding-left: 30px; }',
    '.m2kai-modellist {',
    '  margin-top: var(--m2kai-s1);',
    '  max-height: 168px;',
    '  overflow: auto;',
    '  border: 1px solid var(--m2kai-border);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface);',
    '}',
    '.m2kai-modelopt {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  cursor: pointer;',
    '  font-family: var(--m2kai-mono);',
    '  font-size: 12px;',
    '  border-bottom: 1px solid var(--m2kai-border);',
    '  transition: background 0.1s;',
    '}',
    '.m2kai-modelopt:last-child { border-bottom: none; }',
    '.m2kai-modelopt:hover { background: var(--m2kai-surface-2); }',
    '.m2kai-modelopt.is-selected { background: var(--m2kai-accent-weak); color: var(--m2kai-accent-strong); font-weight: 600; }',
    '.m2kai-modelopt .m2kai-check { margin-left: auto; color: var(--m2kai-accent); opacity: 0; width: 14px; height: 14px; }',
    '.m2kai-modelopt.is-selected .m2kai-check { opacity: 1; }',
    '.m2kai-modelempty { padding: var(--m2kai-s4); text-align: center; color: var(--m2kai-fg-faint); font-size: 12px; }',
    '',
    '/* Badge */',
    '.m2kai-badge {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s1);',
    '  height: 19px;',
    '  padding: 0 7px;',
    '  border-radius: 999px;',
    '  font-size: 11px;',
    '  font-weight: 600;',
    '  background: var(--m2kai-surface-3);',
    '  color: var(--m2kai-fg-muted);',
    '}',
    '.m2kai-badge.bd-active { background: var(--m2kai-brand-weak); color: var(--m2kai-accent-strong); }',
    '.m2kai-badge.bd-local  { background: var(--m2kai-warn-weak); color: var(--m2kai-warn); }',
    '',
    '/* 角落「使用中」小 badge */',
    '.m2kai-corner-badge {',
    '  position: absolute;',
    '  top: -7px; right: 8px;',
    '  height: 16px;',
    '  padding: 0 6px;',
    '  border-radius: 999px;',
    '  font-size: 10px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.02em;',
    '  background: var(--m2kai-brand);',
    '  color: var(--m2kai-on-accent);',
    '  display: none;',
    '  align-items: center;',
    '}',
    '.m2kai-pcard.is-active .m2kai-corner-badge { display: inline-flex; }',
    '',
    '/* Switch */',
    '.m2kai-switch {',
    '  position: relative;',
    '  width: 36px; height: 20px;',
    '  flex: none;',
    '  display: inline-block;',
    '  cursor: pointer;',
    '}',
    '.m2kai-switch input { position: absolute; opacity: 0; width: 0; height: 0; }',
    '.m2kai-switch-track {',
    '  position: absolute; inset: 0;',
    '  background: var(--m2kai-border-strong);',
    '  border-radius: 999px;',
    '  transition: background 0.16s;',
    '}',
    '.m2kai-switch-thumb {',
    '  position: absolute;',
    '  top: 2px; left: 2px;',
    '  width: 16px; height: 16px;',
    '  background: var(--m2kai-surface);',
    '  border: 1px solid var(--m2kai-border-strong);',
    '  border-radius: 50%;',
    '  box-shadow: 0 1px 2px oklch(0 0 0 / 0.2);',
    '  transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);',
    '}',
    '.m2kai-switch input:checked + .m2kai-switch-track { background: var(--m2kai-accent); }',
    '.m2kai-switch input:checked + .m2kai-switch-track .m2kai-switch-thumb { transform: translateX(16px); border-color: transparent; }',
    '.m2kai-switch input:focus-visible + .m2kai-switch-track { box-shadow: 0 0 0 3px var(--m2kai-accent-ring); }',
    '',
    '/* =========================================================================',
    '   Tab 2 回覆',
    '   ========================================================================= */',
    '.m2kai-section {',
    '  padding: var(--m2kai-s5) var(--m2kai-s5);',
    '  max-width: 720px;',
    '}',
    '.m2kai-section-title {',
    '  font-size: 13px;',
    '  font-weight: 700;',
    '  color: var(--m2kai-fg);',
    '  margin: 0 0 2px;',
    '}',
    '.m2kai-section-desc {',
    '  font-size: 12px;',
    '  color: var(--m2kai-fg-muted);',
    '  margin-bottom: var(--m2kai-s3);',
    '}',
    '.m2kai-divider { height: 1px; background: var(--m2kai-border); margin: var(--m2kai-s5) 0; }',
    '',
    '/* 規則卡 */',
    '.m2kai-rule {',
    '  border: 1px solid var(--m2kai-border);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface-2);',
    '  margin-bottom: var(--m2kai-s2);',
    '  overflow: hidden;',
    '  transition: border-color 0.13s, box-shadow 0.13s;',
    '}',
    '.m2kai-rule:hover { border-color: var(--m2kai-border-strong); }',
    '.m2kai-rule.is-disabled { opacity: 0.62; }',
    '.m2kai-rule-topbar {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  padding-right: var(--m2kai-s3);',
    '}',
    '.m2kai-rule-head {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  flex: 1;',
    '  min-width: 0;',
    '  padding: var(--m2kai-s2) var(--m2kai-s3);',
    '  background: transparent;',
    '  border: none;',
    '  text-align: left;',
    '  cursor: pointer;',
    '  color: inherit;',
    '  border-radius: var(--m2kai-radius-md) var(--m2kai-radius-md) 0 0;',
    '}',
    '.m2kai-rule-head:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--m2kai-accent-ring); }',
    '.m2kai-rule-controls { display: flex; align-items: center; gap: var(--m2kai-s2); flex: none; }',
    '.m2kai-chevron {',
    '  color: var(--m2kai-fg-faint);',
    '  transition: transform 0.16s;',
    '  width: 12px; height: 12px;',
    '  flex: none;',
    '}',
    '.m2kai-rule.is-open .m2kai-chevron { transform: rotate(90deg); }',
    '.m2kai-rule-name { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }',
    '.m2kai-rule-name .m2kai-rule-match {',
    '  font-weight: 400;',
    '  color: var(--m2kai-fg-faint);',
    '  font-size: 12px;',
    '  margin-left: var(--m2kai-s1);',
    '  font-family: var(--m2kai-mono);',
    '}',
    '.m2kai-rule-body {',
    '  display: none;',
    '  padding: 0 var(--m2kai-s3) var(--m2kai-s3) var(--m2kai-s6);',
    '  border-top: 1px solid var(--m2kai-border);',
    '  padding-top: var(--m2kai-s3);',
    '}',
    '.m2kai-rule.is-open .m2kai-rule-body { display: block; animation: m2kai-fade 0.18s; }',
    '.m2kai-rule-grid {',
    '  display: grid;',
    '  grid-template-columns: 140px 1fr;',
    '  gap: var(--m2kai-s2);',
    '  margin-bottom: var(--m2kai-s2);',
    '}',
    '.m2kai-iconbtn-sm {',
    '  width: 26px; height: 26px;',
    '  flex: none;',
    '  display: grid; place-items: center;',
    '  border: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface);',
    '  border-radius: var(--m2kai-radius-sm);',
    '  color: var(--m2kai-fg-faint);',
    '  cursor: pointer;',
    '  transition: color 0.12s, border-color 0.12s, background 0.12s;',
    '}',
    '.m2kai-iconbtn-sm .m2kai-ico { width: 14px; height: 14px; }',
    '.m2kai-iconbtn-sm:hover { color: var(--m2kai-danger); border-color: var(--m2kai-danger); background: var(--m2kai-danger-weak); }',
    '.m2kai-iconbtn-sm:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--m2kai-accent-ring); }',
    '.m2kai-iconbtn-sm.is-confirm {',
    '  width: auto;',
    '  padding: 0 var(--m2kai-s2);',
    '  font-size: 11px;',
    '  font-weight: 600;',
    '  color: var(--m2kai-on-accent);',
    '  background: var(--m2kai-danger);',
    '  border-color: var(--m2kai-danger);',
    '}',
    '.m2kai-num { max-width: 140px; }',
    '',
    '/* 空狀態卡 */',
    '.m2kai-empty {',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  gap: var(--m2kai-s3);',
    '  padding: var(--m2kai-s6) var(--m2kai-s4);',
    '  border: 1px dashed var(--m2kai-border-strong);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface-2);',
    '  color: var(--m2kai-fg-muted);',
    '  text-align: center;',
    '}',
    '.m2kai-empty .m2kai-empty-ico { width: 28px; height: 28px; color: var(--m2kai-fg-faint); }',
    '.m2kai-empty-title { font-size: 13px; font-weight: 600; color: var(--m2kai-fg); }',
    '.m2kai-empty-desc { font-size: 12px; line-height: 1.5; max-width: 360px; }',
    '',
    '/* =========================================================================',
    '   Tab 3 進階',
    '   ========================================================================= */',
    '.m2kai-toggle-row {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: var(--m2kai-s3);',
    '  padding: var(--m2kai-s3);',
    '  border: 1px solid var(--m2kai-border);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface-2);',
    '  margin-bottom: var(--m2kai-s3);',
    '}',
    '.m2kai-toggle-row .m2kai-tr-main { flex: 1; }',
    '.m2kai-tr-title { font-size: 13px; font-weight: 600; }',
    '.m2kai-tr-desc { font-size: 12px; color: var(--m2kai-fg-muted); margin-top: 2px; }',
    '',
    '.m2kai-about {',
    '  padding: var(--m2kai-s4);',
    '  border: 1px solid var(--m2kai-border);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-surface-2);',
    '}',
    '.m2kai-about-row { display: flex; align-items: center; gap: var(--m2kai-s3); }',
    '.m2kai-about-meta { font-size: 12px; color: var(--m2kai-fg-muted); }',
    '.m2kai-safety {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  margin-top: var(--m2kai-s3);',
    '  padding: var(--m2kai-s3);',
    '  border-radius: var(--m2kai-radius-md);',
    '  background: var(--m2kai-success-weak);',
    '  border: 1px solid var(--m2kai-success-border);',
    '  color: var(--m2kai-success);',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '}',
    '.m2kai-safety .m2kai-ico { width: 16px; height: 16px; flex: none; }',
    '',
    '/* =========================================================================',
    '   Footer',
    '   ========================================================================= */',
    '.m2kai-footer {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s3);',
    '  padding: var(--m2kai-s3) var(--m2kai-s4);',
    '  border-top: 1px solid var(--m2kai-border);',
    '  background: var(--m2kai-surface);',
    '}',
    '.m2kai-footer-note {',
    '  flex: 1;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: var(--m2kai-s2);',
    '  font-size: 12px;',
    '  color: var(--m2kai-fg-faint);',
    '}',
    '.m2kai-dirty-dot {',
    '  width: 7px; height: 7px;',
    '  border-radius: 50%;',
    '  background: var(--m2kai-warn);',
    '  flex: none;',
    '  display: none;',
    '}',
    '.m2kai-footer.is-dirty .m2kai-dirty-dot { display: inline-block; }',
    '.m2kai-footer.is-dirty .m2kai-footer-note-clean { display: none; }',
    '.m2kai-footer-note-dirty { display: none; color: var(--m2kai-warn); font-weight: 600; }',
    '.m2kai-footer.is-dirty .m2kai-footer-note-dirty { display: inline; }',
    '',
    '/* 儲存成功微回饋 */',
    '.m2kai-saved-flash {',
    '  animation: m2kai-saved 0.5s ease;',
    '}',
    '@keyframes m2kai-saved {',
    '  0% { box-shadow: 0 0 0 0 var(--m2kai-accent-ring); }',
    '  60% { box-shadow: 0 0 0 6px transparent; }',
    '  100% { box-shadow: 0 0 0 0 transparent; }',
    '}',
    '',
    '/* Toast */',
    '.m2kai-toast {',
    '  position: fixed;',
    '  bottom: var(--m2kai-s5);',
    '  left: 50%;',
    '  transform: translateX(-50%) translateY(12px);',
    '  background: var(--m2kai-fg);',
    '  color: var(--m2kai-bg);',
    '  padding: var(--m2kai-s2) var(--m2kai-s4);',
    '  border-radius: 999px;',
    '  font-size: 13px;',
    '  font-weight: 500;',
    '  box-shadow: var(--m2kai-shadow-pop);',
    '  opacity: 0;',
    '  pointer-events: none;',
    '  transition: opacity 0.2s, transform 0.2s;',
    '  z-index: 10;',
    '}',
    '.m2kai-toast.is-shown { opacity: 1; transform: translateX(-50%) translateY(0); }',
    '',
    '/* scrollbar（Chromium 系；其他瀏覽器退化為原生） */',
    '.m2kai-root *::-webkit-scrollbar { width: 10px; height: 10px; }',
    '.m2kai-root *::-webkit-scrollbar-thumb {',
    '  background: var(--m2kai-border-strong);',
    '  border-radius: 999px;',
    '  border: 3px solid transparent;',
    '  background-clip: padding-box;',
    '}',
    '.m2kai-root *::-webkit-scrollbar-thumb:hover { background: var(--m2kai-fg-faint); background-clip: padding-box; border: 3px solid transparent; }',
    '',
    '/* inline SVG icon 預設尺寸（用 currentColor，隨 fg/accent/brand 變色） */',
    '.m2kai-ico { display: inline-block; vertical-align: middle; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',
    '',
    '/* 尊重 reduced-motion（掛在 .m2kai-root 下，不污染宿主） */',
    '@media (prefers-reduced-motion: reduce) {',
    '  .m2kai-root *,',
    '  .m2kai-panel,',
    '  .m2kai-toast {',
    '    animation-duration: 0.001s !important;',
    '    animation-iteration-count: 1 !important;',
    '    transition-duration: 0.001s !important;',
    '  }',
    '}'
  ].join('\n');

  var style = d.createElement('style');
  style.id = 'm2kaiStyle';
  style.textContent = css;
  (d.head || d.documentElement).appendChild(style);
}

// =========================================================================
// 10. 設定面板（重新設計：master-detail + 全部 autosave，掛在 top document）
//     入口 openSettings()；樣式由 settings-style.js 的 ensureSettingsStyle() 注入。
//     class 前綴 m2kai-、id m2kaiXxx；所有變更即時 saveConfig（無 draft / 無儲存鈕）。
// =========================================================================

// 產生自訂供應商 id（建立後不可變，同時當 apiKeys / models 的鍵）
function genCpId() {
  return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ---- inline SVG icon（沿用 mockup；用 currentColor 隨 fg/accent/brand 變色） ----
var M2KAI_ICON = {
  eye: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 3.4-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  refresh: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5"/></svg>',
  trash: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  search: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  ok: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  err: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  info: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  rules: '<svg class="m2kai-ico m2kai-empty-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  logo: '<svg class="m2kai-ico" style="width:18px;height:18px;" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>',
  shield: '<svg class="m2kai-ico" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  providers: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M9 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4M15 7h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4M8 12h8"/></svg>',
  reply: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m4 6 8 6 8-6"/></svg>',
  advanced: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 9.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 5.4V5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1z"/></svg>',
  chevron: '<svg class="m2kai-ico m2kai-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>'
};

function m2kaiIco(name, extraClass) {
  var s = M2KAI_ICON[name] || '';
  if (extraClass) s = s.replace('class="m2kai-ico', 'class="m2kai-ico ' + extraClass);
  return s;
}

// 內建供應商 avatar/縮寫對照（自訂一律 av-custom）
var M2KAI_BUILTIN_META = {
  openai: { avatar: 'av-openai', initial: 'O' },
  anthropic: { avatar: 'av-anthropic', initial: 'A' },
  gemini: { avatar: 'av-gemini', initial: 'G' }
};

// brand 色：依使用中供應商驅動 header / 卡片光暈（記憶點核心）
var M2KAI_BRAND = {
  openai: { weak: 'oklch(0.62 0.13 168 / 0.16)', strong: 'oklch(0.55 0.13 168)' },
  anthropic: { weak: 'oklch(0.64 0.14 47 / 0.18)', strong: 'oklch(0.56 0.15 47)' },
  gemini: { weak: 'oklch(0.60 0.15 255 / 0.16)', strong: 'oklch(0.55 0.16 255)' }
};

// =========================================================================
// 入口：建面板（或已存在則顯示）。簽名不可變（boot / button-injector 呼叫）。
// =========================================================================
function openSettings() {
  ensureSettingsStyle();
  var d = topDoc();

  // 已存在面板（新版 m2kaiRoot 或舊版 MODAL_ID）→ 顯示後 return
  var existing = d.getElementById('m2kaiRoot') || d.getElementById(MODAL_ID);
  if (existing) {
    var ov = existing.classList && existing.classList.contains('m2kai-overlay')
      ? existing : existing.closest && existing.closest('.m2kai-overlay');
    (ov || existing).style.display = 'flex';
    return;
  }

  // 開面板時讀一份 cfg，留在閉包；所有變更直接改它並 saveConfig
  var cfg = loadConfig();
  // 守門：確保結構齊全（loadConfig 已處理，這裡再保險一次）
  if (!cfg.apiKeys || typeof cfg.apiKeys !== 'object') cfg.apiKeys = {};
  if (!cfg.models || typeof cfg.models !== 'object') cfg.models = {};
  if (!Array.isArray(cfg.rules)) cfg.rules = [];
  if (!Array.isArray(cfg.customProviders)) cfg.customProviders = [];

  // 目前左欄選取（檢視中）的供應商 id；預設選使用中那個
  var selectedId = cfg.provider;

  var overlay = d.createElement('div');
  overlay.className = 'm2kai-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);' +
    'display:flex;align-items:center;justify-content:center;';

  var root = d.createElement('div');
  root.className = 'm2kai-root';
  root.id = 'm2kaiRoot';
  root.innerHTML = renderPanelShell();
  overlay.appendChild(root);
  d.body.appendChild(overlay);

  function close() { overlay.remove(); }

  // 點遮罩空白處（root 之外）即關閉
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  // ---- 小工具（綁在閉包，避免污染外層 scope） ----
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || root).querySelectorAll(sel));
  }
  function opt(v, label, sel) {
    return '<option value="' + escapeHtml(v) + '"' + (v === sel ? ' selected' : '') +
      '>' + escapeHtml(label) + '</option>';
  }
  function setStatus(el, kind, html) {
    if (!el) return;
    el.className = 'm2kai-status is-shown st-' + kind;
    el.innerHTML = html;
  }
  function clearStatus(el) {
    if (!el) return;
    el.className = 'm2kai-status';
    el.innerHTML = '';
  }
  // 把 cfg 寫入儲存（每次重要操作都呼叫）
  function persist() { saveConfig(cfg); }

  // 取得「供應商 view model」陣列：內建（PROVIDERS 順序）+ 自訂
  function providerList() {
    var arr = [];
    Object.keys(PROVIDERS).forEach(function (id) {
      var meta = M2KAI_BUILTIN_META[id] || { avatar: 'av-custom', initial: id.slice(0, 1).toUpperCase() };
      arr.push({
        id: id,
        builtin: true,
        label: PROVIDERS[id].label,
        avatar: meta.avatar,
        initial: meta.initial,
        protocol: id,
        defaultModel: PROVIDERS[id].defaultModel,
        meta: '雲端 · ' + id + ' 協定'
      });
    });
    (cfg.customProviders || []).forEach(function (cp) {
      var base = (cp.baseUrl || '未設定').replace(/^https?:\/\//, '');
      arr.push({
        id: cp.id,
        builtin: false,
        label: cp.label || '未命名',
        avatar: 'av-custom',
        initial: '本',
        protocol: cp.protocol || 'openai',
        baseUrl: cp.baseUrl || '',
        defaultModel: cp.defaultModel || '',
        meta: base + ' · ' + (cp.protocol || 'openai'),
        _cp: cp
      });
    });
    return arr;
  }
  function findProvider(id) {
    return providerList().filter(function (x) { return x.id === id; })[0] || null;
  }

  // brand 色：依使用中供應商偏移 header/卡片光暈
  function applyBrand(activeId) {
    var supportsOklch = !!(window.CSS && CSS.supports && CSS.supports('color', 'oklch(0.5 0.1 264)'));
    var b = (supportsOklch && M2KAI_BRAND[activeId]) || null;
    if (b) {
      root.style.setProperty('--m2kai-brand', b.strong);
      root.style.setProperty('--m2kai-brand-weak', b.weak);
    } else {
      root.style.removeProperty('--m2kai-brand');
      root.style.removeProperty('--m2kai-brand-weak');
    }
  }

  // 本機 URL 驗證（沿用 llm-adapter 的 isLocalBaseUrl；空字串不報紅）→ 回錯誤字串或 ''
  function localUrlError(url) {
    if (!url || !String(url).trim()) return '';
    return isLocalBaseUrl(normalizeBaseUrl(url))
      ? '' : '只允許本機位址（localhost / 127.0.0.1）；不可填外部主機。';
  }

  // =====================================================================
  // 左欄：供應商卡片清單（master）
  // =====================================================================
  function renderList() {
    var list = $('#m2kaiPList');
    $$('.m2kai-pcard', list).forEach(function (n) { n.remove(); });
    var addBtn = $('#m2kaiAddProvider');
    providerList().forEach(function (p) {
      var card = d.createElement('button');
      card.type = 'button';
      card.className = 'm2kai-pcard';
      card.setAttribute('data-id', p.id);
      if (p.id === selectedId) card.classList.add('is-selected');
      if (p.id === cfg.provider) card.classList.add('is-active');
      card.innerHTML =
        '<span class="m2kai-corner-badge">使用中</span>' +
        '<span class="m2kai-avatar ' + p.avatar + '">' + escapeHtml(p.initial) + '</span>' +
        '<span class="m2kai-pcard-main">' +
          '<span class="m2kai-pcard-name">' + escapeHtml(p.label) + '</span>' +
          '<span class="m2kai-pcard-meta">' + escapeHtml(p.meta) + '</span>' +
        '</span>' +
        '<span class="m2kai-active-dot" title="使用中"></span>';
      card.addEventListener('click', function () {
        selectedId = p.id;
        renderList();
        renderDetail();
      });
      list.insertBefore(card, addBtn);
    });
  }

  // =====================================================================
  // 右欄：供應商詳情（detail）
  // =====================================================================
  function renderDetail() {
    var box = $('#m2kaiPDetail');
    var p = findProvider(selectedId);

    if (!p) {
      box.innerHTML =
        '<div class="m2kai-empty" style="margin-top:40px;">' +
          m2kaiIco('info', 'm2kai-empty-ico') +
          '<div class="m2kai-empty-title">沒有可編輯的供應商</div>' +
          '<div class="m2kai-empty-desc">左側清單目前是空的。新增一個自訂供應商，或內建供應商會自動回填。</div>' +
        '</div>';
      return;
    }

    var isActive = p.id === cfg.provider;
    var isNew = !p.builtin && !p.label && !p.baseUrl;   // 剛新增、尚未填內容
    var key = (cfg.apiKeys || {})[p.id] || '';
    var model = (cfg.models || {})[p.id] || '';
    var canFetch = (p.builtin && p.id === 'openai') || (!p.builtin);
    var urlErr = p.builtin ? '' : localUrlError(p.baseUrl);

    var html =
      '<div class="m2kai-detail-head">' +
        '<span class="m2kai-avatar ' + p.avatar + '">' + escapeHtml(p.initial) + '</span>' +
        '<div>' +
          '<div class="m2kai-detail-title">' + escapeHtml(p.label || '未命名') +
            (p.builtin ? '' : ' <span class="m2kai-badge bd-local">本機</span>') +
          '</div>' +
          '<div class="m2kai-detail-sub">' + escapeHtml(p.meta) + '</div>' +
        '</div>' +
      '</div>';

    if (isNew) {
      html +=
        '<div class="m2kai-onboard">' +
          m2kaiIco('info') +
          '<span>新供應商：填入本機服務的 <b>Base URL</b>（例如 <code>http://localhost:51121</code>）後測試並抓取模型。Base URL 僅限本機。</span>' +
        '</div>';
    }

    // 使用中 / 設為使用中
    html +=
      '<div class="m2kai-use-row' + (isActive ? ' is-active' : '') + '">' +
        (isActive
          ? '<span>目前使用中 — 生成回覆會用這個供應商</span><span class="m2kai-spacer"></span>'
          : '<span>未使用</span><span class="m2kai-spacer"></span>' +
            '<button type="button" class="m2kai-btn m2kai-btn-sm" data-act="use">設為使用中</button>') +
      '</div>';

    // 自訂供應商：顯示名稱 / 協定 / Base URL（含 inline 本機驗證）
    if (!p.builtin) {
      html +=
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">顯示名稱</label>' +
          '<input class="m2kai-input" data-f="label" value="' + escapeHtml(p.label) + '" placeholder="例如 本機 CLIProxy">' +
        '</div>' +
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">相容協定</label>' +
          '<select class="m2kai-select" data-f="protocol">' +
            opt('openai', 'openai 相容', p.protocol) +
            opt('anthropic', 'anthropic 相容', p.protocol) +
            opt('gemini', 'gemini 相容', p.protocol) +
          '</select>' +
        '</div>' +
        '<div class="m2kai-field' + (urlErr ? ' has-err' : '') + '" data-field="baseUrl">' +
          '<label class="m2kai-label">Base URL <span class="m2kai-req" title="必填">*</span></label>' +
          '<div class="m2kai-row">' +
            '<input class="m2kai-input m2kai-mono" data-f="baseUrl" value="' + escapeHtml(p.baseUrl || '') + '" placeholder="例如 http://localhost:51121">' +
          '</div>' +
          '<div class="m2kai-hint">僅限本機 <code>localhost</code> ／ <code>127.0.0.1</code>；填到 host:port（不含 /v1）。</div>' +
          '<div class="m2kai-field-err" data-err="baseUrl">' + escapeHtml(urlErr || '') + '</div>' +
        '</div>' +
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">預設模型（主模型欄留空時套用）</label>' +
          '<input class="m2kai-input m2kai-mono" data-f="defaultModel" value="' + escapeHtml(p.defaultModel || '') + '" placeholder="例如 gpt-4o-mini">' +
        '</div>';
    }

    // API Key
    html +=
      '<div class="m2kai-field">' +
        '<label class="m2kai-label">API Key' + (p.builtin ? '' : '（本機服務常可留空）') + '</label>' +
        '<div class="m2kai-row">' +
          '<span class="m2kai-key-wrap">' +
            '<input class="m2kai-input m2kai-mono" type="password" data-k="key" value="' + escapeHtml(key) + '" placeholder="' + (p.builtin ? 'sk-...' : '可留空') + '">' +
            '<button type="button" class="m2kai-key-toggle" data-act="togglekey" title="顯示／隱藏" aria-label="顯示或隱藏 API Key">' + M2KAI_ICON.eye + '</button>' +
          '</span>' +
        '</div>' +
        (p.builtin ? '<div class="m2kai-hint">切換供應商會分別儲存各自的 Key。</div>' : '') +
      '</div>';

    // 模型欄位 + 測試並抓取
    html +=
      '<div class="m2kai-field is-tight">' +
        '<label class="m2kai-label">模型</label>' +
        '<div class="m2kai-row">' +
          '<input class="m2kai-input m2kai-mono" data-k="model" value="' + escapeHtml(model) + '" placeholder="' + (p.defaultModel ? '預設 ' + escapeHtml(p.defaultModel) : '模型名稱') + '">' +
          (canFetch
            ? '<button type="button" class="m2kai-btn" data-act="fetch"' + ((!p.builtin && urlErr) ? ' disabled' : '') + '>' + M2KAI_ICON.refresh + ' 測試並抓取模型</button>'
            : '') +
        '</div>' +
        '<div class="m2kai-hint">可手填，或抓取後從清單選；留空則用該供應商預設模型。</div>' +
        '<div class="m2kai-status" data-status="conn"></div>' +
        '<div class="m2kai-modelpicker" data-picker>' +
          '<div class="m2kai-search-wrap">' +
            '<span class="m2kai-search-icon">' + M2KAI_ICON.search + '</span>' +
            '<input class="m2kai-input m2kai-mono" data-modelsearch placeholder="搜尋模型…">' +
          '</div>' +
          '<div class="m2kai-modellist" data-modellist></div>' +
        '</div>' +
      '</div>';

    // 自訂供應商：刪除
    if (!p.builtin) {
      html +=
        '<div class="m2kai-divider"></div>' +
        '<button type="button" class="m2kai-btn m2kai-btn-danger" data-act="delete">' + M2KAI_ICON.trash + ' 刪除此供應商</button>';
    }

    box.innerHTML = html;
    bindDetail(box, p);
    updateUseAvailability(box, p);
  }

  // 控制「設為使用中」可用性（自訂供應商需有合法本機 Base URL）
  function updateUseAvailability(box, p) {
    var useBtn = box.querySelector('[data-act="use"]');
    if (!useBtn) return;
    var blocked = !p.builtin && (!p.baseUrl || localUrlError(p.baseUrl));
    useBtn.disabled = !!blocked;
    useBtn.title = blocked ? '請先填入合法的本機 Base URL' : '';
  }

  function bindDetail(box, p) {
    // 自訂供應商欄位即時寫回 cfg.customProviders → saveConfig
    if (!p.builtin && p._cp) {
      $$('[data-f]', box).forEach(function (el) {
        el.addEventListener('input', function () {
          var f = el.getAttribute('data-f');
          p._cp[f] = el.value;
          p[f] = el.value;
          if (f === 'baseUrl') {
            var fieldEl = box.querySelector('[data-field="baseUrl"]');
            var errEl = box.querySelector('[data-err="baseUrl"]');
            var msg = localUrlError(el.value);
            if (fieldEl) fieldEl.classList.toggle('has-err', !!msg);
            if (errEl) errEl.textContent = msg || '';
            $$('[data-act="fetch"]', box).forEach(function (b) { b.disabled = !!msg; });
            updateUseAvailability(box, p);
          }
          if (f === 'label' || f === 'baseUrl' || f === 'protocol') {
            var base = (p._cp.baseUrl || '未設定').replace(/^https?:\/\//, '');
            p.meta = base + ' · ' + (p._cp.protocol || 'openai');
            renderList();
          }
          persist();
        });
      });
    }

    // API Key（per-provider，寫 cfg.apiKeys[id]）
    var keyInput = box.querySelector('[data-k="key"]');
    if (keyInput) keyInput.addEventListener('input', function () {
      cfg.apiKeys[p.id] = keyInput.value;
      persist();
    });

    // 模型（per-provider，寫 cfg.models[id]）
    var modelInput = box.querySelector('[data-k="model"]');
    if (modelInput) modelInput.addEventListener('input', function () {
      cfg.models[p.id] = modelInput.value;
      persist();
    });

    // 顯示 / 隱藏 key
    var tk = box.querySelector('[data-act="togglekey"]');
    if (tk) tk.addEventListener('click', function () {
      var input = box.querySelector('[data-k="key"]');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      tk.innerHTML = show ? M2KAI_ICON.eyeoff : M2KAI_ICON.eye;
    });

    // 設為使用中（即時 saveConfig + applyBrand + 重繪高亮）
    var useBtn = box.querySelector('[data-act="use"]');
    if (useBtn) useBtn.addEventListener('click', function () {
      if (useBtn.disabled) return;
      cfg.provider = p.id;
      persist();
      applyBrand(p.id);
      renderList();
      renderDetail();
      toast('已設為使用中', 'ok');
    });

    // 測試並抓取模型（真實 fetchModels）
    $$('[data-act="fetch"]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        runFetch(btn, box, p);
      });
    });

    // 刪除自訂供應商（inline 二次確認）
    var del = box.querySelector('[data-act="delete"]');
    if (del) {
      var confirmTimer;
      del.addEventListener('click', function () {
        if (del.getAttribute('data-armed') !== '1') {
          del.setAttribute('data-armed', '1');
          del.innerHTML = M2KAI_ICON.trash + ' 確定刪除？再按一次';
          confirmTimer = setTimeout(function () {
            del.removeAttribute('data-armed');
            del.innerHTML = M2KAI_ICON.trash + ' 刪除此供應商';
          }, 3000);
          return;
        }
        clearTimeout(confirmTimer);
        deleteCustomProvider(p.id);
      });
    }
  }

  // 連線狀態機：測試並抓取 → 成功展開 picker / 失敗顯示重試
  function runFetch(btn, box, p) {
    var st = box.querySelector('[data-status="conn"]');
    var picker = box.querySelector('[data-picker]');
    if (picker) picker.classList.remove('is-shown');

    // baseUrl 來源：自訂用 cp.baseUrl；內建 openai 用官方端點
    var baseUrl = '';
    if (p.builtin) {
      if (p.id === 'openai') {
        baseUrl = 'https://api.openai.com';
      } else {
        toast('此供應商請手填模型', 'warn');
        return;
      }
    } else {
      if (localUrlError(p.baseUrl)) { toast('Base URL 僅支援 localhost／127.0.0.1', 'err'); return; }
      baseUrl = normalizeBaseUrl(p.baseUrl);
      if (!baseUrl) { toast('請先填入 Base URL', 'warn'); return; }
    }

    var key = (cfg.apiKeys || {})[p.id] || '';
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="m2kai-spinner"></span> 連線中';
    setStatus(st, 'loading', '<span class="m2kai-spinner"></span> 正在連線並抓取模型…');

    fetchModels(baseUrl, key).then(function (list) {
      btn.disabled = false;
      btn.innerHTML = orig;
      setStatus(st, 'ok', M2KAI_ICON.ok + '<span>連線成功 — 找到 ' + list.length + ' 個模型，請於下方清單選取</span>');
      if (picker) { buildModelPicker(picker, list, p, box); picker.classList.add('is-shown'); }
    }).catch(function (err) {
      btn.disabled = false;
      btn.innerHTML = orig;
      var msg = (err && err.message) ? err.message : String(err);
      setStatus(st, 'err',
        M2KAI_ICON.err + '<span>抓取失敗：' + escapeHtml(msg) + '</span>' +
        '<span class="m2kai-spacer"></span>' +
        '<button type="button" class="m2kai-btn m2kai-btn-sm m2kai-btn-ghost" data-retry>重試</button>');
      var rt = st.querySelector('[data-retry]');
      if (rt) rt.addEventListener('click', function () { runFetch(btn, box, p); });
    });
  }

  // 可搜尋模型 picker：點選回填 cfg.models[id] + saveConfig
  function buildModelPicker(picker, models, p, box) {
    var listEl = picker.querySelector('[data-modellist]');
    var search = picker.querySelector('[data-modelsearch]');
    function current() { return (cfg.models || {})[p.id] || ''; }
    function paint(filter) {
      var f = (filter || '').toLowerCase();
      var matched = models.filter(function (m) { return m.toLowerCase().indexOf(f) >= 0; });
      if (!matched.length) {
        listEl.innerHTML = '<div class="m2kai-modelempty">查無符合「' + escapeHtml(filter) + '」的模型</div>';
        return;
      }
      var cur = current();
      listEl.innerHTML = matched.map(function (m) {
        return '<div class="m2kai-modelopt' + (m === cur ? ' is-selected' : '') + '" data-m="' + escapeHtml(m) + '">' +
          '<span>' + escapeHtml(m) + '</span>' +
          M2KAI_ICON.check.replace('class="m2kai-ico', 'class="m2kai-ico m2kai-check') + '</div>';
      }).join('');
      $$('.m2kai-modelopt', listEl).forEach(function (optEl) {
        optEl.addEventListener('click', function () {
          var chosen = optEl.getAttribute('data-m');
          cfg.models[p.id] = chosen;
          persist();
          var input = box.querySelector('[data-k="model"]');
          if (input) input.value = chosen;
          paint(search.value);
          toast('已選用模型 ' + chosen, 'ok');
        });
      });
    }
    search.value = '';
    search.oninput = function () { paint(search.value); };
    paint('');
  }

  // 新增自訂供應商：建項 push、saveConfig、選中、聚焦名稱
  function addCustomProvider() {
    var np = { id: genCpId(), label: '', protocol: 'openai', baseUrl: '', defaultModel: '' };
    cfg.customProviders.push(np);
    persist();
    selectedId = np.id;
    renderList();
    renderDetail();
    var nameInput = $('#m2kaiPDetail [data-f="label"]');
    if (nameInput) { nameInput.focus(); }
  }

  // 刪除自訂供應商：移除項 + 清 apiKeys/models；若刪的是使用中則 fallback openai
  function deleteCustomProvider(id) {
    cfg.customProviders = (cfg.customProviders || []).filter(function (x) { return x.id !== id; });
    if (cfg.apiKeys) delete cfg.apiKeys[id];
    if (cfg.models) delete cfg.models[id];
    if (cfg.provider === id) cfg.provider = 'openai';
    persist();
    selectedId = cfg.provider;
    applyBrand(cfg.provider);
    renderList();
    renderDetail();
    toast('已刪除供應商', 'ok');
  }

  // =====================================================================
  // 回覆 tab：預設 prompt + 規則卡（含空狀態）+ 長度上限
  // =====================================================================
  function renderRules() {
    var box = $('#m2kaiRules');

    if (!cfg.rules.length) {
      box.innerHTML =
        '<div class="m2kai-empty">' +
          m2kaiIco('rules') +
          '<div class="m2kai-empty-title">尚無主旨規則</div>' +
          '<div class="m2kai-empty-desc">目前所有信件都會套用上方的「預設 System Prompt」。新增規則可針對特定主旨改用不同指示。</div>' +
          '<button type="button" class="m2kai-btn m2kai-btn-sm m2kai-btn-primary" id="m2kaiEmptyAddRule">＋ 新增規則</button>' +
        '</div>';
      var ea = $('#m2kaiEmptyAddRule', box);
      if (ea) ea.addEventListener('click', addRule);
      return;
    }

    box.innerHTML = cfg.rules.map(function (r, i) {
      return '' +
        '<div class="m2kai-rule' + (r.enabled ? '' : ' is-disabled') + '" data-i="' + i + '">' +
          '<div class="m2kai-rule-topbar">' +
            '<button class="m2kai-rule-head" type="button" data-head aria-expanded="false">' +
              M2KAI_ICON.chevron +
              '<span class="m2kai-rule-name">' + escapeHtml(r.name || '未命名') +
                '<span class="m2kai-rule-match">' + escapeHtml(r.matchType || 'contains') + ' · ' + escapeHtml(r.match || '') + '</span>' +
              '</span>' +
            '</button>' +
            '<div class="m2kai-rule-controls">' +
              '<label class="m2kai-switch">' +
                '<input type="checkbox" data-enabled' + (r.enabled ? ' checked' : '') + ' aria-label="啟用規則">' +
                '<span class="m2kai-switch-track"><span class="m2kai-switch-thumb"></span></span>' +
              '</label>' +
              '<button type="button" class="m2kai-iconbtn-sm" data-del title="刪除規則" aria-label="刪除規則">' + M2KAI_ICON.trash + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="m2kai-rule-body">' +
            '<div class="m2kai-rule-grid">' +
              '<div>' +
                '<label class="m2kai-label">比對方式</label>' +
                '<select class="m2kai-select" data-rtype>' +
                  opt('contains', 'contains', r.matchType) +
                  opt('startsWith', 'startsWith', r.matchType) +
                  opt('regex', 'regex', r.matchType) +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label class="m2kai-label">名稱</label>' +
                '<input class="m2kai-input" data-rname value="' + escapeHtml(r.name || '') + '">' +
              '</div>' +
            '</div>' +
            '<label class="m2kai-label">比對字串／關鍵字／regex</label>' +
            '<input class="m2kai-input m2kai-mono" data-rmatch value="' + escapeHtml(r.match || '') + '">' +
            '<label class="m2kai-label" style="margin-top:12px;">此規則的 System Prompt</label>' +
            '<textarea class="m2kai-textarea" data-rprompt>' + escapeHtml(r.systemPrompt || '') + '</textarea>' +
          '</div>' +
        '</div>';
    }).join('');

    $$('.m2kai-rule', box).forEach(function (card) {
      var i = +card.getAttribute('data-i');
      var head = card.querySelector('[data-head]');
      head.addEventListener('click', function () {
        var open = card.classList.toggle('is-open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      var en = card.querySelector('[data-enabled]');
      en.addEventListener('change', function () {
        cfg.rules[i].enabled = this.checked;
        card.classList.toggle('is-disabled', !this.checked);
        persist();
      });

      var del = card.querySelector('[data-del]');
      var armTimer;
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (del.getAttribute('data-armed') !== '1') {
          del.classList.add('is-confirm');
          del.setAttribute('data-armed', '1');
          del.textContent = '確定刪除？';
          armTimer = setTimeout(function () {
            del.classList.remove('is-confirm');
            del.removeAttribute('data-armed');
            del.innerHTML = M2KAI_ICON.trash;
          }, 3000);
          return;
        }
        clearTimeout(armTimer);
        cfg.rules.splice(i, 1);
        persist();
        renderRules();
        toast('已刪除規則', 'ok');
      });

      bindRuleField(card, i, 'rname', 'name');
      bindRuleField(card, i, 'rmatch', 'match');
      bindRuleField(card, i, 'rprompt', 'systemPrompt');
      bindRuleField(card, i, 'rtype', 'matchType');
    });
  }

  function bindRuleField(card, i, attr, key) {
    var el = card.querySelector('[data-' + attr + ']');
    if (!el) return;
    el.addEventListener('input', function () {
      cfg.rules[i][key] = el.value;
      var matchEl = card.querySelector('.m2kai-rule-match');
      if (matchEl) {
        matchEl.textContent = (cfg.rules[i].matchType || 'contains') + ' · ' + (cfg.rules[i].match || '');
      }
      var nameEl = card.querySelector('.m2kai-rule-name');
      if (key === 'name' && nameEl && nameEl.childNodes[0]) {
        nameEl.childNodes[0].nodeValue = cfg.rules[i].name || '未命名';
      }
      persist();
    });
  }

  function addRule() {
    cfg.rules.push({
      id: 'r' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      enabled: true,
      name: '新規則',
      match: '',
      matchType: 'contains',
      systemPrompt: ''
    });
    persist();
    renderRules();
    var cards = $$('.m2kai-rule');
    var last = cards[cards.length - 1];
    if (last) {
      last.classList.add('is-open');
      var h = last.querySelector('[data-head]');
      if (h) h.setAttribute('aria-expanded', 'true');
      last.scrollIntoView({ block: 'nearest' });
    }
  }

  // =====================================================================
  // 綁定：tabs / 回覆欄位 / 進階 / 主題 / 關閉
  // =====================================================================
  // Tabs（roving tabindex + 方向鍵）
  var tabs = $$('.m2kai-tab');
  function activateTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    var name = tab.getAttribute('data-tab');
    $$('.m2kai-page').forEach(function (pg) {
      pg.classList.toggle('is-active', pg.getAttribute('data-page') === name);
    });
  }
  tabs.forEach(function (tab, idx) {
    tab.addEventListener('click', function () { activateTab(tab); });
    tab.addEventListener('keydown', function (e) {
      var dir = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
      if (!dir) return;
      e.preventDefault();
      var next = tabs[(idx + dir + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });

  // 預設 System Prompt（即時 saveConfig）
  var defPrompt = $('#m2kaiDefaultPrompt');
  defPrompt.value = cfg.defaultSystemPrompt || '';
  defPrompt.addEventListener('input', function () {
    cfg.defaultSystemPrompt = defPrompt.value;
    persist();
  });

  // 原信長度上限
  var maxChars = $('#m2kaiMaxChars');
  maxChars.value = cfg.maxBodyChars || 6000;
  maxChars.addEventListener('input', function () {
    var n = parseInt(maxChars.value, 10);
    cfg.maxBodyChars = (n && n > 0) ? n : 6000;
    persist();
  });

  // 除錯模式
  var debugChk = $('#m2kaiDebug');
  debugChk.checked = !!cfg.debug;
  debugChk.addEventListener('change', function () {
    cfg.debug = debugChk.checked;
    persist();
    toast(cfg.debug ? '已開啟除錯模式' : '已關閉除錯模式', 'ok');
  });

  // 新增供應商 / 新增規則
  $('#m2kaiAddProvider').addEventListener('click', addCustomProvider);
  $('#m2kaiAddRule').addEventListener('click', addRule);

  // 主題切換
  $('#m2kaiThemeBtn').addEventListener('click', function () {
    var cur = root.getAttribute('data-m2kai-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next;
    if (!cur) next = prefersDark ? 'light' : 'dark';
    else next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-m2kai-theme', next);
    toast(next === 'dark' ? '已切換深色' : '已切換淺色', 'ok');
  });

  // 關閉（footer 與 header 各一顆；無儲存/取消）
  $('#m2kaiCloseBtn').addEventListener('click', close);
  var footerClose = $('#m2kaiFooterClose');
  if (footerClose) footerClose.addEventListener('click', close);

  // ---- 初次渲染 ----
  applyBrand(cfg.provider);
  renderList();
  renderDetail();
  renderRules();
}

// =========================================================================
// 面板靜態結構（master-detail + 三 tab + footer 只剩「關閉」）
// 動態內容（卡片清單 / 詳情 / 規則）由 JS 注入。
// =========================================================================
function renderPanelShell() {
  var version = '';
  try {
    version = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '';
  } catch (e) { version = ''; }
  var versionText = (version ? ('版本 ' + version) : '版本 —') + ' · Tampermonkey userscript';

  return '' +
    '<div class="m2kai-panel" id="m2kaiPanel">' +

      // Header
      '<header class="m2kai-header">' +
        '<div class="m2kai-logo" id="m2kaiLogo">' + M2KAI_ICON.logo + '</div>' +
        '<div class="m2kai-title-wrap">' +
          '<div class="m2kai-title-row">' +
            '<h1 class="m2kai-title">AI 回覆設定</h1>' +
            '<span class="m2kai-safety-badge" title="本工具只生成草稿、絕不自動送信">' +
              M2KAI_ICON.shield + '絕不自動送信' +
            '</span>' +
          '</div>' +
          '<div class="m2kai-subtitle">Mail2000 智慧回信助理</div>' +
        '</div>' +
        '<div class="m2kai-header-spacer"></div>' +
        '<button type="button" class="m2kai-iconbtn" id="m2kaiThemeBtn" title="切換淺／深色" aria-label="切換淺／深色">' +
          '<svg class="m2kai-ico" style="width:16px;height:16px;" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>' +
        '</button>' +
        '<button type="button" class="m2kai-iconbtn m2kai-close" id="m2kaiCloseBtn" title="關閉" aria-label="關閉">&times;</button>' +
      '</header>' +

      // Tabs
      '<div class="m2kai-tabs" role="tablist" aria-label="設定分頁">' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabProviders" aria-selected="true" aria-controls="m2kaiPageProviders" data-tab="providers">' +
          M2KAI_ICON.providers + '供應商' +
        '</button>' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabReply" aria-selected="false" aria-controls="m2kaiPageReply" tabindex="-1" data-tab="reply">' +
          M2KAI_ICON.reply + '回覆' +
        '</button>' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabAdvanced" aria-selected="false" aria-controls="m2kaiPageAdvanced" tabindex="-1" data-tab="advanced">' +
          M2KAI_ICON.advanced + '進階' +
        '</button>' +
      '</div>' +

      // Body
      '<div class="m2kai-body">' +

        // Tab ① 供應商
        '<section class="m2kai-page is-active" id="m2kaiPageProviders" role="tabpanel" aria-labelledby="m2kaiTabProviders" data-page="providers">' +
          '<div class="m2kai-md">' +
            '<div class="m2kai-md-list" id="m2kaiPList">' +
              '<div class="m2kai-list-label">供應商</div>' +
              '<button type="button" class="m2kai-addcard" id="m2kaiAddProvider">＋ 新增自訂供應商</button>' +
            '</div>' +
            '<div class="m2kai-md-detail" id="m2kaiPDetail"></div>' +
          '</div>' +
        '</section>' +

        // Tab ② 回覆
        '<section class="m2kai-page" id="m2kaiPageReply" role="tabpanel" aria-labelledby="m2kaiTabReply" data-page="reply">' +
          '<div class="m2kai-section">' +
            '<h2 class="m2kai-section-title">預設 System Prompt</h2>' +
            '<p class="m2kai-section-desc">沒有任何主旨規則命中時，套用這段指示。</p>' +
            '<textarea class="m2kai-textarea" id="m2kaiDefaultPrompt" style="min-height:96px;"></textarea>' +
            '<div class="m2kai-divider"></div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
              '<h2 class="m2kai-section-title" style="margin:0;">依主旨套用不同 System Prompt</h2>' +
              '<div style="flex:1;"></div>' +
              '<button type="button" class="m2kai-btn m2kai-btn-sm" id="m2kaiAddRule">＋ 新增規則</button>' +
            '</div>' +
            '<p class="m2kai-section-desc">由上而下比對來信主旨，第一個命中的規則生效。</p>' +
            '<div id="m2kaiRules"></div>' +
          '</div>' +
        '</section>' +

        // Tab ③ 進階
        '<section class="m2kai-page" id="m2kaiPageAdvanced" role="tabpanel" aria-labelledby="m2kaiTabAdvanced" data-page="advanced">' +
          '<div class="m2kai-section">' +
            '<h2 class="m2kai-section-title">技術參數</h2>' +
            '<p class="m2kai-section-desc">送進 LLM 前的處理設定。</p>' +
            '<div class="m2kai-field" style="margin-top:0;">' +
              '<label class="m2kai-label">原信內文長度上限</label>' +
              '<div class="m2kai-row">' +
                '<input type="number" class="m2kai-input m2kai-num m2kai-mono" id="m2kaiMaxChars">' +
                '<span class="m2kai-hint" style="margin-top:0;">字元；超過會截斷後再送進 LLM。</span>' +
              '</div>' +
            '</div>' +
            '<div class="m2kai-divider"></div>' +
            '<h2 class="m2kai-section-title">除錯</h2>' +
            '<p class="m2kai-section-desc">開發與排錯時使用。</p>' +
            '<div class="m2kai-toggle-row">' +
              '<div class="m2kai-tr-main">' +
                '<div class="m2kai-tr-title">除錯模式</div>' +
                '<div class="m2kai-tr-desc">在瀏覽器 console 輸出請求／回應與選擇器命中狀況。</div>' +
              '</div>' +
              '<label class="m2kai-switch">' +
                '<input type="checkbox" id="m2kaiDebug" aria-label="除錯模式">' +
                '<span class="m2kai-switch-track"><span class="m2kai-switch-thumb"></span></span>' +
              '</label>' +
            '</div>' +
            '<div class="m2kai-divider"></div>' +
            '<h2 class="m2kai-section-title">關於</h2>' +
            '<p class="m2kai-section-desc">這支腳本的身分與安全承諾。</p>' +
            '<div class="m2kai-about">' +
              '<div class="m2kai-about-row">' +
                '<div class="m2kai-logo" style="animation:none;">' + M2KAI_ICON.logo + '</div>' +
                '<div>' +
                  '<div style="font-weight:700;">Mail2000 AI 自動回覆</div>' +
                  '<div class="m2kai-about-meta">' + escapeHtml(versionText) + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="m2kai-safety">' +
                M2KAI_ICON.shield + '本工具只生成回覆草稿並寫入內文，絕不自動送信。' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

      '</div>' +

      // Footer（autosave 模型：只剩「關閉」）
      '<footer class="m2kai-footer" id="m2kaiFooter">' +
        '<span class="m2kai-footer-note">' +
          '<span class="m2kai-footer-note-clean">設定即時儲存在本機 Tampermonkey，不會上傳。</span>' +
        '</span>' +
        '<button type="button" class="m2kai-btn m2kai-btn-primary" id="m2kaiFooterClose">關閉</button>' +
      '</footer>' +

    '</div>';
}

// =========================================================================
// 9. 按鈕注入（回信編輯器工具列）
// =========================================================================
function makeToolbarButton(doc, id, text, title, onClick) {
  const b = doc.createElement('div');
  b.id = id;
  b.className = 'm2k-ui-cssmenu-item';
  b.title = title || text;
  b.textContent = text;
  b.style.cssText = 'cursor:pointer;user-select:none;';
  b.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.busy === '1') return;
    onClick();
  });
  return b;
}

function injectComposeButtons() {
  if (!isComposeFrame()) return false;
  const anchor = document.getElementById('TemplateMenu');
  if (!anchor || !anchor.parentNode) return false;
  if (document.getElementById(BTN_ID)) return true; // 已注入

  const genBtn = makeToolbarButton(document, BTN_ID, '💡 AI 生成回覆',
    '依原信內容與主旨規則生成回覆草稿（不會自動送信）', generateReply);
  const setBtn = makeToolbarButton(document, SETTINGS_BTN_ID, '⚙',
    'AI 回覆設定', openSettings);

  // 注入在「信件範本」(#TemplateMenu) 左邊：genBtn、setBtn 依序插在 anchor 之前
  anchor.parentNode.insertBefore(genBtn, anchor);
  anchor.parentNode.insertBefore(setBtn, anchor);
  log('buttons injected');
  return true;
}

// =========================================================================
// 11. 啟動（每個 frame 各自執行）
// =========================================================================
function boot() {
  // 只在頂層註冊選單命令，避免重複
  if (window.top === window.self) {
    try { GM_registerMenuCommand('AI 回覆設定', openSettings); } catch (e) { /* noop */ }
  }
  // 在回信編輯器 frame 持續嘗試注入按鈕
  if (isComposeFrame()) {
    if (!injectComposeButtons()) {
      const obs = new MutationObserver(function () { if (injectComposeButtons()) obs.disconnect(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      // 保險：逾時停止觀察
      setTimeout(function () { obs.disconnect(); }, 30000);
    }
  }
}

boot();

})();
