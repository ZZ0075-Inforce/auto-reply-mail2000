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
