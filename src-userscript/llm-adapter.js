// =========================================================================
// 6. LLM 呼叫（OpenAI / Anthropic / Gemini，可切換）
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

// 依供應商組出請求規格 { url, headers, data, parse }
function buildRequestSpec(provider, key, model, system, user) {
  if (provider === 'openai') {
    return {
      url: PROVIDERS.openai.endpoint,
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
  if (provider === 'anthropic') {
    return {
      url: PROVIDERS.anthropic.endpoint,
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
  if (provider === 'gemini') {
    return {
      url: PROVIDERS.gemini.endpoint + '/' + encodeURIComponent(model) + ':generateContent',
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
  throw new Error('未知的供應商：' + provider);
}

// 透過 GM_xmlhttpRequest 呼叫（繞過頁面 CORS/CSP）→ Promise<string>
function callLLM(cfg, system, user) {
  const provider = cfg.provider;
  const key = (cfg.apiKeys || {})[provider];
  const model = cfg.model || PROVIDERS[provider].defaultModel;
  const spec = buildRequestSpec(provider, key, model, system, user);
  log('callLLM', provider, model);
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
