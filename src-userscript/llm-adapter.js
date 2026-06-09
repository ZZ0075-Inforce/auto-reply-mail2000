// =========================================================================
// 6. LLM 呼叫（OpenAI / Anthropic / Gemini，可切換；支援本機自訂供應商）
// =========================================================================
// 從 API 錯誤回應中萃取簡短訊息
function shortErr(responseText) {
  if (!responseText) return '';
  try {
    const j = JSON.parse(responseText);
    const m = (j.error && (j.error.message || j.error.status)) ||
      (j.message) ||
      (Array.isArray(j) && j[0] && j[0].error && j[0].error.message);
    if (m) return String(m).slice(0, 200);
  } catch (e) { /* 非 JSON */ }
  return String(responseText).replace(/\s+/g, ' ').slice(0, 160);
}

// base URL 正規化：trim + 去尾斜線
function normalizeBaseUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

// 僅允許本機（@connect 只放寬 localhost / 127.0.0.1）
function isLocalBaseUrl(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch (e) { return false; }
}

// 解析當前供應商（內建或自訂）→ { id, protocol, endpointBase, defaultModel, label, isCustom }
// 內建：endpointBase = 既有完整 endpoint；自訂：endpointBase = 正規化後的 baseUrl。找不到回 null。
function resolveProvider(cfg) {
  const id = cfg.provider;
  if (PROVIDERS[id]) {
    return {
      id: id, protocol: id, label: PROVIDERS[id].label,
      defaultModel: PROVIDERS[id].defaultModel,
      endpointBase: PROVIDERS[id].endpoint, isCustom: false
    };
  }
  const cp = (cfg.customProviders || []).find(function (p) { return p && p.id === id; });
  if (cp) {
    return {
      id: cp.id, protocol: cp.protocol, label: cp.label || cp.id,
      defaultModel: cp.defaultModel || '',
      endpointBase: normalizeBaseUrl(cp.baseUrl), isCustom: true
    };
  }
  return null;
}

// 依協定 + endpointBase 組出實際請求 URL（內建用完整 endpoint；自訂補各協定標準 path）
function providerUrl(protocol, base, isCustom, model) {
  if (protocol === 'openai') {
    return isCustom ? base + '/v1/chat/completions' : base;
  }
  if (protocol === 'anthropic') {
    return isCustom ? base + '/v1/messages' : base;
  }
  if (protocol === 'gemini') {
    const m = encodeURIComponent(model);
    return isCustom ? base + '/v1beta/models/' + m + ':generateContent'
                    : base + '/' + m + ':generateContent';
  }
  throw new Error('未知的相容協定：' + protocol);
}

// 依供應商組出請求規格 { url, headers, data, parse }（按 resolved.protocol 分流，三套 wire format）
function buildRequestSpec(resolved, key, model, system, user) {
  const url = providerUrl(resolved.protocol, resolved.endpointBase, resolved.isCustom, model);
  if (resolved.protocol === 'openai') {
    return {
      url: url,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      data: JSON.stringify({
        model: model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      parse: function (j) { return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; }
    };
  }
  if (resolved.protocol === 'anthropic') {
    return {
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      data: JSON.stringify({
        model: model,
        max_tokens: 1500,
        temperature: 0.7,
        system: system,
        messages: [{ role: 'user', content: user }]
      }),
      parse: function (j) {
        return j.content && j.content.map(function (b) { return b.text || ''; }).join('');
      }
    };
  }
  if (resolved.protocol === 'gemini') {
    return {
      url: url,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      data: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7 }
      }),
      parse: function (j) {
        return j.candidates && j.candidates[0] && j.candidates[0].content &&
          j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
      }
    };
  }
  throw new Error('未知的相容協定：' + resolved.protocol);
}

// 透過 GM_xmlhttpRequest 呼叫（繞過頁面 CORS/CSP）→ Promise<string>
function callLLM(cfg, system, user) {
  const resolved = resolveProvider(cfg);
  if (!resolved) return Promise.reject(new Error('找不到供應商設定：' + cfg.provider));
  const key = (cfg.apiKeys || {})[resolved.id];
  const model = (cfg.models && cfg.models[resolved.id]) || cfg.model || resolved.defaultModel;
  if (!model) return Promise.reject(new Error('未指定模型，請於「AI 設定」填入模型名稱'));
  const spec = buildRequestSpec(resolved, key, model, system, user);
  log('callLLM', resolved.id, resolved.protocol, model);
  return new Promise(function (resolve, reject) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: spec.url,
      headers: spec.headers,
      data: spec.data,
      timeout: 60000,
      onload: function (res) {
        if (res.status < 200 || res.status >= 300) {
          reject(new Error('HTTP ' + res.status + '：' + shortErr(res.responseText)));
          return;
        }
        let json;
        try { json = JSON.parse(res.responseText); }
        catch (e) { reject(new Error('回應非 JSON')); return; }
        let text;
        try { text = spec.parse(json); }
        catch (e) { reject(new Error('回應格式不符：' + e.message)); return; }
        if (!text || !String(text).trim()) { reject(new Error('回應無有效內容')); return; }
        resolve(String(text));
      },
      onerror: function () { reject(new Error('網路錯誤（請確認 @connect 與連線）')); },
      ontimeout: function () { reject(new Error('請求逾時（60s）')); }
    });
  });
}

// 用使用者填的 baseUrl 打 OpenAI 相容的 GET {baseUrl}/v1/models 取可用模型 → Promise<string[]>
// baseUrl 一律來自使用者輸入（不寫死任何 host/port）；key 有才帶 Authorization。
function fetchModels(baseUrl, key) {
  const url = normalizeBaseUrl(baseUrl) + '/v1/models';
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return new Promise(function (resolve, reject) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      headers: headers,
      timeout: 20000,
      onload: function (res) {
        if (res.status < 200 || res.status >= 300) {
          reject(new Error('HTTP ' + res.status + '：' + shortErr(res.responseText)));
          return;
        }
        let json;
        try { json = JSON.parse(res.responseText); }
        catch (e) { reject(new Error('回應非 JSON')); return; }
        const arr = json.data || json.models || [];
        const list = arr.map(function (m) { return m.id || m.name || ''; }).filter(Boolean);
        if (!list.length) { reject(new Error('未取得任何模型')); return; }
        resolve(list);
      },
      onerror: function () { reject(new Error('網路錯誤（請確認本機服務已啟動、@connect）')); },
      ontimeout: function () { reject(new Error('請求逾時（20s）')); }
    });
  });
}
