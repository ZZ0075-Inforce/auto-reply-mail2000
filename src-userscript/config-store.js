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
