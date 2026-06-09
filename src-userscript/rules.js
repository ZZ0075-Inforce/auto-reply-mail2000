// =========================================================================
// 5. 主旨規則 → 挑選 system prompt
// =========================================================================
function pickRule(subject, cfg) {
  const subj = stripRePrefix(subject);
  const rules = (cfg.rules || []).filter(function (r) { return r && r.enabled && r.match; });
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    try {
      if (r.matchType === 'regex') {
        if (new RegExp(r.match, 'i').test(subj)) return r;
      } else if (r.matchType === 'startsWith') {
        if (subj.toLowerCase().indexOf(String(r.match).toLowerCase()) === 0) return r;
      } else { // contains
        if (subj.toLowerCase().indexOf(String(r.match).toLowerCase()) >= 0) return r;
      }
    } catch (e) { /* 無效 regex 略過 */ }
  }
  return null;
}

function pickSystemPrompt(subject, cfg) {
  const r = pickRule(subject, cfg);
  return {
    systemPrompt: r ? r.systemPrompt : cfg.defaultSystemPrompt,
    ruleName: r ? (r.name || r.match) : null
  };
}
