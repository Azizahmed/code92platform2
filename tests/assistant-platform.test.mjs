import assert from 'node:assert/strict';
import test from 'node:test';
import {typescriptLoader} from './helpers/load-typescript.mjs';

const userId = 'a5aef004-2c17-4bce-beb4-0a94f7c0d347';
const taskId = 'd743f742-bdf5-4133-be64-04d9f06c1e6d';

function database(rows = [], error = null) {
  const calls = [];
  const query = new Proxy({}, {get: (_, name) => {
    if (name === 'then') return (resolve) => resolve({data: rows, error});
    return (...args) => {calls.push([name, ...args]); return query;};
  }});
  return {calls, database: {from: (...args) => {calls.push(['from', ...args]); return query;},
    rpc: (...args) => {calls.push(['rpc', ...args]); return query;}}};
}

test('platform lists are scoped, paginated and contain links; database errors are not empty success', async () => {
  const db = database(Array.from({length: 26}, () => ({id: taskId, title: 'Task'})));
  const {createToolExecutor} = typescriptLoader({
    '@/lib/actions/tasks': {}, '@/lib/actions/knowledge': {}, '@/lib/actions/status-updates': {},
    '@/lib/insforge/server': {}
  })('lib/assistant/tools.ts');
  const execute = createToolExecutor(db);
  const result = await execute('list_records', {entity: 'tasks', assigneeId: userId, taskStatus: 'pending'});
  assert.equal(result.data.rows.length, 25);
  assert.equal(result.data.hasMore, true);
  assert.equal(result.data.nextOffset, 25);
  assert.equal(result.data.rows[0].href, '/tasks');
  assert.ok(db.calls.some(([name, column, value]) => name === 'eq' && column === 'assignee_id' && value === userId));
  assert.ok(db.calls.some(([name, start, end]) => name === 'range' && start === 0 && end === 25));
  assert.equal((await execute('list_records', {entity: 'members', productId: taskId})).ok, false);
  assert.deepEqual(await createToolExecutor(database([], {message: 'secret sql'}))('list_records', {entity: 'tasks'}), {ok: false, error: 'readFailed'});
});

test('tool adapter delegates only validated writes to existing user-scoped actions', async () => {
  const calls = [];
  const {createToolExecutor} = typescriptLoader({
    '@/lib/actions/tasks': {
      patchTaskAction: async (...args) => {calls.push(args); return {ok: true, taskId};},
      createTaskAction: async () => assert.fail('wrong action')
    },
    '@/lib/actions/knowledge': {}, '@/lib/actions/status-updates': {}, '@/lib/insforge/server': {}
  })('lib/assistant/tools.ts');
  const execute = createToolExecutor(database());
  assert.equal((await execute('update_task', {taskId, status: 'completed'})).changed, true);
  assert.deepEqual(calls, [[taskId, {status: 'completed'}]]);
  assert.equal((await execute('update_task', {taskId, created_by: userId})).ok, false);
  assert.equal((await execute('__proto__', {})).ok, false);
  assert.equal(calls.length, 1);
});

test('knowledge creation always makes a draft with the normal action', async () => {
  let saved;
  const {createToolExecutor} = typescriptLoader({
    '@/lib/actions/knowledge': {createKnowledgeItemAction: async (input) => {
      saved = input; return {ok: true, itemId: taskId};
    }}, '@/lib/actions/tasks': {}, '@/lib/actions/status-updates': {}, '@/lib/insforge/server': {}
  })('lib/assistant/tools.ts');
  const result = await createToolExecutor(database())('create_knowledge_note', {title: 'Notes', content: 'Content', productIds: []});
  assert.equal(saved.status, 'draft');
  assert.equal(saved.kind, 'note');
  assert.equal(result.href, `/knowledge/${taskId}`);
});

test('partial task action preserves unrelated fields and revalidates affected pages', async () => {
  const db = database([{id: taskId, product_id: null}]);
  const paths = [];
  const {patchTaskAction} = typescriptLoader({
    'next/cache': {revalidatePath: (...args) => paths.push(args)},
    '@/lib/auth': {getSessionUser: async () => ({id: userId}), getOwnMembership: async () => ({is_active: true})},
    '@/lib/insforge/server': {createInsForgeServerClient: async () => db}
  })('lib/actions/tasks.ts');
  const result = await patchTaskAction(taskId, {dueDate: '2026-10-08'});
  assert.equal(result.ok, true);
  assert.deepEqual(db.calls.find(([name]) => name === 'update')[1], {due_date: '2026-10-08'});
  assert.ok(paths.some(([path]) => path === '/[locale]/tasks'));
  const callCount = db.calls.length;
  assert.equal((await patchTaskAction(taskId, {})).ok, false);
  assert.equal(db.calls.length, callCount);
});

test('inactive members cannot mutate tasks and a row hidden by RLS is not a success', async () => {
  for (const is_active of [false, true]) {
    const db = database([]);
    const {patchTaskAction} = typescriptLoader({
      'next/cache': {revalidatePath: () => assert.fail('no revalidation')},
      '@/lib/auth': {getSessionUser: async () => ({id: userId}), getOwnMembership: async () => ({is_active})},
      '@/lib/insforge/server': {createInsForgeServerClient: async () => db}
    })('lib/actions/tasks.ts');
    assert.deepEqual(await patchTaskAction(taskId, {status: 'completed'}), {ok: false, error: is_active ? 'notFound' : 'forbidden'});
    if (!is_active) assert.equal(db.calls.length, 0);
  }
});

function route({member = {is_active: true}, run, configError} = {}) {
  let calls = 0;
  const load = typescriptLoader({
    '@/lib/auth': {getSessionUser: async () => ({id: userId}), getOwnMembership: async () => member},
    '@/lib/insforge/server': {createInsForgeServerClient: async () => ({})},
    '@/lib/assistant/tools': {createToolExecutor: () => () => ({ok: true})},
    '@/lib/assistant/settings': {loadAssistantProviderConfig: async () => {
      if (configError) throw configError; return {model: 'test'};
    }},
    '@/lib/assistant/runtime': {
      ...typescriptLoader()('lib/assistant/runtime.ts'),
      readProviderConfig: () => {if (configError) throw configError; return {model: 'test'};},
      runAssistant: async (args) => {calls++; return run ? run(args) : args.emit({type: 'done'});}
    }
  });
  return {POST: load('app/api/assistant/route.ts').POST, calls: () => calls};
}
const request = (origin = 'https://app.example') => new Request('https://app.example/api/assistant', {
  method: 'POST', headers: {origin, 'Content-Type': 'application/json'},
  body: JSON.stringify({messages: [{role: 'user', content: 'Help'}], locale: 'en', pathname: '/tasks'})
});

test('chat route rejects foreign origins and inactive members before a model call', async () => {
  const inactive = route({member: {is_active: false}});
  assert.equal((await inactive.POST(request())).status, 403);
  assert.equal(inactive.calls(), 0);
  const foreign = route();
  assert.equal((await foreign.POST(request('https://foreign.example'))).status, 403);
  assert.equal(foreign.calls(), 0);
});

test('chat streams action results and always releases admission after provider failure', async () => {
  const harness = route({run: async ({emit}) => {
    emit({type: 'result', tool: 'create_task', id: 'call-1', result: {ok: true, changed: true}});
    throw new Error('private provider error');
  }});
  const response = await harness.POST(request());
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].result.changed, true);
  assert.deepEqual(events[1], {type: 'error', error: 'generic'});
  assert.deepEqual(events.at(-1), {type: 'done'});
  assert.equal((await harness.POST(request())).status, 200);
});

test('overlapping turns from a user are refused until the current turn ends', async () => {
  let finish;
  const harness = route({run: async ({emit}) => {
    await new Promise((resolve) => {finish = resolve;});
    emit({type: 'done'});
  }});
  const response = await harness.POST(request());
  assert.equal((await harness.POST(request())).status, 429);
  finish();
  await response.text();
  assert.equal(harness.calls(), 1);
});
