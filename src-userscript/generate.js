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
