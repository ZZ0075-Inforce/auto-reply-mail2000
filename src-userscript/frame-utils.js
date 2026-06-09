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
