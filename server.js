import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAI, DEFAULT_MODEL, integer, ApiError, normalizeEffort } from './ai.js';
import { buildSong, normalizeBrief } from './quality.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) {
    const value = match[2];
    process.env[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value.replace(/\s+#.*$/, '');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const STATIC = new Set(['index.html', 'app.js', 'style.css']);
const LIMIT = 32000;
const JOB_TTL = 2 * 60 * 60 * 1000;

function envString(value) {
  if (value == null) return '';
  let text = String(value).replace(/^\uFEFF/, '').trim();
  while (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/[\r\n]/g, '').trim();
}

export function configFromEnv(env = process.env) {
  const effort = normalizeEffort(envString(env.OPENAI_REASONING_EFFORT), 'high');
  const writerEffort = normalizeEffort(envString(env.OPENAI_WRITER_EFFORT), 'medium');
  const model = envString(env.OPENAI_MODEL);
  return { apiKey: envString(env.OPENAI_API_KEY), password: envString(env.APP_PASSWORD),
    model: model || DEFAULT_MODEL, reviewModel: envString(env.OPENAI_REVIEW_MODEL) || model || DEFAULT_MODEL,
    maxCalls: integer(envString(env.MAX_AI_CALLS), 7, 3, 9), maxOutputTokens: integer(envString(env.OPENAI_MAX_OUTPUT_TOKENS), 64000, 8000, 64000),
    timeoutMs: integer(envString(env.OPENAI_TIMEOUT_MS), 600000, 30000, 600000), effort, writerEffort,
    inputRate: rate(envString(env.INPUT_USD_PER_M)), outputRate: rate(envString(env.OUTPUT_USD_PER_M)),
    reviewInputRate: rate(envString(env.REVIEW_INPUT_USD_PER_M)), reviewOutputRate: rate(envString(env.REVIEW_OUTPUT_USD_PER_M)) };
}
function rate(value) { const n = Number(value); return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : null; }
function authorized(req, password) {
  if (!password) return true;
  if (!/^Basic\s+/i.test(req.headers.authorization || '')) return false;
  const decoded = Buffer.from(req.headers.authorization.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
  const candidate = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return decoded.includes(':') && candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
function scrub(message, apiKey) {
  const text = typeof message === 'string' && message ? message : 'Błąd serwera.';
  return (apiKey ? text.split(apiKey).join('[redacted]') : text).slice(0, 500);
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readPayload(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > LIMIT) throw new ApiError('Za duże żądanie.', 413);
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('Niepoprawny JSON żądania.', 400); }
  try { normalizeBrief(payload); } catch (error) { throw new ApiError(error.message, 400); }
  return payload;
}
function estimateCost(result, config) {
  let total = 0;
  for (const [model, tokens] of Object.entries(result.usage.byModel)) {
    const isReview = model === config.reviewModel && model !== config.model;
    const input = isReview ? config.reviewInputRate : config.inputRate;
    const output = isReview ? config.reviewOutputRate : config.outputRate;
    if (input === null || output === null) return null;
    total += (tokens.input * input + tokens.output * output) / 1e6;
  }
  return total;
}

export function createApp({ config = configFromEnv(), aiFactory = createAI, build = buildSong, assets = null } = {}) {
  const jobs = new Map(), history = [], active = new Map(), perIp = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, job] of jobs) if (!active.has(id) && now - job.updatedAt > JOB_TTL) jobs.delete(id);
    for (const [ip, at] of perIp) if (now - at > 60000) perIp.delete(ip);
    const finished = [...jobs].filter(([id]) => !active.has(id));
    while (jobs.size > 30 && finished.length) jobs.delete(finished.shift()[0]);
  };
  const runJob = async (job, payload) => {
    job.status = 'running'; job.updatedAt = Date.now();
    let ai;
    try {
      ai = aiFactory(config);
      job.result = await build(payload, ai, progress => { job.progress = progress; job.updatedAt = Date.now(); });
      job.result.estimatedUsd = estimateCost(job.result, config);
      job.status = 'completed'; job.progress = { stage: 'completed', message: 'Gotowe. Wybierz Całość, aby skopiować cały numer.' };
      history.unshift(job.result); if (history.length > 15) history.pop();
    } catch (error) {
      job.status = 'failed'; job.error = scrub(error.message || 'Nie udało się przygotować utworu.', config.apiKey);
      job.httpStatus = error.status || 502;
      job.progress = { stage: 'failed', message: 'Generacja zatrzymana.' };
    } finally {
      job.updatedAt = Date.now(); active.delete(job.id);
      try { await ai?.close?.(); } catch { /* Agent mógł już zostać zamknięty. */ }
      prune();
    }
  };
  const handler = async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
      if (!authorized(req, config.password)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Karasko Hit Control", charset="UTF-8"', 'cache-control': 'no-store' });
        return res.end('Wymagane hasło');
      }
      if (pathname === '/api/status' && req.method === 'GET') return send(res, 200, {
        configured: !!config.apiKey, model: config.model, reviewModel: config.reviewModel, maxCalls: config.maxCalls,
        hasPassword: !!config.password, effort: config.effort
      });
      if (pathname === '/api/history' && req.method === 'GET') return send(res, 200, {
        items: history.map(({ song, review, createdAt }) => ({ title: song.title, scores: review.scores, createdAt }))
      });
      if (/^\/api\/jobs\/[a-f0-9-]{36}$/.test(pathname) && req.method === 'GET') {
        prune(); const job = jobs.get(pathname.split('/').pop());
        if (!job) return send(res, 404, { error: 'Zadanie wygasło lub serwer został uruchomiony ponownie.' });
        return send(res, 200, { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error });
      }
      if ((pathname === '/api/jobs' || pathname === '/api/generate') && req.method === 'POST') {
        if (!config.apiKey) return send(res, 503, { error: 'Brak OPENAI_API_KEY. Ustaw istniejący klucz w panelu hostingu.' });
        const payload = await readPayload(req);
        const ip = req.socket.remoteAddress || 'unknown';
        if ([...active.values()].includes(ip)) return send(res, 429, { error: 'Generacja już trwa. Poczekaj na jej wynik.' });
        if (active.size >= 2) return send(res, 429, { error: 'Dwie generacje już trwają. Spróbuj później.' });
        if (Date.now() - (perIp.get(ip) || 0) < 15000) return send(res, 429, { error: 'Odczekaj 15 sekund przed kolejną generacją.' });
        prune();
        const job = { id: crypto.randomUUID(), status: 'queued', updatedAt: Date.now(), progress: { stage: 'queued', message: 'Przygotowuję generację…' } };
        jobs.set(job.id, job); active.set(job.id, ip); perIp.set(ip, Date.now());
        if (pathname === '/api/jobs') {
          setImmediate(() => { void runJob(job, payload); });
          send(res, 202, { id: job.id, status: job.status, progress: job.progress });
          return;
        }
        await runJob(job, payload);
        return send(res, job.status === 'completed' ? 200 : job.httpStatus, job.result || { error: job.error });
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Nie znaleziono endpointu lub metoda jest niedozwolona.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Metoda niedozwolona.' });
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!STATIC.has(file)) return send(res, 404, { error: 'Nie znaleziono.' });
      const data = assets?.[file] ?? (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file)) : null);
      if (data === null) return send(res, 404, { error: 'Brak pliku aplikacji.' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent || res.writableEnded) return;
      try { return send(res, error.status || 500, { error: scrub(error.message, config.apiKey) }); }
      catch { return; }
    }
  };
  return http.createServer(handler);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = integer(envString(process.env.PORT), 3000, 1, 65535);
  const server = createApp();
  server.on('error', error => { console.error(`Nie udało się uruchomić serwera: ${error.code || 'błąd'}`); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => console.log(`KARASKO HIT CONTROL: http://localhost:${port}`));
}
