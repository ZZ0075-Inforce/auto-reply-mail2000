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
      if (!Array.isArray(cfg.customProviders)) cfg.customProviders = [];
      // per-provider 模型守門
      if (!cfg.models || typeof cfg.models !== 'object') cfg.models = {};
      // 向後相容遷移：舊全域 cfg.model 非空且該供應商尚無記錄時，補進 cfg.models（保留 cfg.model 當 legacy fallback）
      if (cfg.model && !cfg.models[cfg.provider]) cfg.models[cfg.provider] = cfg.model;
    } catch (e) {
      cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }
  return cfg;
}

function saveConfig(cfg) {
  GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
}
