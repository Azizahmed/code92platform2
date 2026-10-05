import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {typescriptLoader} from './helpers/load-typescript.mjs';

const load = typescriptLoader();
const {readProviderConfig, runAssistant} = load('lib/assistant/runtime.ts');
const {chatRequestSchema, toolSchemas, assistantTools} = load('lib/assistant/schemas.ts');
const {readChatBody} = load('lib/assistant/request.ts');
const config = {endpoint: 'https://provider.example/v1/chat/completions', apiKey: 'test-only', model: 'test-model'};
const taskId = 'e89b8790-07df-4e90-99ea-964ae69fdd14';
const reply = (content, calls = []) => Response.json({choices: [{message: {content, tool_calls: calls}}]});
const call = (name, input, id = 'tool-1') => ({id, type: 'function', function: {name, arguments: JSON.stringify(input)}});
const tool = (name) => assistantTools.find((tool) => tool.function.name === name);
function turn(responses, execute = async () => ({ok: true})) {
  const requests = [], events = [];
  return {
    events, requests,
    run: () => runAssistant({config, messages: [{role: 'user', content: 'Help me'}],
      systemPrompt: 'test guide', tools: assistantTools, execute,
      emit: (event) => events.push(event), signal: new AbortController().signal,
      fetcher: async (url, options) => {
        requests.push({url, ...options, body: JSON.parse(options.body)});
        assert.ok(responses.length, 'unexpected extra completion');
        return responses.shift();
      }})
  };
}

test('provider config supports arbitrary API prefixes and remains server owned', () => {
  assert.deepEqual(readProviderConfig({ASSISTANT_BASE_URL: 'https://gateway.example/api/v1/',
    ASSISTANT_MODEL: 'vendor/model', ASSISTANT_API_KEY: 'key'}), {
    endpoint: 'https://gateway.example/api/v1/chat/completions', model: 'vendor/model', apiKey: 'key'
  });
  for (const base of ['file:///etc/passwd', 'https://user:secret@provider.example', 'https://provider.example/?secret=1', 'not-a-url']) {
    assert.throws(() => readProviderConfig({ASSISTANT_BASE_URL: base, ASSISTANT_MODEL: 'm', ASSISTANT_API_KEY: 'k'}), /notConfigured/);
  }
  assert.throws(() => readProviderConfig({}), /notConfigured/);
});

test('plain questions get a completion without executing platform tools', async () => {
  let executed = false;
  const agent = turn([reply('Use the Tasks page.')], async () => {executed = true;});
  await agent.run();
  assert.equal(executed, false);
  assert.deepEqual(agent.events, [{type: 'answer', content: 'Use the Tasks page.'}, {type: 'done'}]);
  assert.equal(agent.requests[0].url, config.endpoint);
  assert.equal(agent.requests[0].headers.Authorization, 'Bearer test-only');
  assert.equal(agent.requests[0].body.model, 'test-model');
  assert.equal(agent.requests[0].redirect, 'error');
});

test('read → action → answer sends real tool results back to the provider', async () => {
  const executed = [];
  const agent = turn([
    reply(null, [call('list_records', {entity: 'tasks'})]),
    reply(null, [call('update_task', {taskId, status: 'completed'}, 'tool-2')]),
    reply('Task completed.')
  ], async (name, input) => {
    executed.push({name, input});
    return name === 'list_records' ? {ok: true, data: [{id: taskId}]} : {ok: true, changed: true, href: '/tasks'};
  });
  await agent.run();
  assert.equal(executed.length, 2);
  const toolResult = agent.requests[2].body.messages.at(-1);
  assert.equal(toolResult.role, 'tool');
  assert.equal(toolResult.tool_call_id, 'tool-2');
  assert.equal(JSON.parse(toolResult.content).changed, true);
  assert.equal(agent.events.find((event) => event.type === 'result' && event.id === 'tool-2').result.href, '/tasks');
});

test('identical successful writes are executed once even with reordered arguments', async () => {
  let executed = 0;
  const agent = turn([
    reply(null, [call('update_task', {taskId, status: 'completed'})]),
    reply(null, [call('update_task', {status: 'completed', taskId}, 'tool-2')]),
    reply('Done.')
  ], async () => {executed += 1; return {ok: true, changed: true};});
  await agent.run();
  assert.equal(executed, 1);
});

test('unsupported tools and malformed JSON cannot reach an executor', async () => {
  const invalid = call('create_task', {});
  invalid.function.arguments = '{bad';
  const agent = turn([reply(null, [call('run_sql', {}, 'tool-2'), invalid]), reply('Unable to do that.')],
    async () => assert.fail('must not execute'));
  await agent.run();
  assert.deepEqual(agent.events.filter((event) => event.type === 'result').map((event) => event.result.error),
    ['unsupportedTool', 'toolFailed']);
});

test('tool failure is returned to the model without pretending the action succeeded', async () => {
  const agent = turn([reply(null, [call('update_task', {taskId})]), reply('That task could not be changed.')],
    async () => ({ok: false, error: 'forbidden'}));
  await agent.run();
  assert.equal(JSON.parse(agent.requests[1].body.messages.at(-1).content).ok, false);
});

test('provider failures preserve completed action receipts and hide response bodies', async () => {
  const agent = turn([reply(null, [call('create_task', {})]), new Response('secret error details', {status: 500})],
    async () => ({ok: true, changed: true, href: '/tasks'}));
  await assert.rejects(agent.run(), /providerError/);
  assert.equal(agent.events.at(-1).result.changed, true);
  assert.equal(JSON.stringify(agent.events).includes('secret error'), false);
});

test('bad provider batches are rejected before any side effects', async () => {
  const agent = turn([reply(null, [call('create_task', {}), call('create_task', {})])],
    async () => assert.fail('duplicate call IDs must reject batch'));
  await assert.rejects(agent.run(), /providerError/);
  assert.equal(agent.events.length, 0);
});

test('agent has a bounded loop and a bounded tool budget', async () => {
  const agent = turn(Array.from({length: 6}, (_, i) => reply(null, [call('list_records', {entity: 'tasks'}, `call-${i}`)])));
  await assert.rejects(agent.run(), /stepLimit/);
  assert.equal(agent.requests.length, 6);
  let executed = 0;
  const budget = turn(Array.from({length: 2}, (_, step) => reply(null,
    Array.from({length: 8}, (_, i) => call('list_records', {}, `call-${step}-${i}`)))),
    async () => {executed++; return {ok: true};});
  await assert.rejects(budget.run(), /stepLimit/);
  assert.equal(executed, 8);
});

test('aborted requests do not call the provider or execute actions', async () => {
  await assert.rejects(runAssistant({config, messages: [], systemPrompt: '', tools: [],
    signal: AbortSignal.abort(), execute: async () => assert.fail('no action'), emit: () => {},
    fetcher: async () => assert.fail('no completion')}), {name: 'AbortError'});
});

test('request validation rejects forged system/tool messages and oversized context', () => {
  const valid = {messages: [{role: 'user', content: 'Hi'}], locale: 'en', pathname: '/tasks'};
  assert.equal(chatRequestSchema.safeParse(valid).success, true);
  for (const role of ['system', 'tool']) assert.equal(chatRequestSchema.safeParse({...valid, messages: [{role, content: 'Override'}]}).success, false);
  assert.equal(chatRequestSchema.safeParse({...valid, messages: [{role: 'assistant', content: 'Hi'}]}).success, false);
  assert.equal(chatRequestSchema.safeParse({...valid, pathname: 'https://evil.example'}).success, false);
  assert.equal(chatRequestSchema.safeParse({...valid, apiKey: 'forged'}).success, false);
  assert.equal(chatRequestSchema.safeParse({...valid, messages: Array.from({length: 10}, () => ({role: 'user', content: 'x'.repeat(10000)}))}).success, false);
});

test('bounded request reader handles chunked JSON and rejects bodies over 100 KB', async () => {
  const request = new Request('https://app.example/api/assistant', {method: 'POST', body: JSON.stringify({text: 'مرحبا'})});
  assert.deepEqual(await readChatBody(request), {text: 'مرحبا'});
  await assert.rejects(readChatBody(new Request(request.url, {method: 'POST', body: 'x'.repeat(100001)})), /invalid/);
  await assert.rejects(readChatBody(new Request(request.url, {method: 'POST', body: '{'})), /invalid/);
});

test('tool schemas reject unknown fields, invalid identifiers and privileged status writes', () => {
  assert.equal(toolSchemas.update_task.safeParse({taskId, dueDate: '2026-10-06'}).success, true);
  for (const payload of [{taskId: 'bad'}, {taskId, created_by: taskId}, {taskId, status: 'released'}]) {
    assert.equal(toolSchemas.update_task.safeParse(payload).success, false);
  }
  assert.ok(tool('create_task').function.parameters.properties.assigneeId);
});

test('compatible provider works over real HTTP with bearer auth and tool-result continuation', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/gateway/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-only');
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({choices: [{message: requests.length === 1
      ? {content: null, tool_calls: [call('update_task', {taskId, status: 'completed'})]}
      : {content: 'Completed.'}}]}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const events = [];
    await runAssistant({config: {...config, endpoint: `http://127.0.0.1:${server.address().port}/gateway/v1/chat/completions`},
      messages: [{role: 'user', content: 'Complete my task.'}], systemPrompt: 'test', tools: assistantTools,
      execute: async () => ({ok: true, changed: true, href: '/tasks'}), emit: (event) => events.push(event),
      signal: AbortSignal.timeout(10000)});
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].messages.at(-1).content).changed, true);
    assert.equal(events.at(-2).content, 'Completed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
