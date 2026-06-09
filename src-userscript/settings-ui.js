// =========================================================================
// 10. 設定面板（重新設計：master-detail + 全部 autosave，掛在 top document）
//     入口 openSettings()；樣式由 settings-style.js 的 ensureSettingsStyle() 注入。
//     class 前綴 m2kai-、id m2kaiXxx；所有變更即時 saveConfig（無 draft / 無儲存鈕）。
// =========================================================================

// 產生自訂供應商 id（建立後不可變，同時當 apiKeys / models 的鍵）
function genCpId() {
  return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ---- inline SVG icon（沿用 mockup；用 currentColor 隨 fg/accent/brand 變色） ----
var M2KAI_ICON = {
  eye: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 3.4-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  refresh: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5"/></svg>',
  trash: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  search: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  ok: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  err: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  info: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  rules: '<svg class="m2kai-ico m2kai-empty-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  logo: '<svg class="m2kai-ico" style="width:18px;height:18px;" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>',
  shield: '<svg class="m2kai-ico" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  providers: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M9 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4M15 7h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4M8 12h8"/></svg>',
  reply: '<svg class="m2kai-ico" viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m4 6 8 6 8-6"/></svg>',
  advanced: '<svg class="m2kai-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 9.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 5.4V5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1z"/></svg>',
  chevron: '<svg class="m2kai-ico m2kai-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>'
};

function m2kaiIco(name, extraClass) {
  var s = M2KAI_ICON[name] || '';
  if (extraClass) s = s.replace('class="m2kai-ico', 'class="m2kai-ico ' + extraClass);
  return s;
}

// 內建供應商 avatar/縮寫對照（自訂一律 av-custom）
var M2KAI_BUILTIN_META = {
  openai: { avatar: 'av-openai', initial: 'O' },
  anthropic: { avatar: 'av-anthropic', initial: 'A' },
  gemini: { avatar: 'av-gemini', initial: 'G' }
};

// brand 色：依使用中供應商驅動 header / 卡片光暈（記憶點核心）
var M2KAI_BRAND = {
  openai: { weak: 'oklch(0.62 0.13 168 / 0.16)', strong: 'oklch(0.55 0.13 168)' },
  anthropic: { weak: 'oklch(0.64 0.14 47 / 0.18)', strong: 'oklch(0.56 0.15 47)' },
  gemini: { weak: 'oklch(0.60 0.15 255 / 0.16)', strong: 'oklch(0.55 0.16 255)' }
};

// =========================================================================
// 入口：建面板（或已存在則顯示）。簽名不可變（boot / button-injector 呼叫）。
// =========================================================================
function openSettings() {
  ensureSettingsStyle();
  var d = topDoc();

  // 已存在面板（新版 m2kaiRoot 或舊版 MODAL_ID）→ 顯示後 return
  var existing = d.getElementById('m2kaiRoot') || d.getElementById(MODAL_ID);
  if (existing) {
    var ov = existing.classList && existing.classList.contains('m2kai-overlay')
      ? existing : existing.closest && existing.closest('.m2kai-overlay');
    (ov || existing).style.display = 'flex';
    return;
  }

  // 開面板時讀一份 cfg，留在閉包；所有變更直接改它並 saveConfig
  var cfg = loadConfig();
  // 守門：確保結構齊全（loadConfig 已處理，這裡再保險一次）
  if (!cfg.apiKeys || typeof cfg.apiKeys !== 'object') cfg.apiKeys = {};
  if (!cfg.models || typeof cfg.models !== 'object') cfg.models = {};
  if (!Array.isArray(cfg.rules)) cfg.rules = [];
  if (!Array.isArray(cfg.customProviders)) cfg.customProviders = [];

  // 目前左欄選取（檢視中）的供應商 id；預設選使用中那個
  var selectedId = cfg.provider;

  var overlay = d.createElement('div');
  overlay.className = 'm2kai-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);' +
    'display:flex;align-items:center;justify-content:center;';

  var root = d.createElement('div');
  root.className = 'm2kai-root';
  root.id = 'm2kaiRoot';
  root.innerHTML = renderPanelShell();
  overlay.appendChild(root);
  d.body.appendChild(overlay);

  function close() { overlay.remove(); }

  // 點遮罩空白處（root 之外）即關閉
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  // ---- 小工具（綁在閉包，避免污染外層 scope） ----
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || root).querySelectorAll(sel));
  }
  function opt(v, label, sel) {
    return '<option value="' + escapeHtml(v) + '"' + (v === sel ? ' selected' : '') +
      '>' + escapeHtml(label) + '</option>';
  }
  function setStatus(el, kind, html) {
    if (!el) return;
    el.className = 'm2kai-status is-shown st-' + kind;
    el.innerHTML = html;
  }
  function clearStatus(el) {
    if (!el) return;
    el.className = 'm2kai-status';
    el.innerHTML = '';
  }
  // 把 cfg 寫入儲存（每次重要操作都呼叫）
  function persist() { saveConfig(cfg); }

  // 取得「供應商 view model」陣列：內建（PROVIDERS 順序）+ 自訂
  function providerList() {
    var arr = [];
    Object.keys(PROVIDERS).forEach(function (id) {
      var meta = M2KAI_BUILTIN_META[id] || { avatar: 'av-custom', initial: id.slice(0, 1).toUpperCase() };
      arr.push({
        id: id,
        builtin: true,
        label: PROVIDERS[id].label,
        avatar: meta.avatar,
        initial: meta.initial,
        protocol: id,
        defaultModel: PROVIDERS[id].defaultModel,
        meta: '雲端 · ' + id + ' 協定'
      });
    });
    (cfg.customProviders || []).forEach(function (cp) {
      var base = (cp.baseUrl || '未設定').replace(/^https?:\/\//, '');
      arr.push({
        id: cp.id,
        builtin: false,
        label: cp.label || '未命名',
        avatar: 'av-custom',
        initial: '本',
        protocol: cp.protocol || 'openai',
        baseUrl: cp.baseUrl || '',
        defaultModel: cp.defaultModel || '',
        meta: base + ' · ' + (cp.protocol || 'openai'),
        _cp: cp
      });
    });
    return arr;
  }
  function findProvider(id) {
    return providerList().filter(function (x) { return x.id === id; })[0] || null;
  }

  // brand 色：依使用中供應商偏移 header/卡片光暈
  function applyBrand(activeId) {
    var supportsOklch = !!(window.CSS && CSS.supports && CSS.supports('color', 'oklch(0.5 0.1 264)'));
    var b = (supportsOklch && M2KAI_BRAND[activeId]) || null;
    if (b) {
      root.style.setProperty('--m2kai-brand', b.strong);
      root.style.setProperty('--m2kai-brand-weak', b.weak);
    } else {
      root.style.removeProperty('--m2kai-brand');
      root.style.removeProperty('--m2kai-brand-weak');
    }
  }

  // 本機 URL 驗證（沿用 llm-adapter 的 isLocalBaseUrl；空字串不報紅）→ 回錯誤字串或 ''
  function localUrlError(url) {
    if (!url || !String(url).trim()) return '';
    return isLocalBaseUrl(normalizeBaseUrl(url))
      ? '' : '只允許本機位址（localhost / 127.0.0.1）；不可填外部主機。';
  }

  // =====================================================================
  // 左欄：供應商卡片清單（master）
  // =====================================================================
  function renderList() {
    var list = $('#m2kaiPList');
    $$('.m2kai-pcard', list).forEach(function (n) { n.remove(); });
    var addBtn = $('#m2kaiAddProvider');
    providerList().forEach(function (p) {
      var card = d.createElement('button');
      card.type = 'button';
      card.className = 'm2kai-pcard';
      card.setAttribute('data-id', p.id);
      if (p.id === selectedId) card.classList.add('is-selected');
      if (p.id === cfg.provider) card.classList.add('is-active');
      card.innerHTML =
        '<span class="m2kai-corner-badge">使用中</span>' +
        '<span class="m2kai-avatar ' + p.avatar + '">' + escapeHtml(p.initial) + '</span>' +
        '<span class="m2kai-pcard-main">' +
          '<span class="m2kai-pcard-name">' + escapeHtml(p.label) + '</span>' +
          '<span class="m2kai-pcard-meta">' + escapeHtml(p.meta) + '</span>' +
        '</span>' +
        '<span class="m2kai-active-dot" title="使用中"></span>';
      card.addEventListener('click', function () {
        selectedId = p.id;
        renderList();
        renderDetail();
      });
      list.insertBefore(card, addBtn);
    });
  }

  // =====================================================================
  // 右欄：供應商詳情（detail）
  // =====================================================================
  function renderDetail() {
    var box = $('#m2kaiPDetail');
    var p = findProvider(selectedId);

    if (!p) {
      box.innerHTML =
        '<div class="m2kai-empty" style="margin-top:40px;">' +
          m2kaiIco('info', 'm2kai-empty-ico') +
          '<div class="m2kai-empty-title">沒有可編輯的供應商</div>' +
          '<div class="m2kai-empty-desc">左側清單目前是空的。新增一個自訂供應商，或內建供應商會自動回填。</div>' +
        '</div>';
      return;
    }

    var isActive = p.id === cfg.provider;
    var isNew = !p.builtin && !p.label && !p.baseUrl;   // 剛新增、尚未填內容
    var key = (cfg.apiKeys || {})[p.id] || '';
    var model = (cfg.models || {})[p.id] || '';
    var canFetch = (p.builtin && p.id === 'openai') || (!p.builtin);
    var urlErr = p.builtin ? '' : localUrlError(p.baseUrl);

    var html =
      '<div class="m2kai-detail-head">' +
        '<span class="m2kai-avatar ' + p.avatar + '">' + escapeHtml(p.initial) + '</span>' +
        '<div>' +
          '<div class="m2kai-detail-title">' + escapeHtml(p.label || '未命名') +
            (p.builtin ? '' : ' <span class="m2kai-badge bd-local">本機</span>') +
          '</div>' +
          '<div class="m2kai-detail-sub">' + escapeHtml(p.meta) + '</div>' +
        '</div>' +
      '</div>';

    if (isNew) {
      html +=
        '<div class="m2kai-onboard">' +
          m2kaiIco('info') +
          '<span>新供應商：填入本機服務的 <b>Base URL</b>（例如 <code>http://localhost:51121</code>）後測試並抓取模型。Base URL 僅限本機。</span>' +
        '</div>';
    }

    // 使用中 / 設為使用中
    html +=
      '<div class="m2kai-use-row' + (isActive ? ' is-active' : '') + '">' +
        (isActive
          ? '<span>目前使用中 — 生成回覆會用這個供應商</span><span class="m2kai-spacer"></span>'
          : '<span>未使用</span><span class="m2kai-spacer"></span>' +
            '<button type="button" class="m2kai-btn m2kai-btn-sm" data-act="use">設為使用中</button>') +
      '</div>';

    // 自訂供應商：顯示名稱 / 協定 / Base URL（含 inline 本機驗證）
    if (!p.builtin) {
      html +=
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">顯示名稱</label>' +
          '<input class="m2kai-input" data-f="label" value="' + escapeHtml(p.label) + '" placeholder="例如 本機 CLIProxy">' +
        '</div>' +
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">相容協定</label>' +
          '<select class="m2kai-select" data-f="protocol">' +
            opt('openai', 'openai 相容', p.protocol) +
            opt('anthropic', 'anthropic 相容', p.protocol) +
            opt('gemini', 'gemini 相容', p.protocol) +
          '</select>' +
        '</div>' +
        '<div class="m2kai-field' + (urlErr ? ' has-err' : '') + '" data-field="baseUrl">' +
          '<label class="m2kai-label">Base URL <span class="m2kai-req" title="必填">*</span></label>' +
          '<div class="m2kai-row">' +
            '<input class="m2kai-input m2kai-mono" data-f="baseUrl" value="' + escapeHtml(p.baseUrl || '') + '" placeholder="例如 http://localhost:51121">' +
          '</div>' +
          '<div class="m2kai-hint">僅限本機 <code>localhost</code> ／ <code>127.0.0.1</code>；填到 host:port（不含 /v1）。</div>' +
          '<div class="m2kai-field-err" data-err="baseUrl">' + escapeHtml(urlErr || '') + '</div>' +
        '</div>' +
        '<div class="m2kai-field">' +
          '<label class="m2kai-label">預設模型（主模型欄留空時套用）</label>' +
          '<input class="m2kai-input m2kai-mono" data-f="defaultModel" value="' + escapeHtml(p.defaultModel || '') + '" placeholder="例如 gpt-4o-mini">' +
        '</div>';
    }

    // API Key
    html +=
      '<div class="m2kai-field">' +
        '<label class="m2kai-label">API Key' + (p.builtin ? '' : '（本機服務常可留空）') + '</label>' +
        '<div class="m2kai-row">' +
          '<span class="m2kai-key-wrap">' +
            '<input class="m2kai-input m2kai-mono" type="password" data-k="key" value="' + escapeHtml(key) + '" placeholder="' + (p.builtin ? 'sk-...' : '可留空') + '">' +
            '<button type="button" class="m2kai-key-toggle" data-act="togglekey" title="顯示／隱藏" aria-label="顯示或隱藏 API Key">' + M2KAI_ICON.eye + '</button>' +
          '</span>' +
        '</div>' +
        (p.builtin ? '<div class="m2kai-hint">切換供應商會分別儲存各自的 Key。</div>' : '') +
      '</div>';

    // 模型欄位 + 測試並抓取
    html +=
      '<div class="m2kai-field is-tight">' +
        '<label class="m2kai-label">模型</label>' +
        '<div class="m2kai-row">' +
          '<input class="m2kai-input m2kai-mono" data-k="model" value="' + escapeHtml(model) + '" placeholder="' + (p.defaultModel ? '預設 ' + escapeHtml(p.defaultModel) : '模型名稱') + '">' +
          (canFetch
            ? '<button type="button" class="m2kai-btn" data-act="fetch"' + ((!p.builtin && urlErr) ? ' disabled' : '') + '>' + M2KAI_ICON.refresh + ' 測試並抓取模型</button>'
            : '') +
        '</div>' +
        '<div class="m2kai-hint">可手填，或抓取後從清單選；留空則用該供應商預設模型。</div>' +
        '<div class="m2kai-status" data-status="conn"></div>' +
        '<div class="m2kai-modelpicker" data-picker>' +
          '<div class="m2kai-search-wrap">' +
            '<span class="m2kai-search-icon">' + M2KAI_ICON.search + '</span>' +
            '<input class="m2kai-input m2kai-mono" data-modelsearch placeholder="搜尋模型…">' +
          '</div>' +
          '<div class="m2kai-modellist" data-modellist></div>' +
        '</div>' +
      '</div>';

    // 自訂供應商：刪除
    if (!p.builtin) {
      html +=
        '<div class="m2kai-divider"></div>' +
        '<button type="button" class="m2kai-btn m2kai-btn-danger" data-act="delete">' + M2KAI_ICON.trash + ' 刪除此供應商</button>';
    }

    box.innerHTML = html;
    bindDetail(box, p);
    updateUseAvailability(box, p);
  }

  // 控制「設為使用中」可用性（自訂供應商需有合法本機 Base URL）
  function updateUseAvailability(box, p) {
    var useBtn = box.querySelector('[data-act="use"]');
    if (!useBtn) return;
    var blocked = !p.builtin && (!p.baseUrl || localUrlError(p.baseUrl));
    useBtn.disabled = !!blocked;
    useBtn.title = blocked ? '請先填入合法的本機 Base URL' : '';
  }

  function bindDetail(box, p) {
    // 自訂供應商欄位即時寫回 cfg.customProviders → saveConfig
    if (!p.builtin && p._cp) {
      $$('[data-f]', box).forEach(function (el) {
        el.addEventListener('input', function () {
          var f = el.getAttribute('data-f');
          p._cp[f] = el.value;
          p[f] = el.value;
          if (f === 'baseUrl') {
            var fieldEl = box.querySelector('[data-field="baseUrl"]');
            var errEl = box.querySelector('[data-err="baseUrl"]');
            var msg = localUrlError(el.value);
            if (fieldEl) fieldEl.classList.toggle('has-err', !!msg);
            if (errEl) errEl.textContent = msg || '';
            $$('[data-act="fetch"]', box).forEach(function (b) { b.disabled = !!msg; });
            updateUseAvailability(box, p);
          }
          if (f === 'label' || f === 'baseUrl' || f === 'protocol') {
            var base = (p._cp.baseUrl || '未設定').replace(/^https?:\/\//, '');
            p.meta = base + ' · ' + (p._cp.protocol || 'openai');
            renderList();
          }
          persist();
        });
      });
    }

    // API Key（per-provider，寫 cfg.apiKeys[id]）
    var keyInput = box.querySelector('[data-k="key"]');
    if (keyInput) keyInput.addEventListener('input', function () {
      cfg.apiKeys[p.id] = keyInput.value;
      persist();
    });

    // 模型（per-provider，寫 cfg.models[id]）
    var modelInput = box.querySelector('[data-k="model"]');
    if (modelInput) modelInput.addEventListener('input', function () {
      cfg.models[p.id] = modelInput.value;
      persist();
    });

    // 顯示 / 隱藏 key
    var tk = box.querySelector('[data-act="togglekey"]');
    if (tk) tk.addEventListener('click', function () {
      var input = box.querySelector('[data-k="key"]');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      tk.innerHTML = show ? M2KAI_ICON.eyeoff : M2KAI_ICON.eye;
    });

    // 設為使用中（即時 saveConfig + applyBrand + 重繪高亮）
    var useBtn = box.querySelector('[data-act="use"]');
    if (useBtn) useBtn.addEventListener('click', function () {
      if (useBtn.disabled) return;
      cfg.provider = p.id;
      persist();
      applyBrand(p.id);
      renderList();
      renderDetail();
      toast('已設為使用中', 'ok');
    });

    // 測試並抓取模型（真實 fetchModels）
    $$('[data-act="fetch"]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        runFetch(btn, box, p);
      });
    });

    // 刪除自訂供應商（inline 二次確認）
    var del = box.querySelector('[data-act="delete"]');
    if (del) {
      var confirmTimer;
      del.addEventListener('click', function () {
        if (del.getAttribute('data-armed') !== '1') {
          del.setAttribute('data-armed', '1');
          del.innerHTML = M2KAI_ICON.trash + ' 確定刪除？再按一次';
          confirmTimer = setTimeout(function () {
            del.removeAttribute('data-armed');
            del.innerHTML = M2KAI_ICON.trash + ' 刪除此供應商';
          }, 3000);
          return;
        }
        clearTimeout(confirmTimer);
        deleteCustomProvider(p.id);
      });
    }
  }

  // 連線狀態機：測試並抓取 → 成功展開 picker / 失敗顯示重試
  function runFetch(btn, box, p) {
    var st = box.querySelector('[data-status="conn"]');
    var picker = box.querySelector('[data-picker]');
    if (picker) picker.classList.remove('is-shown');

    // baseUrl 來源：自訂用 cp.baseUrl；內建 openai 用官方端點
    var baseUrl = '';
    if (p.builtin) {
      if (p.id === 'openai') {
        baseUrl = 'https://api.openai.com';
      } else {
        toast('此供應商請手填模型', 'warn');
        return;
      }
    } else {
      if (localUrlError(p.baseUrl)) { toast('Base URL 僅支援 localhost／127.0.0.1', 'err'); return; }
      baseUrl = normalizeBaseUrl(p.baseUrl);
      if (!baseUrl) { toast('請先填入 Base URL', 'warn'); return; }
    }

    var key = (cfg.apiKeys || {})[p.id] || '';
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="m2kai-spinner"></span> 連線中';
    setStatus(st, 'loading', '<span class="m2kai-spinner"></span> 正在連線並抓取模型…');

    fetchModels(baseUrl, key).then(function (list) {
      btn.disabled = false;
      btn.innerHTML = orig;
      setStatus(st, 'ok', M2KAI_ICON.ok + '<span>連線成功 — 找到 ' + list.length + ' 個模型，請於下方清單選取</span>');
      if (picker) { buildModelPicker(picker, list, p, box); picker.classList.add('is-shown'); }
    }).catch(function (err) {
      btn.disabled = false;
      btn.innerHTML = orig;
      var msg = (err && err.message) ? err.message : String(err);
      setStatus(st, 'err',
        M2KAI_ICON.err + '<span>抓取失敗：' + escapeHtml(msg) + '</span>' +
        '<span class="m2kai-spacer"></span>' +
        '<button type="button" class="m2kai-btn m2kai-btn-sm m2kai-btn-ghost" data-retry>重試</button>');
      var rt = st.querySelector('[data-retry]');
      if (rt) rt.addEventListener('click', function () { runFetch(btn, box, p); });
    });
  }

  // 可搜尋模型 picker：點選回填 cfg.models[id] + saveConfig
  function buildModelPicker(picker, models, p, box) {
    var listEl = picker.querySelector('[data-modellist]');
    var search = picker.querySelector('[data-modelsearch]');
    function current() { return (cfg.models || {})[p.id] || ''; }
    function paint(filter) {
      var f = (filter || '').toLowerCase();
      var matched = models.filter(function (m) { return m.toLowerCase().indexOf(f) >= 0; });
      if (!matched.length) {
        listEl.innerHTML = '<div class="m2kai-modelempty">查無符合「' + escapeHtml(filter) + '」的模型</div>';
        return;
      }
      var cur = current();
      listEl.innerHTML = matched.map(function (m) {
        return '<div class="m2kai-modelopt' + (m === cur ? ' is-selected' : '') + '" data-m="' + escapeHtml(m) + '">' +
          '<span>' + escapeHtml(m) + '</span>' +
          M2KAI_ICON.check.replace('class="m2kai-ico', 'class="m2kai-ico m2kai-check') + '</div>';
      }).join('');
      $$('.m2kai-modelopt', listEl).forEach(function (optEl) {
        optEl.addEventListener('click', function () {
          var chosen = optEl.getAttribute('data-m');
          cfg.models[p.id] = chosen;
          persist();
          var input = box.querySelector('[data-k="model"]');
          if (input) input.value = chosen;
          paint(search.value);
          toast('已選用模型 ' + chosen, 'ok');
        });
      });
    }
    search.value = '';
    search.oninput = function () { paint(search.value); };
    paint('');
  }

  // 新增自訂供應商：建項 push、saveConfig、選中、聚焦名稱
  function addCustomProvider() {
    var np = { id: genCpId(), label: '', protocol: 'openai', baseUrl: '', defaultModel: '' };
    cfg.customProviders.push(np);
    persist();
    selectedId = np.id;
    renderList();
    renderDetail();
    var nameInput = $('#m2kaiPDetail [data-f="label"]');
    if (nameInput) { nameInput.focus(); }
  }

  // 刪除自訂供應商：移除項 + 清 apiKeys/models；若刪的是使用中則 fallback openai
  function deleteCustomProvider(id) {
    cfg.customProviders = (cfg.customProviders || []).filter(function (x) { return x.id !== id; });
    if (cfg.apiKeys) delete cfg.apiKeys[id];
    if (cfg.models) delete cfg.models[id];
    if (cfg.provider === id) cfg.provider = 'openai';
    persist();
    selectedId = cfg.provider;
    applyBrand(cfg.provider);
    renderList();
    renderDetail();
    toast('已刪除供應商', 'ok');
  }

  // =====================================================================
  // 回覆 tab：預設 prompt + 規則卡（含空狀態）+ 長度上限
  // =====================================================================
  function renderRules() {
    var box = $('#m2kaiRules');

    if (!cfg.rules.length) {
      box.innerHTML =
        '<div class="m2kai-empty">' +
          m2kaiIco('rules') +
          '<div class="m2kai-empty-title">尚無主旨規則</div>' +
          '<div class="m2kai-empty-desc">目前所有信件都會套用上方的「預設 System Prompt」。新增規則可針對特定主旨改用不同指示。</div>' +
          '<button type="button" class="m2kai-btn m2kai-btn-sm m2kai-btn-primary" id="m2kaiEmptyAddRule">＋ 新增規則</button>' +
        '</div>';
      var ea = $('#m2kaiEmptyAddRule', box);
      if (ea) ea.addEventListener('click', addRule);
      return;
    }

    box.innerHTML = cfg.rules.map(function (r, i) {
      return '' +
        '<div class="m2kai-rule' + (r.enabled ? '' : ' is-disabled') + '" data-i="' + i + '">' +
          '<div class="m2kai-rule-topbar">' +
            '<button class="m2kai-rule-head" type="button" data-head aria-expanded="false">' +
              M2KAI_ICON.chevron +
              '<span class="m2kai-rule-name">' + escapeHtml(r.name || '未命名') +
                '<span class="m2kai-rule-match">' + escapeHtml(r.matchType || 'contains') + ' · ' + escapeHtml(r.match || '') + '</span>' +
              '</span>' +
            '</button>' +
            '<div class="m2kai-rule-controls">' +
              '<label class="m2kai-switch">' +
                '<input type="checkbox" data-enabled' + (r.enabled ? ' checked' : '') + ' aria-label="啟用規則">' +
                '<span class="m2kai-switch-track"><span class="m2kai-switch-thumb"></span></span>' +
              '</label>' +
              '<button type="button" class="m2kai-iconbtn-sm" data-del title="刪除規則" aria-label="刪除規則">' + M2KAI_ICON.trash + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="m2kai-rule-body">' +
            '<div class="m2kai-rule-grid">' +
              '<div>' +
                '<label class="m2kai-label">比對方式</label>' +
                '<select class="m2kai-select" data-rtype>' +
                  opt('contains', 'contains', r.matchType) +
                  opt('startsWith', 'startsWith', r.matchType) +
                  opt('regex', 'regex', r.matchType) +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label class="m2kai-label">名稱</label>' +
                '<input class="m2kai-input" data-rname value="' + escapeHtml(r.name || '') + '">' +
              '</div>' +
            '</div>' +
            '<label class="m2kai-label">比對字串／關鍵字／regex</label>' +
            '<input class="m2kai-input m2kai-mono" data-rmatch value="' + escapeHtml(r.match || '') + '">' +
            '<label class="m2kai-label" style="margin-top:12px;">此規則的 System Prompt</label>' +
            '<textarea class="m2kai-textarea" data-rprompt>' + escapeHtml(r.systemPrompt || '') + '</textarea>' +
          '</div>' +
        '</div>';
    }).join('');

    $$('.m2kai-rule', box).forEach(function (card) {
      var i = +card.getAttribute('data-i');
      var head = card.querySelector('[data-head]');
      head.addEventListener('click', function () {
        var open = card.classList.toggle('is-open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      var en = card.querySelector('[data-enabled]');
      en.addEventListener('change', function () {
        cfg.rules[i].enabled = this.checked;
        card.classList.toggle('is-disabled', !this.checked);
        persist();
      });

      var del = card.querySelector('[data-del]');
      var armTimer;
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (del.getAttribute('data-armed') !== '1') {
          del.classList.add('is-confirm');
          del.setAttribute('data-armed', '1');
          del.textContent = '確定刪除？';
          armTimer = setTimeout(function () {
            del.classList.remove('is-confirm');
            del.removeAttribute('data-armed');
            del.innerHTML = M2KAI_ICON.trash;
          }, 3000);
          return;
        }
        clearTimeout(armTimer);
        cfg.rules.splice(i, 1);
        persist();
        renderRules();
        toast('已刪除規則', 'ok');
      });

      bindRuleField(card, i, 'rname', 'name');
      bindRuleField(card, i, 'rmatch', 'match');
      bindRuleField(card, i, 'rprompt', 'systemPrompt');
      bindRuleField(card, i, 'rtype', 'matchType');
    });
  }

  function bindRuleField(card, i, attr, key) {
    var el = card.querySelector('[data-' + attr + ']');
    if (!el) return;
    el.addEventListener('input', function () {
      cfg.rules[i][key] = el.value;
      var matchEl = card.querySelector('.m2kai-rule-match');
      if (matchEl) {
        matchEl.textContent = (cfg.rules[i].matchType || 'contains') + ' · ' + (cfg.rules[i].match || '');
      }
      var nameEl = card.querySelector('.m2kai-rule-name');
      if (key === 'name' && nameEl && nameEl.childNodes[0]) {
        nameEl.childNodes[0].nodeValue = cfg.rules[i].name || '未命名';
      }
      persist();
    });
  }

  function addRule() {
    cfg.rules.push({
      id: 'r' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      enabled: true,
      name: '新規則',
      match: '',
      matchType: 'contains',
      systemPrompt: ''
    });
    persist();
    renderRules();
    var cards = $$('.m2kai-rule');
    var last = cards[cards.length - 1];
    if (last) {
      last.classList.add('is-open');
      var h = last.querySelector('[data-head]');
      if (h) h.setAttribute('aria-expanded', 'true');
      last.scrollIntoView({ block: 'nearest' });
    }
  }

  // =====================================================================
  // 綁定：tabs / 回覆欄位 / 進階 / 主題 / 關閉
  // =====================================================================
  // Tabs（roving tabindex + 方向鍵）
  var tabs = $$('.m2kai-tab');
  function activateTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    var name = tab.getAttribute('data-tab');
    $$('.m2kai-page').forEach(function (pg) {
      pg.classList.toggle('is-active', pg.getAttribute('data-page') === name);
    });
  }
  tabs.forEach(function (tab, idx) {
    tab.addEventListener('click', function () { activateTab(tab); });
    tab.addEventListener('keydown', function (e) {
      var dir = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
      if (!dir) return;
      e.preventDefault();
      var next = tabs[(idx + dir + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });

  // 預設 System Prompt（即時 saveConfig）
  var defPrompt = $('#m2kaiDefaultPrompt');
  defPrompt.value = cfg.defaultSystemPrompt || '';
  defPrompt.addEventListener('input', function () {
    cfg.defaultSystemPrompt = defPrompt.value;
    persist();
  });

  // 原信長度上限
  var maxChars = $('#m2kaiMaxChars');
  maxChars.value = cfg.maxBodyChars || 6000;
  maxChars.addEventListener('input', function () {
    var n = parseInt(maxChars.value, 10);
    cfg.maxBodyChars = (n && n > 0) ? n : 6000;
    persist();
  });

  // 除錯模式
  var debugChk = $('#m2kaiDebug');
  debugChk.checked = !!cfg.debug;
  debugChk.addEventListener('change', function () {
    cfg.debug = debugChk.checked;
    persist();
    toast(cfg.debug ? '已開啟除錯模式' : '已關閉除錯模式', 'ok');
  });

  // 新增供應商 / 新增規則
  $('#m2kaiAddProvider').addEventListener('click', addCustomProvider);
  $('#m2kaiAddRule').addEventListener('click', addRule);

  // 主題切換
  $('#m2kaiThemeBtn').addEventListener('click', function () {
    var cur = root.getAttribute('data-m2kai-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next;
    if (!cur) next = prefersDark ? 'light' : 'dark';
    else next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-m2kai-theme', next);
    toast(next === 'dark' ? '已切換深色' : '已切換淺色', 'ok');
  });

  // 關閉（footer 與 header 各一顆；無儲存/取消）
  $('#m2kaiCloseBtn').addEventListener('click', close);
  var footerClose = $('#m2kaiFooterClose');
  if (footerClose) footerClose.addEventListener('click', close);

  // ---- 初次渲染 ----
  applyBrand(cfg.provider);
  renderList();
  renderDetail();
  renderRules();
}

// =========================================================================
// 面板靜態結構（master-detail + 三 tab + footer 只剩「關閉」）
// 動態內容（卡片清單 / 詳情 / 規則）由 JS 注入。
// =========================================================================
function renderPanelShell() {
  var version = '';
  try {
    version = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '';
  } catch (e) { version = ''; }
  var versionText = (version ? ('版本 ' + version) : '版本 —') + ' · Tampermonkey userscript';

  return '' +
    '<div class="m2kai-panel" id="m2kaiPanel">' +

      // Header
      '<header class="m2kai-header">' +
        '<div class="m2kai-logo" id="m2kaiLogo">' + M2KAI_ICON.logo + '</div>' +
        '<div class="m2kai-title-wrap">' +
          '<div class="m2kai-title-row">' +
            '<h1 class="m2kai-title">AI 回覆設定</h1>' +
            '<span class="m2kai-safety-badge" title="本工具只生成草稿、絕不自動送信">' +
              M2KAI_ICON.shield + '絕不自動送信' +
            '</span>' +
          '</div>' +
          '<div class="m2kai-subtitle">Mail2000 智慧回信助理</div>' +
        '</div>' +
        '<div class="m2kai-header-spacer"></div>' +
        '<button type="button" class="m2kai-iconbtn" id="m2kaiThemeBtn" title="切換淺／深色" aria-label="切換淺／深色">' +
          '<svg class="m2kai-ico" style="width:16px;height:16px;" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>' +
        '</button>' +
        '<button type="button" class="m2kai-iconbtn m2kai-close" id="m2kaiCloseBtn" title="關閉" aria-label="關閉">&times;</button>' +
      '</header>' +

      // Tabs
      '<div class="m2kai-tabs" role="tablist" aria-label="設定分頁">' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabProviders" aria-selected="true" aria-controls="m2kaiPageProviders" data-tab="providers">' +
          M2KAI_ICON.providers + '供應商' +
        '</button>' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabReply" aria-selected="false" aria-controls="m2kaiPageReply" tabindex="-1" data-tab="reply">' +
          M2KAI_ICON.reply + '回覆' +
        '</button>' +
        '<button type="button" class="m2kai-tab" role="tab" id="m2kaiTabAdvanced" aria-selected="false" aria-controls="m2kaiPageAdvanced" tabindex="-1" data-tab="advanced">' +
          M2KAI_ICON.advanced + '進階' +
        '</button>' +
      '</div>' +

      // Body
      '<div class="m2kai-body">' +

        // Tab ① 供應商
        '<section class="m2kai-page is-active" id="m2kaiPageProviders" role="tabpanel" aria-labelledby="m2kaiTabProviders" data-page="providers">' +
          '<div class="m2kai-md">' +
            '<div class="m2kai-md-list" id="m2kaiPList">' +
              '<div class="m2kai-list-label">供應商</div>' +
              '<button type="button" class="m2kai-addcard" id="m2kaiAddProvider">＋ 新增自訂供應商</button>' +
            '</div>' +
            '<div class="m2kai-md-detail" id="m2kaiPDetail"></div>' +
          '</div>' +
        '</section>' +

        // Tab ② 回覆
        '<section class="m2kai-page" id="m2kaiPageReply" role="tabpanel" aria-labelledby="m2kaiTabReply" data-page="reply">' +
          '<div class="m2kai-section">' +
            '<h2 class="m2kai-section-title">預設 System Prompt</h2>' +
            '<p class="m2kai-section-desc">沒有任何主旨規則命中時，套用這段指示。</p>' +
            '<textarea class="m2kai-textarea" id="m2kaiDefaultPrompt" style="min-height:96px;"></textarea>' +
            '<div class="m2kai-divider"></div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
              '<h2 class="m2kai-section-title" style="margin:0;">依主旨套用不同 System Prompt</h2>' +
              '<div style="flex:1;"></div>' +
              '<button type="button" class="m2kai-btn m2kai-btn-sm" id="m2kaiAddRule">＋ 新增規則</button>' +
            '</div>' +
            '<p class="m2kai-section-desc">由上而下比對來信主旨，第一個命中的規則生效。</p>' +
            '<div id="m2kaiRules"></div>' +
          '</div>' +
        '</section>' +

        // Tab ③ 進階
        '<section class="m2kai-page" id="m2kaiPageAdvanced" role="tabpanel" aria-labelledby="m2kaiTabAdvanced" data-page="advanced">' +
          '<div class="m2kai-section">' +
            '<h2 class="m2kai-section-title">技術參數</h2>' +
            '<p class="m2kai-section-desc">送進 LLM 前的處理設定。</p>' +
            '<div class="m2kai-field" style="margin-top:0;">' +
              '<label class="m2kai-label">原信內文長度上限</label>' +
              '<div class="m2kai-row">' +
                '<input type="number" class="m2kai-input m2kai-num m2kai-mono" id="m2kaiMaxChars">' +
                '<span class="m2kai-hint" style="margin-top:0;">字元；超過會截斷後再送進 LLM。</span>' +
              '</div>' +
            '</div>' +
            '<div class="m2kai-divider"></div>' +
            '<h2 class="m2kai-section-title">除錯</h2>' +
            '<p class="m2kai-section-desc">開發與排錯時使用。</p>' +
            '<div class="m2kai-toggle-row">' +
              '<div class="m2kai-tr-main">' +
                '<div class="m2kai-tr-title">除錯模式</div>' +
                '<div class="m2kai-tr-desc">在瀏覽器 console 輸出請求／回應與選擇器命中狀況。</div>' +
              '</div>' +
              '<label class="m2kai-switch">' +
                '<input type="checkbox" id="m2kaiDebug" aria-label="除錯模式">' +
                '<span class="m2kai-switch-track"><span class="m2kai-switch-thumb"></span></span>' +
              '</label>' +
            '</div>' +
            '<div class="m2kai-divider"></div>' +
            '<h2 class="m2kai-section-title">關於</h2>' +
            '<p class="m2kai-section-desc">這支腳本的身分與安全承諾。</p>' +
            '<div class="m2kai-about">' +
              '<div class="m2kai-about-row">' +
                '<div class="m2kai-logo" style="animation:none;">' + M2KAI_ICON.logo + '</div>' +
                '<div>' +
                  '<div style="font-weight:700;">Mail2000 AI 自動回覆</div>' +
                  '<div class="m2kai-about-meta">' + escapeHtml(versionText) + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="m2kai-safety">' +
                M2KAI_ICON.shield + '本工具只生成回覆草稿並寫入內文，絕不自動送信。' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

      '</div>' +

      // Footer（autosave 模型：只剩「關閉」）
      '<footer class="m2kai-footer" id="m2kaiFooter">' +
        '<span class="m2kai-footer-note">' +
          '<span class="m2kai-footer-note-clean">設定即時儲存在本機 Tampermonkey，不會上傳。</span>' +
        '</span>' +
        '<button type="button" class="m2kai-btn m2kai-btn-primary" id="m2kaiFooterClose">關閉</button>' +
      '</footer>' +

    '</div>';
}
