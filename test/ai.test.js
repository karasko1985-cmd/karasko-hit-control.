import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createAI, integer } from '../ai.js';

const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false };
const request = { name: 'test_result', schema, instructions: 'Return JSON.', input: { topic: 'Test' }, creative: true };
const output = (value = { value: 'ok' }, extra = {}) => ({
  status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 20 } }, ...extra
});
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeAI({ data = output(), status = 200, ...options } = {}) {
  const requests = [];
  const ai = createAI({ apiKey: 'offline-test-placeholder', model: 'gpt-5-test', ...options,
    fetchImpl: async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return respond(data, status); }
  });
  return { ai, requests };
}

test('reasoning models use Responses with strict schema, reasoning effort and no temperature', async () => {
  for (const model of ['gpt-6-astra', 'gpt-5', 'o3', 'o4-mini']) {
    const { ai, requests } = fakeAI({ model, effort: 'high', maxOutputTokens: 16000 });
    assert.deepEqual(await ai.call(request), { value: 'ok' });
    const { body, url } = requests[0];
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(Object.hasOwn(body, 'temperature'), false);
    assert.equal(body.max_output_tokens, 16000);
    assert.deepEqual(body.text.format, { type: 'json_schema', name: request.name, strict: true, schema });
    assert.deepEqual(body.input, [{ role: 'user', content: JSON.stringify(request.input) }]);
  }
});

test('nonreasoning models set appropriate creative or review temperature', async () => {
  const { ai, requests } = fakeAI({ model: 'gpt-4.1' });
  await ai.call(request);
  await ai.call({ ...request, creative: false });
  assert.equal(requests[0].body.temperature, 0.85);
  assert.equal(requests[1].body.temperature, 0.2);
  assert.equal(Object.hasOwn(requests[0].body, 'reasoning'), false);
});

test('writer and reviewer models are independently selected and usage is attributed', async () => {
  const { ai, requests } = fakeAI({ model: 'gpt-5-writer', reviewModel: 'gpt-4.1' });
  await ai.call(request);
  await ai.call({ ...request, reviewer: true, creative: false });
  assert.equal(requests[0].body.model, 'gpt-5-writer');
  assert.equal(requests[1].body.model, 'gpt-4.1');
  assert.deepEqual(ai.usage, { calls: 2, input: 200, output: 100, reasoning: 40,
    byModel: { 'gpt-5-writer': { input: 100, output: 50 }, 'gpt-4.1': { input: 100, output: 50 } } });
});

test('hard budget rejects additional requests before any network activity', async () => {
  const { ai, requests } = fakeAI({ maxCalls: 2 });
  await ai.call(request);
  await ai.call(request);
  await assert.rejects(ai.call(request), error => error instanceof ApiError && error.status === 429);
  assert.equal(requests.length, 2);
  assert.equal(ai.usage.calls, 2);
});

test('failed HTTP calls count against budget and return actionable safe errors', async () => {
  for (const [status, expected] of [[401, /klucz API/], [403, /dostępu do modelu/], [404, /nie jest dostępny/], [429, /limit zapytań/], [500, /błąd 500/]]) {
    const { ai } = fakeAI({ status, data: { error: { code: 'model_not_found', message: 'DO_NOT_ECHO_SERVER_MESSAGE' } } });
    await assert.rejects(ai.call(request), error => expected.test(error.message) && !error.message.includes('DO_NOT_ECHO_SERVER_MESSAGE'));
    assert.equal(ai.usage.calls, 1);
    assert.equal(ai.usage.input, 0);
  }
});

test('incomplete output cannot be accepted but consumed tokens are still counted', async () => {
  const { ai, requests } = fakeAI({ data: output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(ai.call(request), /nie dokończył/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.reasoning.effort, 'high');
  assert.equal(requests[1].body.reasoning.effort, 'medium');
  assert.equal(ai.usage.calls, 2);
  assert.equal(ai.usage.input, 200);
  assert.equal(ai.usage.output, 100);
  assert.equal(ai.usage.reasoning, 40);
});

test('token-limit incomplete retries once at the next lower effort and can succeed', async () => {
  let step = 0;
  const ai = createAI({ apiKey: 'offline-test-placeholder', model: 'gpt-6-astra', writerEffort: 'medium', maxOutputTokens: 64000,
    fetchImpl: async (_url, init) => {
      step++;
      const body = JSON.parse(init.body);
      if (step === 1) {
        assert.equal(body.reasoning.effort, 'medium');
        assert.equal(body.max_output_tokens, 64000);
        return respond(output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
      }
      assert.equal(body.reasoning.effort, 'low');
      return respond(output({ value: 'ok' }));
    } });
  assert.deepEqual(await ai.call({ ...request, writing: true }), { value: 'ok' });
  assert.equal(step, 2);
  assert.equal(ai.usage.calls, 2);
  assert.equal(ai.usage.input, 200);
});

test('incomplete retries stop at minimal, respect maxCalls, and ignore other reasons', async () => {
  const minimal = fakeAI({ effort: 'minimal', data: output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(minimal.ai.call(request), /nie dokończył/);
  assert.equal(minimal.requests.length, 1);
  assert.equal(minimal.ai.usage.calls, 1);
  const capped = fakeAI({ maxCalls: 1, data: output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(capped.ai.call(request), /nie dokończył/);
  assert.equal(capped.requests.length, 1);
  assert.equal(capped.ai.usage.input, 100);
  const other = fakeAI({ data: output({}, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }) });
  await assert.rejects(other.ai.call(request), /nie dokończył/);
  assert.equal(other.requests.length, 1);
  const plain = fakeAI({ model: 'gpt-4.1', data: output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(plain.ai.call(request), /nie dokończył/);
  assert.equal(plain.requests.length, 1);
  assert.equal(Object.hasOwn(plain.requests[0].body, 'reasoning'), false);
});

test('writer calls use medium effort and the default output budget is 64000', async () => {
  const { ai, requests } = fakeAI({ model: 'gpt-6-astra' });
  await ai.call({ ...request, writing: true });
  await ai.call(request);
  await ai.call({ ...request, reviewer: true, creative: false });
  assert.equal(requests[0].body.reasoning.effort, 'medium');
  assert.equal(requests[1].body.reasoning.effort, 'high');
  assert.equal(requests[2].body.reasoning.effort, 'high');
  assert.equal(requests[0].body.max_output_tokens, 64000);
  assert.equal(requests[0].body.temperature, undefined);
});

test('refusal and noncompleted statuses are reported clearly', async () => {
  const refusal = output({}, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] });
  await assert.rejects(fakeAI({ data: refusal }).ai.call(request), /odmówił/);
  for (const status of ['failed', 'queued', 'in_progress']) {
    await assert.rejects(fakeAI({ data: output({}, { status }) }).ai.call(request), /kompletnej odpowiedzi/);
  }
});

test('empty output, invalid JSON and JSON primitives cannot masquerade as a valid response', async () => {
  await assert.rejects(fakeAI({ data: output({}, { output: [] }) }).ai.call(request), /pustą odpowiedź/);
  const badJSON = output({}, { output: [{ type: 'message', content: [{ type: 'output_text', text: '{broken' }] }] });
  await assert.rejects(fakeAI({ data: badJSON }).ai.call(request), /niepoprawny JSON/);
  for (const value of [null, [], 'text', 123, false]) {
    await assert.rejects(fakeAI({ data: output(value) }).ai.call(request), /strukturę odpowiedzi/);
  }
});

test('network and timeout errors are normalized and still consume a call', async () => {
  for (const [name, status, expected] of [['TimeoutError', 504, /czas odpowiedzi/], ['AbortError', 504, /czas odpowiedzi/], ['TypeError', 502, /połączyć/]]) {
    const ai = createAI({ apiKey: 'offline-test-placeholder', fetchImpl: async () => { const e = new Error('private network details'); e.name = name; throw e; } });
    await assert.rejects(ai.call(request), error => {
      const safe = error.status === status && expected.test(error.message) && !error.message.includes('offline-test-placeholder') && error.message.length <= 150;
      return name === 'TypeError' ? safe && error.message.includes('TypeError') && error.message.includes('private network details') : safe && !error.message.includes('private network details');
    });
    assert.equal(ai.usage.calls, 1);
  }
});

function failedFetch(code, message = 'fetch failed') {
  const error = new TypeError(message);
  error.cause = Object.assign(new Error(code), { code });
  return error;
}

test('undici timeout cause codes map to the timeout message and logs omit the API key', async () => {
  const logs = [];
  const original = console.error;
  console.error = (...args) => { logs.push(args.join(' ')); };
  try {
    for (const code of ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
      let fetches = 0;
      const ai = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => {
        fetches++;
        throw failedFetch(code, 'fetch failed sk-test-secret');
      } });
      await assert.rejects(ai.call(request), error => error instanceof ApiError && error.status === 504
        && /czas odpowiedzi/.test(error.message) && !error.message.includes('sk-test-secret') && !error.message.includes(code));
      assert.equal(fetches, 1);
      assert.equal(ai.usage.calls, 1);
    }
    let fetches = 0;
    const connect = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => {
      fetches++;
      throw failedFetch('UND_ERR_CONNECT_TIMEOUT');
    } });
    await assert.rejects(connect.call(request), error => error.status === 504 && /czas odpowiedzi/.test(error.message));
    assert.equal(fetches, 2);
    assert.equal(connect.usage.calls, 1);
    let wrapped = 0;
    const headersAndReset = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => {
      wrapped++;
      const error = new TypeError('fetch failed');
      error.cause = Object.assign(new Error('headers'), { code: 'UND_ERR_HEADERS_TIMEOUT', cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
      throw error;
    } });
    await assert.rejects(headersAndReset.call(request), error => error.status === 504);
    assert.equal(wrapped, 1);
    const text = logs.join('\n');
    assert.match(text, /TypeError/);
    assert.match(text, /fetch failed/);
    for (const code of ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT']) assert.match(text, new RegExp(code));
    assert.equal(text.includes('sk-test-secret'), false);
  } finally { console.error = original; }
});

test('transient network errors retry once without an extra usage call', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const code of ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']) {
      let fetches = 0;
      const ai = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => {
        fetches++;
        if (fetches === 1) throw failedFetch(code);
        return respond(output());
      } });
      assert.deepEqual(await ai.call(request), { value: 'ok' });
      assert.equal(fetches, 2, code);
      assert.equal(ai.usage.calls, 1, code);
      assert.equal(ai.usage.input, 100);
    }
    let fetches = 0;
    const exhausted = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => { fetches++; throw failedFetch('ECONNRESET'); } });
    await assert.rejects(exhausted.call(request), error => error.status === 502 && /połączyć/.test(error.message)
      && /TypeError: fetch failed \/ ECONNRESET/.test(error.message) && !error.message.includes('sk-test-secret') && error.message.length <= 150);
    assert.equal(fetches, 2);
    assert.equal(exhausted.usage.calls, 1);
  } finally { console.error = original; }
});

test('dispatcher mismatch retries once without the dispatcher and later calls skip it', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const inits = [];
    const ai = createAI({ apiKey: 'sk-test-secret', fetchImpl: async (_url, init) => {
      inits.push(init);
      if (init.dispatcher) throw new TypeError('invalid onRequestStart method sk-test-secret');
      return respond(output());
    } });
    assert.deepEqual(await ai.call(request), { value: 'ok' });
    assert.deepEqual(await ai.call(request), { value: 'ok' });
    assert.equal(inits.length, 3);
    assert.ok(inits[0].dispatcher);
    assert.equal(inits[1].dispatcher, undefined);
    assert.equal(inits[2].dispatcher, undefined);
    assert.equal(ai.usage.calls, 2);
    let fetches = 0;
    const failing = createAI({ apiKey: 'sk-test-secret', fetchImpl: async () => {
      fetches++;
      const error = new TypeError(`fetch failed sk-test-secret ${'x'.repeat(400)}`);
      error.cause = Object.assign(new Error('socket hang up sk-test-secret'), { code: 'UND_ERR_SOCKET' });
      throw error;
    } });
    await assert.rejects(failing.call(request), error => error.status === 502
      && error.message.startsWith('Nie udało się połączyć z OpenAI (TypeError: fetch failed')
      && error.message.includes('UND_ERR_SOCKET') && error.message.includes('socket hang up')
      && !error.message.includes('sk-test-secret') && error.message.length <= 150);
    assert.equal(fetches, 2);
    assert.equal(failing.usage.calls, 1);
  } finally { console.error = original; }
});

test('openai fetch uses an undici agent with header and body timeouts covering timeoutMs', async () => {
  const { requests, ai } = fakeAI({ timeoutMs: 600000 });
  await ai.call(request);
  const dispatcher = requests[0].init.dispatcher;
  assert.equal(dispatcher?.constructor?.name, 'Agent');
  const optionsSymbol = Object.getOwnPropertySymbols(dispatcher).find(symbol => symbol.description === 'options');
  const options = dispatcher[optionsSymbol];
  assert.ok(options.headersTimeout >= 600000);
  assert.ok(options.bodyTimeout >= 600000);
});

test('closing the client releases the dispatcher and can be repeated', async () => {
  const ai = createAI({ apiKey: 'offline-test-placeholder', fetchImpl: async () => respond(output()) });
  await ai.call(request);
  await ai.close();
  await ai.close();
});

test('integer config uses defaults for malformed values and clamps bounds', () => {
  assert.equal(integer('bad', 7, 3, 9), 7);
  assert.equal(integer('', 7, 3, 9), 7);
  assert.equal(integer(undefined, 7, 3, 9), 7);
  assert.equal(integer(1, 7, 3, 9), 3);
  assert.equal(integer(20, 7, 3, 9), 9);
  assert.equal(integer('6.8', 7, 3, 9), 7);
});
