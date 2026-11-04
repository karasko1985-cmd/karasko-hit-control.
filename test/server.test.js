import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, configFromEnv } from '../server.js';

async function withServer(config, build, fn) {
  const server = createApp({ config, build, aiFactory: () => ({}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const config = configFromEnv({ OPENAI_API_KEY: 'offline-test-placeholder', APP_PASSWORD: 'local-test' });
const auth = { Authorization: `Basic ${Buffer.from('user:local-test').toString('base64')}` };
const fakeResult = () => ({ song: { title: 'Numer' }, review: { scores: {} }, createdAt: new Date().toISOString(), usage: { byModel: {} } });

test('config rejects invalid numerical values and respects model override', () => {
  const cfg = configFromEnv({ MAX_AI_CALLS: 'NaN', OPENAI_MAX_OUTPUT_TOKENS: 'oops', OPENAI_MODEL: 'gpt-5.4' });
  assert.equal(cfg.maxCalls, 7);
  assert.equal(cfg.maxOutputTokens, 64000);
  assert.equal(cfg.model, 'gpt-5.4');
  assert.equal(configFromEnv({ MAX_AI_CALLS: '2' }).maxCalls, 3);
});

test('config trims whitespace, newlines and wrapping quotes from env strings', () => {
  const cfg = configFromEnv({
    OPENAI_API_KEY: ' "sk-test-secret" \n',
    APP_PASSWORD: "'local-test'\r\n",
    OPENAI_MODEL: " 'gpt-6-astra' \n",
    OPENAI_REVIEW_MODEL: '"gpt-review"\n',
    OPENAI_REASONING_EFFORT: ' high\n',
    MAX_AI_CALLS: '"8"\n',
    INPUT_USD_PER_M: ' "2.5" '
  });
  assert.equal(cfg.apiKey, 'sk-test-secret');
  assert.equal(cfg.password, 'local-test');
  assert.equal(cfg.model, 'gpt-6-astra');
  assert.equal(cfg.reviewModel, 'gpt-review');
  assert.equal(cfg.effort, 'high');
  assert.equal(cfg.writerEffort, 'medium');
  assert.equal(cfg.maxCalls, 8);
  assert.equal(cfg.inputRate, 2.5);
  assert.equal(cfg.apiKey.includes(' '), false);
  assert.equal(cfg.apiKey.includes('\n'), false);
  const efforts = configFromEnv({ OPENAI_REASONING_EFFORT: '"minimal"\n', OPENAI_WRITER_EFFORT: ' HIGH ', OPENAI_MAX_OUTPUT_TOKENS: '70000' });
  assert.equal(efforts.effort, 'minimal');
  assert.equal(efforts.writerEffort, 'high');
  assert.equal(efforts.maxOutputTokens, 64000);
  const invalid = configFromEnv({ OPENAI_REASONING_EFFORT: 'xhigh', OPENAI_WRITER_EFFORT: 'max' });
  assert.equal(invalid.effort, 'high');
  assert.equal(invalid.writerEffort, 'medium');
  assert.equal(configFromEnv({}).maxOutputTokens, 64000);
});

test('HTTP auth, static allowlist, JSON validation, jobs and active generation control', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await withServer(config, async (payload, _ai, progress) => {
    progress({ stage: 'writing', message: 'Piszę' });
    await blocked;
    assert.equal(payload.topic, 'Stacja');
    return fakeResult();
  }, async base => {
    assert.equal((await fetch(base + '/')).status, 401);
    assert.equal((await fetch(base + '/healthz')).status, 200);
    const response = await fetch(base + '/api/status', { headers: auth });
    const status = await response.json();
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes(config.apiKey));
    assert.equal((await fetch(base + '/server.js', { headers: auth })).status, 404);
    assert.equal((await fetch(base + '/', { headers: auth })).status, 200);
    assert.equal((await fetch(base + '/style.css', { headers: auth, method: 'HEAD' })).status, 200);
    const post = body => fetch(base + '/api/jobs', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body });
    assert.equal((await post('null')).status, 400);
    assert.equal((await post('{broken')).status, 400);
    const created = await post(JSON.stringify({ topic: 'Stacja' }));
    assert.equal(created.status, 202);
    const { id } = await created.json();
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal((await post('{}')).status, 429);
    let job = await (await fetch(base + '/api/jobs/' + id, { headers: auth })).json();
    assert.equal(job.status, 'running');
    assert.equal(job.progress.stage, 'writing');
    release();
    for (let i = 0; i < 20 && job.status !== 'completed'; i++) {
      job = await (await fetch(base + '/api/jobs/' + id, { headers: auth })).json();
    }
    assert.equal(job.status, 'completed');
    assert.equal(job.result.song.title, 'Numer');
    const history = await (await fetch(base + '/api/history', { headers: auth })).json();
    assert.equal(history.items.length, 1);
  });
});

test('job errors are retrievable and missing API key creates no generation', async () => {
  await withServer(config, async () => { throw new Error('Kontrolowany błąd modelu'); }, async base => {
    const created = await fetch(base + '/api/jobs', { method: 'POST', headers: auth, body: '{}' });
    const { id } = await created.json();
    const job = await (await fetch(base + '/api/jobs/' + id, { headers: auth })).json();
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Kontrolowany błąd modelu');
  });
  await withServer(configFromEnv({}), async () => assert.fail('must not build'), async base => {
    assert.equal((await fetch(base + '/api/jobs', { method: 'POST', body: '{}' })).status, 503);
  });
});
