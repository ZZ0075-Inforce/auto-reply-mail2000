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
