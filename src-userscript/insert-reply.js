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
