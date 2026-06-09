// =========================================================================
// 0. 常數
// =========================================================================
const STORAGE_KEY = 'm2k_ai_reply_config_v1';
const BTN_ID = 'm2kAiGenBtn';
const SETTINGS_BTN_ID = 'm2kAiSettingsBtn';
const MODAL_ID = 'm2kAiSettingsModal';
const TOAST_ID = 'm2kAiToast';

const PROVIDERS = {
  openai: {
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-3-5-sonnet-latest',
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }
};

const DEFAULT_CONFIG = {
  provider: 'openai',
  model: '',                       // 空字串 => 用該 provider 預設模型
  apiKeys: { openai: '', anthropic: '', gemini: '' },
  defaultSystemPrompt:
    '你是專業的商務信件助理。請以禮貌、簡潔、得體的繁體中文，根據來信內容撰寫一封完整的回覆。' +
    '只輸出信件正文（含適當的問候與結尾敬語），不要加任何說明或標記。',
  maxBodyChars: 6000,              // 送進 LLM 的原信內文長度上限
  debug: false,
  rules: [
    // 範例規則（預設停用）
    {
      id: 'sample-leave',
      enabled: false,
      name: '請假類',
      match: '請假',
      matchType: 'contains',       // contains | startsWith | regex
      systemPrompt: '這是請假/出勤相關信件，請以主管核示的語氣回覆，明確表達是否同意並提醒交接事項。'
    }
  ]
};
