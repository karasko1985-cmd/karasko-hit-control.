// Responses API: JSON Schema, separate reasoning/output budget, no unsupported temperature.
export const DEFAULT_MODEL = 'gpt-6-astra';

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function integer(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'];

export function normalizeEffort(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase();
  return REASONING_EFFORTS.includes(text) ? text : fallback;
}

function lowerEffort(level) {
  const index = REASONING_EFFORTS.indexOf(level);
  return index > 0 ? REASONING_EFFORTS[index - 1] : null;
}

const TIMEOUT_MESSAGE = 'Model przekroczył czas odpowiedzi. Spróbuj trybu szybkiego lub niższego OPENAI_REASONING_EFFORT.';
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

function isDispatcherError(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    parts.push(current.name, current.message, current.code);
    current = current.cause;
  }
  return /onRequestStart|dispatcher/i.test(parts.filter(Boolean).join(' '));
}

function connectionMessage(error, apiKey) {
  const clean = value => redact(value, apiKey).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(error?.name || 'Error') || 'Error';
  const code = clean(errorCodes(error)[0] || '');
  const own = clean(error?.message || '');
  const cause = clean(error?.cause?.message || '');
  const prefix = 'Nie udało się połączyć z OpenAI (';
  const tail = [code, cause && cause !== own && cause !== code ? cause : ''].filter(Boolean).join(' / ');
  const tailPart = tail ? ` / ${tail}` : '';
  const available = 150 - prefix.length - 1 - name.length - 2 - tailPart.length;
  const shown = available < own.length ? own.slice(0, Math.max(0, available)) : own;
  const text = `${prefix}${name}: ${shown}${tailPart})`;
  return text.length <= 150 ? text : `${text.slice(0, 149)})`;
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
  maxCalls = 7, maxOutputTokens = 64000, timeoutMs = 600000,
  effort = 'high', writerEffort = 'medium', fetchImpl = globalThis.fetch } = {}) {
  const usage = { input: 0, output: 0, reasoning: 0, calls: 0, byModel: {} };
  const planEffort = normalizeEffort(effort, 'high');
  const writeEffort = normalizeEffort(writerEffort, 'medium');
  let dispatcherPromise;
  let allowDispatcher = true;
  return {
    usage, model, reviewModel, maxCalls,
    async call({ instructions, input, schema, name, reviewer = false, creative = false, writing = false }) {
      const chosenModel = reviewer ? reviewModel : model;
      const reasoning = /^(gpt-[5-9]|o[1-9])/.test(chosenModel);
      const activeEffort = writing ? writeEffort : planEffort;
      const requestOnce = async effortLevel => {
        if (usage.calls >= maxCalls) throw new ApiError('Osiągnięto limit wywołań API.', 429);
        const body = {
          model: chosenModel, store: false, instructions,
          input: [{ role: 'user', content: JSON.stringify(input) }],
          max_output_tokens: maxOutputTokens,
          text: { format: { type: 'json_schema', name, strict: true, schema } },
          ...(reasoning ? { reasoning: { effort: effortLevel } } : { temperature: creative ? 0.85 : 0.2 })
        };
        usage.calls++;
        dispatcherPromise ||= dispatcherFor(timeoutMs);
        const dispatcher = await dispatcherPromise;
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          const useDispatcher = allowDispatcher && dispatcher;
          try {
            response = await fetchImpl('https://api.openai.com/v1/responses', {
              method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
              ...(useDispatcher ? { dispatcher } : {})
            });
            break;
          } catch (error) {
            logFetchFailure(error, apiKey);
            if (attempt === 0 && useDispatcher && isDispatcherError(error)) { allowDispatcher = false; continue; }
            if (attempt === 0 && shouldRetry(error)) continue;
            if (isTimeoutError(error)) throw new ApiError(TIMEOUT_MESSAGE, 504);
            throw new ApiError(connectionMessage(error, apiKey));
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
        return data;
      };
      let data = await requestOnce(activeEffort);
      if (reasoning && data?.status === 'incomplete' && data?.incomplete_details?.reason === 'max_output_tokens') {
        const nextEffort = lowerEffort(activeEffort);
        if (nextEffort && usage.calls < maxCalls) data = await requestOnce(nextEffort);
      }
      if (data?.status === 'incomplete') throw new ApiError('Model nie dokończył odpowiedzi. Zwiększ OPENAI_MAX_OUTPUT_TOKENS lub zmniejsz OPENAI_WRITER_EFFORT albo OPENAI_REASONING_EFFORT.');
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
