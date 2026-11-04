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
  const { ai } = fakeAI({ data: output({}, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(ai.call(request), /nie dokończył/);
  assert.equal(ai.usage.calls, 1);
  assert.equal(ai.usage.input, 100);
  assert.equal(ai.usage.output, 50);
  assert.equal(ai.usage.reasoning, 20);
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
    await assert.rejects(ai.call(request), error => error.status === status && expected.test(error.message) && !error.message.includes('private network details'));
    assert.equal(ai.usage.calls, 1);
  }
});

test('integer config uses defaults for malformed values and clamps bounds', () => {
  assert.equal(integer('bad', 7, 3, 9), 7);
  assert.equal(integer('', 7, 3, 9), 7);
  assert.equal(integer(undefined, 7, 3, 9), 7);
  assert.equal(integer(1, 7, 3, 9), 3);
  assert.equal(integer(20, 7, 3, 9), 9);
  assert.equal(integer('6.8', 7, 3, 9), 7);
});
