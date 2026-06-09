// =========================================================================
// 10. 設定面板（掛在 top document）
// =========================================================================
function openSettings() {
  const d = topDoc();
  let modal = d.getElementById(MODAL_ID);
  if (modal) { modal.style.display = 'flex'; return; }

  const cfg = loadConfig();
  modal = d.createElement('div');
  modal.id = MODAL_ID;
  modal.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);' +
    'display:flex;align-items:center;justify-content:center;' +
    'font-family:"Microsoft JhengHei",sans-serif;';

  const card = d.createElement('div');
  card.style.cssText =
    'background:#fff;width:680px;max-width:94vw;max-height:90vh;overflow:auto;' +
    'border-radius:12px;padding:0;box-shadow:0 12px 40px rgba(0,0,0,.3);';
  card.innerHTML = renderSettingsHtml(cfg);
  modal.appendChild(card);
  d.body.appendChild(modal);

  bindSettingsEvents(d, modal, card);
}

function providerOptions(selected) {
  return Object.keys(PROVIDERS).map(function (k) {
    return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' +
      escapeHtml(PROVIDERS[k].label) + '</option>';
  }).join('');
}

function renderRuleRow(r, i) {
  return '' +
    '<div class="m2k-rule" data-idx="' + i + '" style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:13px;">' +
          '<input type="checkbox" class="r-enabled"' + (r.enabled ? ' checked' : '') + '> 啟用</label>' +
        '<input class="r-name" placeholder="規則名稱" value="' + escapeHtml(r.name || '') + '" style="flex:1;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;">' +
        '<button class="r-del" style="border:none;background:#fee2e2;color:#b91c1c;border-radius:4px;padding:4px 8px;cursor:pointer;">刪除</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
        '<select class="r-type" style="padding:4px;border:1px solid #cbd5e1;border-radius:4px;">' +
          ['contains', 'startsWith', 'regex'].map(function (t) {
            return '<option value="' + t + '"' + (r.matchType === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') +
        '</select>' +
        '<input class="r-match" placeholder="比對字串/關鍵字/regex" value="' + escapeHtml(r.match || '') + '" style="flex:1;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;">' +
      '</div>' +
      '<textarea class="r-prompt" placeholder="此規則套用的 system prompt" style="width:100%;min-height:54px;padding:6px;border:1px solid #cbd5e1;border-radius:4px;box-sizing:border-box;">' + escapeHtml(r.systemPrompt || '') + '</textarea>' +
    '</div>';
}

function renderSettingsHtml(cfg) {
  const inputCss = 'width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;font-size:14px;';
  const labelCss = 'display:block;font-size:13px;font-weight:600;margin:12px 0 4px;color:#334155;';
  return '' +
    '<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
      '<h2 style="margin:0;font-size:18px;color:#0f172a;">Mail2000 AI 回覆設定</h2>' +
      '<span id="m2kAiClose" style="cursor:pointer;font-size:22px;color:#64748b;line-height:1;">&times;</span>' +
    '</div>' +
    '<div style="padding:18px 22px;">' +
      '<label style="' + labelCss + '">LLM 供應商</label>' +
      '<select id="m2kProvider" style="' + inputCss + '">' + providerOptions(cfg.provider) + '</select>' +
      '<label style="' + labelCss + '">模型（留空使用預設）</label>' +
      '<input id="m2kModel" style="' + inputCss + '" placeholder="" value="' + escapeHtml(cfg.model || '') + '">' +
      '<div id="m2kModelHint" style="font-size:12px;color:#64748b;margin-top:3px;"></div>' +

      '<label style="' + labelCss + '">API Key</label>' +
      '<div style="display:flex;gap:6px;">' +
        '<input id="m2kApiKey" type="password" style="' + inputCss + '" placeholder="僅儲存在本機 Tampermonkey">' +
        '<button id="m2kToggleKey" style="border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:0 10px;cursor:pointer;">顯示</button>' +
      '</div>' +
      '<div style="font-size:12px;color:#64748b;margin-top:3px;">切換供應商會分別儲存各自的 Key。</div>' +

      '<label style="' + labelCss + '">預設 System Prompt</label>' +
      '<textarea id="m2kDefaultPrompt" style="' + inputCss + 'min-height:70px;">' + escapeHtml(cfg.defaultSystemPrompt || '') + '</textarea>' +

      '<label style="' + labelCss + '">原信內文長度上限（字元）</label>' +
      '<input id="m2kMaxChars" type="number" style="' + inputCss + '" value="' + (cfg.maxBodyChars || 6000) + '">' +

      '<label style="' + labelCss + '">依主旨套用不同 System Prompt（由上而下，第一個命中者生效）</label>' +
      '<div id="m2kRules">' + (cfg.rules || []).map(renderRuleRow).join('') + '</div>' +
      '<button id="m2kAddRule" style="border:1px dashed #94a3b8;background:#f8fafc;border-radius:6px;padding:6px 12px;cursor:pointer;">+ 新增規則</button>' +

      '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:14px;">' +
        '<input type="checkbox" id="m2kDebug"' + (cfg.debug ? ' checked' : '') + '> 除錯模式（console 輸出）</label>' +
    '</div>' +
    '<div style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">' +
      '<button id="m2kCancel" style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:8px 16px;cursor:pointer;">取消</button>' +
      '<button id="m2kSave" style="border:none;background:#2563eb;color:#fff;border-radius:6px;padding:8px 18px;cursor:pointer;">儲存</button>' +
    '</div>';
}

function bindSettingsEvents(d, modal, card) {
  const cfg = loadConfig();
  const $ = function (id) { return card.querySelector('#' + id); };
  const providerSel = $('m2kProvider');
  const modelInput = $('m2kModel');
  const apiKeyInput = $('m2kApiKey');
  const modelHint = $('m2kModelHint');

  // 目前各 provider 的 key（暫存在記憶體，儲存時寫回）
  const keys = Object.assign({}, cfg.apiKeys);
  let prevProvider = providerSel.value;

  function refreshProviderView() {
    const p = providerSel.value;
    apiKeyInput.value = keys[p] || '';
    modelHint.textContent = '預設模型：' + PROVIDERS[p].defaultModel;
  }
  providerSel.addEventListener('change', function () {
    keys[prevProvider] = apiKeyInput.value;   // 保留上一個 provider 的輸入
    prevProvider = providerSel.value;
    refreshProviderView();
  });
  refreshProviderView();

  $('m2kToggleKey').addEventListener('click', function () {
    const t = apiKeyInput.type === 'password' ? 'text' : 'password';
    apiKeyInput.type = t;
    this.textContent = t === 'password' ? '顯示' : '隱藏';
  });

  // 規則新增 / 刪除（事件委派）
  const rulesBox = $('m2kRules');
  $('m2kAddRule').addEventListener('click', function () {
    const idx = rulesBox.querySelectorAll('.m2k-rule').length;
    const tmp = d.createElement('div');
    tmp.innerHTML = renderRuleRow(
      { enabled: true, name: '', match: '', matchType: 'contains', systemPrompt: '' }, idx);
    rulesBox.appendChild(tmp.firstChild);
  });
  rulesBox.addEventListener('click', function (e) {
    if (e.target && e.target.classList.contains('r-del')) {
      const row = e.target.closest('.m2k-rule');
      if (row) row.remove();
    }
  });

  function close() { modal.remove(); }
  $('m2kAiClose').addEventListener('click', close);
  $('m2kCancel').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

  $('m2kSave').addEventListener('click', function () {
    keys[providerSel.value] = apiKeyInput.value; // 存當前 provider 的 key
    const rules = [];
    rulesBox.querySelectorAll('.m2k-rule').forEach(function (row, i) {
      rules.push({
        id: 'r' + Date.now() + '_' + i,
        enabled: row.querySelector('.r-enabled').checked,
        name: row.querySelector('.r-name').value.trim(),
        match: row.querySelector('.r-match').value.trim(),
        matchType: row.querySelector('.r-type').value,
        systemPrompt: row.querySelector('.r-prompt').value
      });
    });
    const newCfg = {
      provider: providerSel.value,
      model: modelInput.value.trim(),
      apiKeys: keys,
      defaultSystemPrompt: $('m2kDefaultPrompt').value,
      maxBodyChars: parseInt($('m2kMaxChars').value, 10) || 6000,
      debug: $('m2kDebug').checked,
      rules: rules
    };
    saveConfig(newCfg);
    close();
    toast('設定已儲存。', 'ok');
  });
}
