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
