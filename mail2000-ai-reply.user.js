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
    ]
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
  // 6. LLM 呼叫（OpenAI / Anthropic / Gemini，可切換）
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

  // 依供應商組出請求規格 { url, headers, data, parse }
  function buildRequestSpec(provider, key, model, system, user) {
    if (provider === 'openai') {
      return {
        url: PROVIDERS.openai.endpoint,
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
    if (provider === 'anthropic') {
      return {
        url: PROVIDERS.anthropic.endpoint,
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
    if (provider === 'gemini') {
      return {
        url: PROVIDERS.gemini.endpoint + '/' + encodeURIComponent(model) + ':generateContent',
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
    throw new Error('未知的供應商：' + provider);
  }

  // 透過 GM_xmlhttpRequest 呼叫（繞過頁面 CORS/CSP）→ Promise<string>
  function callLLM(cfg, system, user) {
    const provider = cfg.provider;
    const key = (cfg.apiKeys || {})[provider];
    const model = cfg.model || PROVIDERS[provider].defaultModel;
    const spec = buildRequestSpec(provider, key, model, system, user);
    log('callLLM', provider, model);
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

    const key = (cfg.apiKeys || {})[cfg.provider];
    if (!key) { toast('尚未設定 ' + cfg.provider + ' 的 API Key，請先開啟「AI 設定」。', 'warn'); return; }

    const body = mail.body.slice(0, cfg.maxBodyChars);
    const truncated = mail.body.length > cfg.maxBodyChars;
    const userContent =
      '以下是收到的信件，請依指示撰寫繁體中文回覆。\n\n' +
      '主旨：' + stripRePrefix(mail.subject) + '\n' +
      (mail.from ? '寄件人：' + mail.from + '\n' : '') +
      '內文：\n' + body + (truncated ? '\n…(內文過長已截斷)' : '');

    if (btn) { btn.dataset.busy = '1'; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
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
      if (btn) { btn.dataset.busy = ''; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    }
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

    const genBtn = makeToolbarButton(document, BTN_ID, '🤖 AI 生成回覆',
      '依原信內容與主旨規則生成回覆草稿（不會自動送信）', generateReply);
    const setBtn = makeToolbarButton(document, SETTINGS_BTN_ID, '⚙',
      'AI 回覆設定', openSettings);

    anchor.parentNode.insertBefore(genBtn, anchor.nextSibling);
    anchor.parentNode.insertBefore(setBtn, genBtn.nextSibling);
    log('buttons injected');
    return true;
  }

  // =========================================================================
  // 10. 設定面板（掛在 top document）
  // =========================================================================
  function openSettings() {
    const d = topDoc();
    let modal = d.getElementById(MODAL_ID);
    if (modal) { modal.style.display = 'flex'; return; }

    const cfg = loadConfig();
    modal = d.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:"Microsoft JhengHei",sans-serif;';

    const card = d.createElement('div');
    card.style.cssText =
      'background:#fff;width:680px;max-width:94vw;max-height:90vh;overflow:auto;' +
      'border-radius:12px;padding:0;box-shadow:0 12px 40px rgba(0,0,0,.3);';
    card.innerHTML = renderSettingsHtml(cfg);
    modal.appendChild(card);
    d.body.appendChild(modal);

    bindSettingsEvents(d, modal, card);
  }

  function providerOptions(selected) {
    return Object.keys(PROVIDERS).map(function (k) {
      return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' +
        escapeHtml(PROVIDERS[k].label) + '</option>';
    }).join('');
  }

  function renderRuleRow(r, i) {
    return '' +
      '<div class="m2k-rule" data-idx="' + i + '" style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:13px;">' +
            '<input type="checkbox" class="r-enabled"' + (r.enabled ? ' checked' : '') + '> 啟用</label>' +
          '<input class="r-name" placeholder="規則名稱" value="' + escapeHtml(r.name || '') + '" style="flex:1;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;">' +
          '<button class="r-del" style="border:none;background:#fee2e2;color:#b91c1c;border-radius:4px;padding:4px 8px;cursor:pointer;">刪除</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
          '<select class="r-type" style="padding:4px;border:1px solid #cbd5e1;border-radius:4px;">' +
            ['contains', 'startsWith', 'regex'].map(function (t) {
              return '<option value="' + t + '"' + (r.matchType === t ? ' selected' : '') + '>' + t + '</option>';
            }).join('') +
          '</select>' +
          '<input class="r-match" placeholder="比對字串/關鍵字/regex" value="' + escapeHtml(r.match || '') + '" style="flex:1;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;">' +
        '</div>' +
        '<textarea class="r-prompt" placeholder="此規則套用的 system prompt" style="width:100%;min-height:54px;padding:6px;border:1px solid #cbd5e1;border-radius:4px;box-sizing:border-box;">' + escapeHtml(r.systemPrompt || '') + '</textarea>' +
      '</div>';
  }

  function renderSettingsHtml(cfg) {
    const inputCss = 'width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;font-size:14px;';
    const labelCss = 'display:block;font-size:13px;font-weight:600;margin:12px 0 4px;color:#334155;';
    return '' +
      '<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
        '<h2 style="margin:0;font-size:18px;color:#0f172a;">Mail2000 AI 回覆設定</h2>' +
        '<span id="m2kAiClose" style="cursor:pointer;font-size:22px;color:#64748b;line-height:1;">&times;</span>' +
      '</div>' +
      '<div style="padding:18px 22px;">' +
        '<label style="' + labelCss + '">LLM 供應商</label>' +
        '<select id="m2kProvider" style="' + inputCss + '">' + providerOptions(cfg.provider) + '</select>' +
        '<label style="' + labelCss + '">模型（留空使用預設）</label>' +
        '<input id="m2kModel" style="' + inputCss + '" placeholder="" value="' + escapeHtml(cfg.model || '') + '">' +
        '<div id="m2kModelHint" style="font-size:12px;color:#64748b;margin-top:3px;"></div>' +

        '<label style="' + labelCss + '">API Key</label>' +
        '<div style="display:flex;gap:6px;">' +
          '<input id="m2kApiKey" type="password" style="' + inputCss + '" placeholder="僅儲存在本機 Tampermonkey">' +
          '<button id="m2kToggleKey" style="border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:0 10px;cursor:pointer;">顯示</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:3px;">切換供應商會分別儲存各自的 Key。</div>' +

        '<label style="' + labelCss + '">預設 System Prompt</label>' +
        '<textarea id="m2kDefaultPrompt" style="' + inputCss + 'min-height:70px;">' + escapeHtml(cfg.defaultSystemPrompt || '') + '</textarea>' +

        '<label style="' + labelCss + '">原信內文長度上限（字元）</label>' +
        '<input id="m2kMaxChars" type="number" style="' + inputCss + '" value="' + (cfg.maxBodyChars || 6000) + '">' +

        '<label style="' + labelCss + '">依主旨套用不同 System Prompt（由上而下，第一個命中者生效）</label>' +
        '<div id="m2kRules">' + (cfg.rules || []).map(renderRuleRow).join('') + '</div>' +
        '<button id="m2kAddRule" style="border:1px dashed #94a3b8;background:#f8fafc;border-radius:6px;padding:6px 12px;cursor:pointer;">+ 新增規則</button>' +

        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:14px;">' +
          '<input type="checkbox" id="m2kDebug"' + (cfg.debug ? ' checked' : '') + '> 除錯模式（console 輸出）</label>' +
      '</div>' +
      '<div style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">' +
        '<button id="m2kCancel" style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:8px 16px;cursor:pointer;">取消</button>' +
        '<button id="m2kSave" style="border:none;background:#2563eb;color:#fff;border-radius:6px;padding:8px 18px;cursor:pointer;">儲存</button>' +
      '</div>';
  }

  function bindSettingsEvents(d, modal, card) {
    const cfg = loadConfig();
    const $ = function (id) { return card.querySelector('#' + id); };
    const providerSel = $('m2kProvider');
    const modelInput = $('m2kModel');
    const apiKeyInput = $('m2kApiKey');
    const modelHint = $('m2kModelHint');

    // 目前各 provider 的 key（暫存在記憶體，儲存時寫回）
    const keys = Object.assign({}, cfg.apiKeys);
    let prevProvider = providerSel.value;

    function refreshProviderView() {
      const p = providerSel.value;
      apiKeyInput.value = keys[p] || '';
      modelHint.textContent = '預設模型：' + PROVIDERS[p].defaultModel;
    }
    providerSel.addEventListener('change', function () {
      keys[prevProvider] = apiKeyInput.value;   // 保留上一個 provider 的輸入
      prevProvider = providerSel.value;
      refreshProviderView();
    });
    refreshProviderView();

    $('m2kToggleKey').addEventListener('click', function () {
      const t = apiKeyInput.type === 'password' ? 'text' : 'password';
      apiKeyInput.type = t;
      this.textContent = t === 'password' ? '顯示' : '隱藏';
    });

    // 規則新增 / 刪除（事件委派）
    const rulesBox = $('m2kRules');
    $('m2kAddRule').addEventListener('click', function () {
      const idx = rulesBox.querySelectorAll('.m2k-rule').length;
      const tmp = d.createElement('div');
      tmp.innerHTML = renderRuleRow(
        { enabled: true, name: '', match: '', matchType: 'contains', systemPrompt: '' }, idx);
      rulesBox.appendChild(tmp.firstChild);
    });
    rulesBox.addEventListener('click', function (e) {
      if (e.target && e.target.classList.contains('r-del')) {
        const row = e.target.closest('.m2k-rule');
        if (row) row.remove();
      }
    });

    function close() { modal.remove(); }
    $('m2kAiClose').addEventListener('click', close);
    $('m2kCancel').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    $('m2kSave').addEventListener('click', function () {
      keys[providerSel.value] = apiKeyInput.value; // 存當前 provider 的 key
      const rules = [];
      rulesBox.querySelectorAll('.m2k-rule').forEach(function (row, i) {
        rules.push({
          id: 'r' + Date.now() + '_' + i,
          enabled: row.querySelector('.r-enabled').checked,
          name: row.querySelector('.r-name').value.trim(),
          match: row.querySelector('.r-match').value.trim(),
          matchType: row.querySelector('.r-type').value,
          systemPrompt: row.querySelector('.r-prompt').value
        });
      });
      const newCfg = {
        provider: providerSel.value,
        model: modelInput.value.trim(),
        apiKeys: keys,
        defaultSystemPrompt: $('m2kDefaultPrompt').value,
        maxBodyChars: parseInt($('m2kMaxChars').value, 10) || 6000,
        debug: $('m2kDebug').checked,
        rules: rules
      };
      saveConfig(newCfg);
      close();
      toast('設定已儲存。', 'ok');
    });
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
