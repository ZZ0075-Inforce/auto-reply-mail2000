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
