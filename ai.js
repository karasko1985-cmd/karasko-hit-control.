// Responses API: JSON Schema, separate reasoning/output budget, no unsupported temperature.
export const DEFAULT_MODEL = 'gpt-6-astra';

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function integer(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

const TIMEOUT_MESSAGE = 'Model przekroczył czas odpowiedzi. Spróbuj trybu szybkiego lub niższego OPENAI_REASONING_EFFORT.';
const NETWORK_MESSAGE = 'Nie udało się połączyć z OpenAI. Sprawdź połączenie i dostępność usługi.';
const TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT']);
const RETRY_CODES = new Set(['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
let undiciPromise;

function loadUndici() {
  undiciPromise ||= import('undici').then(mod => mod?.Agent ? mod : null).catch(() => null);
  return undiciPromise;
}

function errorCodes(error) {
  const codes = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === 'string' && current.code) codes.push(current.code);
    current = current.cause;
  }
  return codes;
}

function redact(value, secret) {
  const text = String(value ?? '');
  return secret ? text.split(secret).join('[redacted]') : text;
}

function logFetchFailure(error, apiKey) {
  const code = errorCodes(error)[0] || '';
  console.error('OpenAI request failed:', redact(error?.name || 'Error', apiKey), redact(error?.message, apiKey), redact(code, apiKey));
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || errorCodes(error).some(code => TIMEOUT_CODES.has(code));
}

function shouldRetry(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return false;
  const codes = errorCodes(error);
  if (codes.some(code => code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT')) return false;
  return codes.some(code => RETRY_CODES.has(code));
}

async function dispatcherFor(timeoutMs) {
  const undici = await loadUndici();
  if (!undici) return null;
  try { return new undici.Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs }); }
  catch (error) {
    console.error('OpenAI dispatcher unavailable:', error?.name, error?.message);
    return null;
  }
}

export function createAI({ apiKey, model = DEFAULT_MODEL, reviewModel = model,
  maxCalls = 7, maxOutputTokens = 16000, timeoutMs = 600000,
  effort = 'high', fetchImpl = globalThis.fetch } = {}) {
  const usage = { input: 0, output: 0, reasoning: 0, calls: 0, byModel: {} };
  let dispatcherPromise;
  return {
    usage, model, reviewModel, maxCalls,
    async call({ instructions, input, schema, name, reviewer = false, creative = false }) {
      if (usage.calls >= maxCalls) throw new ApiError('Osiągnięto limit wywołań API.', 429);
      const chosenModel = reviewer ? reviewModel : model;
      const reasoning = /^(gpt-[5-9]|o[1-9])/.test(chosenModel);
      const body = {
        model: chosenModel, store: false, instructions,
        input: [{ role: 'user', content: JSON.stringify(input) }],
        max_output_tokens: maxOutputTokens,
        text: { format: { type: 'json_schema', name, strict: true, schema } },
        ...(reasoning ? { reasoning: { effort } } : { temperature: creative ? 0.85 : 0.2 })
      };
      usage.calls++;
      dispatcherPromise ||= dispatcherFor(timeoutMs);
      const dispatcher = await dispatcherPromise;
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetchImpl('https://api.openai.com/v1/responses', {
            method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
            ...(dispatcher ? { dispatcher } : {})
          });
          break;
        } catch (error) {
          logFetchFailure(error, apiKey);
          if (attempt === 0 && shouldRetry(error)) continue;
          if (isTimeoutError(error)) throw new ApiError(TIMEOUT_MESSAGE, 504);
          throw new ApiError(NETWORK_MESSAGE);
        }
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages = {
          401: 'OpenAI odrzuciło klucz API. Sprawdź OPENAI_API_KEY w hostingu.',
          403: `Brak dostępu do modelu ${chosenModel}. Ustaw model dostępny na swoim koncie.`,
          404: `Model ${chosenModel} nie jest dostępny. Sprawdź OPENAI_MODEL / OPENAI_REVIEW_MODEL.`,
          429: 'OpenAI zgłosiło limit zapytań lub brak środków. Sprawdź limity i rozliczenia API.'
        };
        const code = /^[a-z0-9_]+$/i.test(data?.error?.code || '') ? ` (${data.error.code})` : '';
        throw new ApiError((messages[response.status] || `OpenAI zwróciło błąd ${response.status}. Sprawdź model i parametry API.`) + code);
      }
      usage.input += Number(data?.usage?.input_tokens || 0);
      usage.output += Number(data?.usage?.output_tokens || 0);
      usage.reasoning += Number(data?.usage?.output_tokens_details?.reasoning_tokens || 0);
      const bucket = usage.byModel[chosenModel] ||= { input: 0, output: 0 };
      bucket.input += Number(data?.usage?.input_tokens || 0);
      bucket.output += Number(data?.usage?.output_tokens || 0);
      if (data?.status === 'incomplete') throw new ApiError('Model nie dokończył odpowiedzi. Zwiększ OPENAI_MAX_OUTPUT_TOKENS lub zmniejsz OPENAI_REASONING_EFFORT.');
      if (data?.status !== 'completed') throw new ApiError('OpenAI nie zwróciło kompletnej odpowiedzi.');
      const blocks = (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []);
      if (blocks.some(block => block.type === 'refusal')) throw new ApiError('Model odmówił realizacji tej prośby. Zmień temat lub wskazówki.');
      const text = blocks.filter(block => block.type === 'output_text').map(block => block.text).join('');
      if (!text.trim()) throw new ApiError('Model zwrócił pustą odpowiedź. Sprawdź limit tokenów i ustawienia modelu.');
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new ApiError('Model zwrócił niepoprawny JSON. Spróbuj ponownie.'); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new ApiError('Model zwrócił niepoprawną strukturę odpowiedzi.');
      return parsed;
    }
  };
}
