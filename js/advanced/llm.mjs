/**
 * AI provider layer.
 *
 * - Claude uses the official Anthropic SDK (loaded from a CDN, called from the
 *   browser with the user's own key).
 * - DeepSeek, OpenAI, Gemini, OpenRouter, Groq, Ollama and any custom
 *   OpenAI-compatible endpoint use the Chat Completions format. Requests go
 *   through the local server's /api/proxy when it is running (avoids CORS),
 *   otherwise straight from the browser.
 *
 * API keys are stored only in this browser's localStorage.
 */
import { load, save } from './store.mjs';
import { loadAnthropic } from './loaders.mjs';

export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
    vision: true,
    pdf: true
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    vision: false
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    vision: true
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [],
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    vision: true
  },
  openrouter: {
    label: 'OpenRouter (many models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    defaultModel: 'deepseek/deepseek-chat',
    keyUrl: 'https://openrouter.ai/keys',
    vision: true
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    vision: false
  },
  ollama: {
    label: 'Ollama (local, no key)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    defaultModel: 'llama3.1',
    noKey: true,
    vision: false
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    models: [],
    defaultModel: '',
    vision: false
  }
};

const DEFAULT_SETTINGS = {
  provider: 'none',
  keys: {},
  models: {},
  baseUrls: {},
  vision: {}
};

export function getAISettings() {
  const s = load('ai-settings', DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

export function saveAISettings(s) {
  save('ai-settings', s);
}

/** The resolved, ready-to-call configuration, or null for "no AI". */
export function activeProvider(settings = getAISettings()) {
  const id = settings.provider;
  const def = PROVIDERS[id];
  if (!def) return null;
  return {
    id,
    ...def,
    apiKey: (settings.keys[id] || '').trim(),
    model: (settings.models[id] || def.defaultModel || '').trim(),
    baseUrl: (settings.baseUrls[id] || def.baseUrl || '').replace(/\/+$/, ''),
    vision: settings.vision[id] !== undefined ? settings.vision[id] : def.vision
  };
}

export function isConfigured(p = activeProvider()) {
  return !!(p && p.model && (p.noKey || p.apiKey) && (p.kind === 'anthropic' || p.baseUrl));
}

export class AIError extends Error {
  constructor(message, { retryable = false, status } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

/* ------------------------------- Proxy ---------------------------------- */

let proxyAvailable = null;
async function hasProxy() {
  if (proxyAvailable !== null) return proxyAvailable;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    proxyAvailable = res.ok && (await res.json()).proxy === true;
  } catch (e) {
    proxyAvailable = false;
  }
  return proxyAvailable;
}

async function httpJSON(url, { method = 'POST', headers = {}, body, signal }) {
  let res;
  try {
    if (await hasProxy()) {
      res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, headers, body }),
        signal
      });
    } else {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal
      });
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new AIError(
      `Could not reach the AI provider. ${
        proxyAvailable ? '' : 'Start the app with "python3 server.py" to avoid browser CORS blocks. '
      }(${e.message})`,
      { retryable: true }
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data.error && (data.error.message || data.error)) ||
      data.message ||
      data.raw ||
      res.statusText;
    throw new AIError(friendlyStatus(res.status, String(msg).slice(0, 400)), {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500
    });
  }
  return data;
}

function friendlyStatus(status, msg) {
  if (status === 401 || status === 403) return `The API key was rejected (${status}). ${msg}`;
  if (status === 402) return `The provider says the account has no credit (${status}). ${msg}`;
  if (status === 404) return `Model or endpoint not found (${status}). Check the model name. ${msg}`;
  if (status === 429) return `Rate limited by the provider (${status}). ${msg}`;
  return `AI request failed (${status}). ${msg}`;
}

/* --------------------------- OpenAI-compatible --------------------------- */

async function callOpenAICompatible(p, req) {
  const headers = {};
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  if (p.id === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Text to Handwriting AI';
  }

  let userContent = req.prompt;
  if (req.images && req.images.length && p.vision) {
    userContent = [
      { type: 'text', text: req.prompt },
      ...req.images.map((url) => ({ type: 'image_url', image_url: { url } }))
    ];
  }
  const body = {
    model: p.model,
    messages: [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: userContent }
    ]
  };
  if (req.json) body.response_format = { type: 'json_object' };

  let data;
  try {
    data = await httpJSON(`${p.baseUrl}/chat/completions`, { headers, body, signal: req.signal });
  } catch (e) {
    // Some models reject response_format; retry once without it.
    if (req.json && e.status === 400) {
      delete body.response_format;
      data = await httpJSON(`${p.baseUrl}/chat/completions`, { headers, body, signal: req.signal });
    } else {
      throw e;
    }
  }
  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && (choice.message.content || '');
  if (!text) throw new AIError('The AI returned an empty response.', { retryable: true });
  return { text, truncated: choice.finish_reason === 'length' };
}

/* -------------------------------- Claude -------------------------------- */

// Models that accept output_config.effort and server-side refusal fallbacks.
const CLAUDE_EFFORT_MODELS = /^claude-(opus|sonnet|fable)-5/;

async function callClaude(p, req) {
  const Anthropic = await loadAnthropic();
  const client = new Anthropic({
    apiKey: p.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2
  });

  const content = [];
  if (req.pdfBase64) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 }
    });
  }
  for (const url of req.images || []) {
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(url);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: req.prompt });

  const params = {
    model: p.model,
    max_tokens: req.maxTokens || 32000,
    messages: [{ role: 'user', content }]
  };
  if (req.system) params.system = req.system;

  const outputConfig = {};
  const supportsEffort = CLAUDE_EFFORT_MODELS.test(p.model);
  if (supportsEffort) outputConfig.effort = req.effort || 'medium';
  if (req.jsonSchema) outputConfig.format = { type: 'json_schema', schema: req.jsonSchema };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;

  // Server-side fallback: if the model declines, the API retries on a
  // suitable fallback model inside the same call.
  const withFallback = supportsEffort
    ? { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : null;

  const run = (body) =>
    body.betas
      ? client.beta.messages.stream(body, { signal: req.signal }).finalMessage()
      : client.messages.stream(body, { signal: req.signal }).finalMessage();

  let message;
  try {
    try {
      message = await run(withFallback || params);
    } catch (e) {
      // If the account/model doesn't accept the fallback beta, retry plainly.
      if (withFallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
        message = await run(params);
      } else {
        throw e;
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) throw e;
    if (e instanceof Anthropic.AuthenticationError) {
      throw new AIError('Claude rejected the API key. Check it in AI Settings.', { status: 401 });
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      throw new AIError(`Claude: permission denied. ${e.message}`, { status: 403 });
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new AIError(`Claude: model "${p.model}" not found.`, { status: 404 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new AIError('Claude rate limit reached. Wait a moment and retry.', {
        status: 429,
        retryable: true
      });
    }
    if (e instanceof Anthropic.BadRequestError) {
      throw new AIError(`Claude rejected the request: ${e.message}`, { status: 400 });
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new AIError('Could not connect to Claude. Check your internet connection.', {
        retryable: true
      });
    }
    if (e instanceof Anthropic.APIError) {
      throw new AIError(`Claude error ${e.status}: ${e.message}`, {
        status: e.status,
        retryable: e.status >= 500
      });
    }
    throw e;
  }

  if (message.stop_reason === 'refusal') {
    const why = message.stop_details && message.stop_details.explanation;
    throw new AIError(`Claude declined this request${why ? `: ${why}` : '.'}`);
  }
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new AIError('Claude returned an empty response.', { retryable: true });
  return { text, truncated: message.stop_reason === 'max_tokens' };
}

/* ------------------------------ Public API ------------------------------- */

/**
 * complete({ system, prompt, images?, pdfBase64?, json?, jsonSchema?, signal })
 * -> { text, truncated }
 */
export async function complete(req, provider = activeProvider()) {
  if (!isConfigured(provider)) {
    throw new AIError('No AI provider is configured. Open the "AI Settings" tab first.');
  }
  return provider.kind === 'anthropic'
    ? callClaude(provider, req)
    : callOpenAICompatible(provider, req);
}

/** complete() + JSON parsing with one retry. */
export async function completeJSON(req, provider = activeProvider()) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await complete({ ...req, json: true }, provider);
    try {
      return parseJSONLoose(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new AIError(`The AI did not return valid JSON (${lastErr.message}).`);
}

export function parseJSONLoose(text) {
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw e;
  }
}

/** Lists model ids the key has access to (for the settings dropdown). */
export async function listModels(provider = activeProvider()) {
  if (provider.kind === 'anthropic') {
    const Anthropic = await loadAnthropic();
    const client = new Anthropic({ apiKey: provider.apiKey, dangerouslyAllowBrowser: true });
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
  const data = await httpJSON(`${provider.baseUrl}/models`, { method: 'GET', headers });
  return (data.data || data.models || [])
    .map((m) => m.id || m.name)
    .filter(Boolean)
    .map((id) => id.replace(/^models\//, ''))
    .sort();
}

export async function testConnection(provider = activeProvider()) {
  const { text } = await complete(
    { prompt: 'Reply with the single word: OK', maxTokens: 1000, effort: 'low' },
    provider
  );
  return text.trim().slice(0, 80);
}
