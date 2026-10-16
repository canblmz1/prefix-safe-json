import assert from 'node:assert/strict';
import { OpenRouter } from '@openrouter/sdk';
import { HTTPClient } from '@openrouter/sdk/lib/http';
import { callModel, tool } from '@openrouter/agent';
import { z } from 'zod';
import { EventStream } from '@openrouter/sdk/lib/event-streams';
import { OpenAIStreamAdapter, createToolCallExecutionGate } from 'prefix-safe-json';

const schema = { type: 'object', required: ['message'], additionalProperties: false,
  properties: { message: { type: 'string' } } };
function baseResponse(output, status = 'completed') {
  return { id: 'resp_fixture', object: 'response', created_at: 0,
    completed_at: status === 'in_progress' ? null : 0, status, model: 'fixture-model', output,
    error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null, metadata: null, frequency_penalty: null, presence_penalty: null,
    temperature: null, top_p: null, tool_choice: 'auto', tools: [], parallel_tool_calls: true };
}
function fixture(ids, status = 'completed') {
  let sequence = 0;
  const events = [];
  const add = event => events.push({ ...event, sequence_number: sequence++ });
  add({ type: 'response.created', response: baseResponse([], 'in_progress') });
  const output = ids.map((id, index) => ({ type: 'function_call', id: `item_${index}`,
    call_id: id, name: 'record', arguments: JSON.stringify({ message: index ? 'beta' : 'alpha' }), status: 'completed' }));
  for (const [index, item] of output.entries()) {
    add({ type: 'response.output_item.added', output_index: index,
      item: { ...item, arguments: '', status: 'in_progress' } });
    for (let offset = 0; offset < item.arguments.length; offset += 4) {
      add({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: index,
        delta: item.arguments.slice(offset, offset + 4) });
    }
    add({ type: 'response.function_call_arguments.done', item_id: item.id, output_index: index,
      name: item.name, arguments: item.arguments });
    add({ type: 'response.output_item.done', output_index: index, item });
  }
  add({ type: status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: baseResponse(output, status) });
  return events;
}
function response(events, { transportFailure = false, newline = '\n' } = {}) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join(''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset < bytes.length) {
      controller.enqueue(bytes.slice(offset, offset + 13));
      offset += 13;
    } else if (transportFailure) {
      controller.error(new Error('fixture transport read failure'));
    } else controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
// Consume the original HTTP evidence, not the SDK's parsed tool arguments.
// EventStream is the installed SDK's exported SSE decoder. Its callback never
// returns done: response.completed is evidence, not permission to drop late data.
async function collectEvidence(body) {
  const adapter = new OpenAIStreamAdapter();
  const gate = createToolCallExecutionGate(undefined, undefined, { record: schema });
  const received = [];
  const stream = new EventStream(body, message => ({ done: false, value: JSON.parse(message.data) }));
  for await (const event of stream) {
    received.push(event);
    for (const normalized of adapter.push(event)) gate.push(normalized);
  }
  for (const normalized of adapter.finish()) gate.push(normalized);
  return { gate, final: gate.finish(), received };
}

function answerFixture() {
  const item = { type: 'message', id: 'msg_answer', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Recorded safely.', annotations: [], logprobs: [] }] };
  return [
    { type: 'response.created', response: baseResponse([], 'in_progress'), sequence_number: 0 },
    { type: 'response.output_item.added', output_index: 0,
      item: { ...item, status: 'in_progress', content: [] }, sequence_number: 1 },
    { type: 'response.output_item.done', output_index: 0, item, sequence_number: 2 },
    { type: 'response.completed', response: baseResponse([item]), sequence_number: 3 },
  ];
}

async function run({ name, ids = ['call_a'], status = 'completed', late = false,
  expectedEffects, expectedRequests, expectedReason, mixedInvalid = false, transportFailure = false, newline }) {
  const events = fixture(ids, status);
  if (mixedInvalid) {
    for (const event of events) {
      if (event.item?.id === 'item_1') event.item.arguments = '{"message":42}';
      if (event.item_id === 'item_1' && event.type.endsWith('.delta')) event.delta = '';
      if (event.item_id === 'item_1' && event.type.endsWith('.done')) event.arguments = '{"message":42}';
    }
  }
  if (late) events.push({ type: 'response.function_call_arguments.delta', item_id: 'item_0',
    output_index: 0, delta: ' ', sequence_number: events.length });
  const requests = [];
  const evidenceTasks = [];
  const effects = [];
  const client = new OpenRouter({ apiKey: 'fixture-not-a-real-key', serverURL: 'https://fixture.invalid/v1',
    httpClient: new HTTPClient({ fetcher: async request => {
      assert.equal(new URL(request.url).hostname, 'fixture.invalid');
      requests.push(await request.clone().json());
      assert.ok(requests.length <= 2, 'No hidden retries or model rounds');
      const source = response(requests.length === 1 ? events : answerFixture(),
        { transportFailure: transportFailure && requests.length === 1, newline });
      const [sdkBody, evidenceBody] = source.body.tee();
      // Record failure immediately, then await it before any dispatch. This
      // prevents an unhandled rejection if the SDK fails before this consumer.
      evidenceTasks.push(collectEvidence(evidenceBody).then(
        value => ({ value }), error => ({ error })));
      return new Response(sdkBody, { headers: source.headers });
    } }),
  });
  // Explicit manual mode: the SDK must never invoke a callback ahead of PSJ.
  const record = tool({ name: 'record', description: 'Harmless in-memory counter',
    inputSchema: z.object({ message: z.string() }), execute: false });
  const input = [{ role: 'user', content: 'Run the harmless counter' }];
  let finalText;
  let blocked = false;
  let decisions = [];
  const result = callModel(client, { model: 'fixture-model', input, tools: [record] });
  let first;
  let sdkError;
  try { first = await result.getResponse(); } catch (error) { sdkError = error; }
  const observed = await evidenceTasks[0];
  if (observed?.value) {
    assert.deepEqual(observed.value.received, events, 'Every original event, including late evidence, must reach PSJ');
    decisions = observed.value.final.decisions.map(({ action, reason }) => ({ action, reason }));
  }
  if (sdkError || observed?.error || !observed?.value) {
    blocked = true;
  } else {
    const { gate, final } = observed.value;
    const calls = first.output.filter(item => item.type === 'function_call');
    // Whole-batch policy: validate all calls before taking authority or effects.
    // This avoids executing the first valid call and only then discovering that
    // a sibling call is invalid, missing or ambiguously identified.
    const validBatch = calls.length > 0 && calls.length === final.decisions.length &&
      new Set(calls.map(call => call.callId)).size === calls.length &&
      final.decisions.every(decision => decision.action === 'execute' &&
        calls.some(call => call.callId === decision.toolCallId && call.name === decision.name));
    if (!validBatch) {
      blocked = true;
      assert.equal(effects.length, 0);
    } else {
      const authorities = final.decisions.map(decision => gate.takeDecision(decision.internalId));
      assert.ok(authorities.every(Boolean), 'Every accepted call requires fresh authority');
      for (const decision of final.decisions) assert.equal(gate.takeDecision(decision.internalId), undefined);
      // Check every transcript payload before any side effect. These parsed
      // objects only check correlation; execution still uses PSJ authority.
      for (const authority of authorities) {
        const call = calls.find(item => item.callId === authority.toolCallId);
        assert.deepEqual(JSON.parse(call.arguments), authority.value);
      }
      const outputs = authorities.map(authority => {
        // In a real app, enforce permissions and semantic checks here too.
        effects.push(authority.value.message);
        return { type: 'function_call_output', callId: authority.toolCallId,
          output: JSON.stringify({ recorded: authority.value.message }) };
      });
      const next = callModel(client, { model: 'fixture-model', tools: [record],
        input: [...input, ...first.output, ...outputs] });
      const finalResponse = await next.getResponse();
      const nextObserved = await evidenceTasks[1];
      if (nextObserved.error) throw nextObserved.error;
      assert.deepEqual(nextObserved.value.received, answerFixture());
      assert.equal(finalResponse.status, 'completed');
      finalText = finalResponse.output.filter(item => item.type === 'message')
        .flatMap(item => item.content).filter(part => part.type === 'output_text')
        .map(part => part.text).join('');
      assert.equal(finalText, 'Recorded safely.');
      const submitted = requests[1].input.filter(item => item.type === 'function_call_output');
      assert.deepEqual(submitted.map(item => item.call_id).sort(), [...ids].sort());
      assert.deepEqual(submitted.map(item => JSON.parse(item.output).recorded), effects);
      assert.equal(new Set(submitted.map(item => item.call_id)).size, submitted.length);
    }
  }
  assert.equal(effects.length, expectedEffects, name);
  assert.equal(requests.length, expectedRequests, name);
  assert.equal(blocked, expectedRequests === 1, name);
  if (expectedReason) assert.ok(decisions.some(decision => decision.reason === expectedReason),
    `${name}: refusing must not pass merely because calls disappeared`);
  if (mixedInvalid) assert.equal(decisions.filter(decision => decision.action === 'execute').length, 1,
    'The valid sibling must be present even though the caller rejects the entire batch');
  if (transportFailure) assert.equal(observed.error?.message, 'fixture transport read failure');
  if (blocked) assert.equal(requests.some(request => Array.isArray(request.input) &&
    request.input.some(item => item.type === 'function_call_output')), false,
  'Blocked batches must not send duplicate or fabricated results back to the model');
  console.log(JSON.stringify({ scenario: name, effects: effects.length, requests: requests.length,
    blocked, decisions, finalText }));
}

for (const scenario of [
  { name: 'complete-and-continue', expectedEffects: 1, expectedRequests: 2 },
  { name: 'crlf-complete-and-continue', newline: '\r\n', expectedEffects: 1, expectedRequests: 2 },
  { name: 'two-distinct-results-and-continue', ids: ['call_a', 'call_b'], expectedEffects: 2, expectedRequests: 2 },
  { name: 'duplicate-id-no-dispatch-or-continuation', ids: ['call_a', 'call_a'], expectedEffects: 0, expectedRequests: 1, expectedReason: 'protocol_violation' },
  { name: 'valid-json-token-limit', status: 'incomplete', expectedEffects: 0, expectedRequests: 1, expectedReason: 'stream_incomplete' },
  { name: 'late-evidence-after-terminal', late: true, expectedEffects: 0, expectedRequests: 1, expectedReason: 'protocol_violation' },
  { name: 'invalid-sibling-rejects-whole-batch', ids: ['call_a', 'call_b'], mixedInvalid: true, expectedEffects: 0, expectedRequests: 1, expectedReason: 'schema_invalid' },
  { name: 'evidence-read-failure', transportFailure: true, expectedEffects: 0, expectedRequests: 1 },
]) await run(scenario);
console.log('Installed SDK fixtures only: no live model requests or independent adoption.');
