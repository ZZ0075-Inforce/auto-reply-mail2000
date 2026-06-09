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
