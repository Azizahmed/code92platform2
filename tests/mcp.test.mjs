import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test, {after} from 'node:test';
import {typescriptLoader} from './helpers/load-typescript.mjs';

const userId = 'a5aef004-2c17-4bce-beb4-0a94f7c0d347';
const otherUserId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const tokenId = 'd743f742-bdf5-4133-be64-04d9f06c1e6d';
const taskId = '3e7c1a52-9a0b-4c7d-8e6f-5a4b3c2d1e0f';
const productId = '6b2d0c4e-1f3a-4b5c-9d8e-7f6a5b4c3d2e';
const jwtSecret = 'test-jwt-secret';
const ALL = ['read', 'tasks', 'products', 'lifecycle', 'knowledge', 'releases', 'channels', 'attachments', 'delete'];

const envNames = ['NEXT_PUBLIC_INSFORGE_URL', 'NEXT_PUBLIC_INSFORGE_ANON_KEY', 'INSFORGE_API_KEY', 'INSFORGE_JWT_SECRET'];
const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, {NEXT_PUBLIC_INSFORGE_URL: 'https://backend.example', NEXT_PUBLIC_INSFORGE_ANON_KEY: 'anon',
  INSFORGE_API_KEY: 'test-admin-key', INSFORGE_JWT_SECRET: jwtSecret});
after(() => {for (const [name, value] of Object.entries(original)) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}});

function decodeJwt(token) {
  const [header, payload, signature] = token.split('.');
  assert.equal(createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url'), signature);
  return {header: JSON.parse(Buffer.from(header, 'base64url')), claims: JSON.parse(Buffer.from(payload, 'base64url'))};
}

function loadTokens(rpc = async () => ({data: [], error: null})) {
  const calls = [];
  const tokens = typescriptLoader({'server-only': {}, '@insforge/sdk': {createAdminClient: (options) => ({database: {
    rpc: async (...args) => {calls.push({options, args}); return rpc(...args);}
  }})}})('lib/mcp/tokens.ts');
  return {tokens, calls};
}

// ------------------------------------------------------------------ tokens

test('tokens are high-entropy, stored only as a hash, and parsed strictly from the bearer header', () => {
  const {tokens} = loadTokens();
  const a = tokens.generateMcpToken();
  const b = tokens.generateMcpToken();
  assert.match(a.token, /^c92_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.hash, tokens.hashMcpToken(a.token));
  assert.equal(a.prefix, a.token.slice(0, 12));
  assert.equal(tokens.readBearerToken(`Bearer ${a.token}`), a.token);
  for (const header of [null, '', a.token, `Basic ${a.token}`, `Bearer ${a.token}x`, 'Bearer c92_short', `Bearer ${a.token} extra`]) {
    assert.equal(tokens.readBearerToken(header), null, String(header));
  }
});

test('the signed access token is a short-lived HS256 JWT for exactly the token owner', () => {
  const {header, claims} = decodeJwt(loadTokens().tokens.signMemberAccessToken(userId, 1000));
  assert.deepEqual(header, {alg: 'HS256', typ: 'JWT'});
  assert.deepEqual(claims, {sub: userId, role: 'authenticated', aud: 'insforge-api', iat: 1000, exp: 1300});
});

test('resolution sends only the hash (or id), and always yields read plus known permissions', async () => {
  const {token, hash} = loadTokens().tokens.generateMcpToken();
  const row = {token_id: tokenId, user_id: userId, permissions: ['tasks', 'bogus'], display_name: 'Aziz'};
  const {tokens, calls} = loadTokens(async () => ({data: [row], error: null}));
  assert.deepEqual(await tokens.resolveMcpCaller(token), {tokenId, userId, displayName: 'Aziz', permissions: ['read', 'tasks']});
  assert.deepEqual(calls[0].args, ['resolve_mcp_access_token', {p_token_hash: hash}]);
  assert.equal(calls[0].options.apiKey, 'test-admin-key');
  await tokens.resolveMcpCallerById(tokenId);
  assert.deepEqual(calls[1].args, ['resolve_mcp_access_token', {p_token_id: tokenId}]);
  assert.equal(await loadTokens().tokens.resolveMcpCaller(token), null);
  await assert.rejects(loadTokens(async () => ({data: null, error: {message: 'db down'}})).tokens.resolveMcpCaller(token));
});

test('sealed handles reject tampering, expiry and use as another kind', () => {
  const {tokens} = loadTokens();
  const sealed = tokens.seal('file', {key: 'a'}, 60, 0);
  assert.equal(tokens.unseal('file', sealed, 1000).key, 'a');
  assert.equal(tokens.unseal('upload', sealed, 1000), null);
  assert.equal(tokens.unseal('file', sealed, 61_000), null);
  const [body, signature] = sealed.split('.');
  const forged = Buffer.from(JSON.stringify({key: 'b', kind: 'file', exp: 9e9})).toString('base64url');
  assert.equal(tokens.unseal('file', `${forged}.${signature}`, 1000), null);
  assert.equal(tokens.unseal('file', `${body}.${signature}x`, 1000), null);
  for (const value of [null, 42, '', 'a.b.c', `${body}.`]) assert.equal(tokens.unseal('file', value, 1000), null);
});

// ------------------------------------------------------------------ protocol

function loadServer() {
  return typescriptLoader({})('lib/mcp/server.ts');
}

function protocolContext(permissions = ['read'], result = {ok: true, data: {rows: [{href: '/tasks'}]}, href: '/products/1'}) {
  const calls = [];
  return {calls, context: {caller: {userId, displayName: 'Aziz', permissions}, origin: 'https://app.example', tools: {
    list: () => [{name: 'list_records'}],
    allowed: (name) => name === 'list_records',
    call: async (...args) => {calls.push(args); if (result instanceof Error) throw result; return result;}
  }}};
}

test('initialize negotiates a supported version and describes the member and their permissions', async () => {
  const {handleMcpMessage} = loadServer();
  const read = await handleMcpMessage({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18'}},
    protocolContext().context);
  assert.equal(read.result.protocolVersion, '2025-06-18');
  assert.match(read.result.instructions, new RegExp(userId));
  assert.match(read.result.instructions, /can read only/);
  const full = await handleMcpMessage({jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '2099-01-01'}},
    protocolContext(['read', 'tasks', 'delete']).context);
  assert.equal(full.result.protocolVersion, '2025-11-25');
  assert.match(full.result.instructions, /write permissions: tasks, delete/);
});

test('tool calls go through the permission gate, return absolute links and hide internal errors', async () => {
  const {handleMcpMessage} = loadServer();
  const {calls, context} = protocolContext();
  const denied = await handleMcpMessage({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'delete_task'}}, context);
  assert.equal(denied.error.code, -32602);
  assert.equal(calls.length, 0);
  const reply = await handleMcpMessage({jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: {name: 'list_records', arguments: {entity: 'tasks'}}}, context);
  assert.deepEqual(calls, [['list_records', {entity: 'tasks'}]]);
  assert.equal(reply.result.structuredContent.href, 'https://app.example/products/1');
  assert.equal(reply.result.structuredContent.data.rows[0].href, 'https://app.example/tasks');
  const thrown = await handleMcpMessage({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'list_records'}},
    protocolContext(['read'], new Error('secret sql detail')).context);
  assert.equal(thrown.result.isError, true);
  assert.ok(!JSON.stringify(thrown).includes('secret sql'));
});

test('notifications get no reply; batches are sequential; malformed input is a JSON-RPC error', async () => {
  const {handleMcpBody, handleMcpMessage} = loadServer();
  const {context} = protocolContext();
  assert.equal(await handleMcpMessage({jsonrpc: '2.0', method: 'notifications/initialized'}, context), null);
  assert.equal(await handleMcpMessage({jsonrpc: '2.0', id: 9, result: {}}, context), null);
  assert.equal((await handleMcpMessage({jsonrpc: '2.0', id: 6, method: 'resources/list'}, context)).error.code, -32601);
  assert.equal((await handleMcpMessage('nope', context)).error.code, -32600);
  assert.equal(await handleMcpBody([{jsonrpc: '2.0', method: 'notifications/initialized'}], context), null);
  const batch = await handleMcpBody([{jsonrpc: '2.0', id: 1, method: 'ping'}, {jsonrpc: '2.0', method: 'notifications/x'},
    {jsonrpc: '2.0', id: 2, method: 'tools/list'}], context);
  assert.deepEqual(batch.map((reply) => reply.id), [1, 2]);
  assert.equal((await handleMcpBody([], context)).error.code, -32600);
});

// ------------------------------------------------------------------ tools

function fakeClient({rows = {}} = {}) {
  const calls = [];
  const query = (table) => {
    const filters = [];
    const builder = new Proxy({}, {get: (_, name) => {
      if (name === 'then') return (resolve) => resolve({data: rows[table] ?? [], error: null});
      if (name === 'maybeSingle') return async () => ({data: (rows[table] ?? [])[0] ?? null, error: null});
      return (...args) => {calls.push([table, name, ...args]); filters.push([name, ...args]); return builder;};
    }});
    return builder;
  };
  return {calls, client: {
    database: {from: (table) => query(table), rpc: async () => ({data: null, error: null})},
    storage: {from: (bucket) => ({
      upload: async (path, blob) => {calls.push(['storage.upload', bucket, path, blob.type, blob.size]);
        return {data: {url: `https://cdn.example/${bucket}/${path}`, key: path, size: blob.size}, error: null};},
      remove: async (key) => {calls.push(['storage.remove', bucket, key]); return {data: null, error: null};}
    })}
  }};
}

function loadTools(actions = {}) {
  const recorded = [];
  const record = (name, result) => async (...args) => {recorded.push([name, ...args]); return result;};
  const ok = {ok: true};
  const mocks = {
    'server-only': {}, '@insforge/sdk': {createAdminClient: () => assert.fail('tools must not use the admin client')},
    '@/lib/actions/notifications': {setTaskWatchAction: record('setTaskWatchAction', ok)},
    '@/lib/actions/channels': {
      getChannelsAction: async () => [{id: 'c1', name: 'general', dm_user_a: null}, {id: 'c2', name: 'dm', dm_user_a: userId}],
      getChannelViewAction: async () => ({channel: {id: 'c2', dm_user_a: userId}, messages: [], attachments: []}),
      postMessageAction: record('postMessageAction', {ok: true, messageId: 'm1'}), createChannelAction: record('createChannelAction', ok),
      openDirectMessageAction: record('openDirectMessageAction', ok), attachFilesToMessageAction: record('attachFilesToMessageAction', ok),
      deleteMessageAction: record('deleteMessageAction', ok)
    },
    '@/lib/actions/knowledge': {createKnowledgeItemAction: record('createKnowledgeItemAction', {ok: true, itemId: 'k1'}),
      updateKnowledgeItemAction: record('updateKnowledgeItemAction', ok), setKnowledgeArchivedAction: record('x', ok),
      createTagAction: record('x', ok), signKnowledgeFileAction: record('x', ok),
      deleteKnowledgeItemAction: record('deleteKnowledgeItemAction', {ok: true, fileKey: 'sources/f.pdf'})},
    '@/lib/actions/lifecycle': {addPhaseArtifactAction: record('addPhaseArtifactAction', ok), advanceLifecyclePhaseAction: record('x', ok),
      deletePhaseArtifactAction: record('x', ok), setLifecyclePhaseDetailsAction: record('x', ok), setProductRiskTierAction: record('x', ok)},
    '@/lib/actions/media': {addTaskAttachmentsAction: record('addTaskAttachmentsAction', ok),
      addStatusUpdateAttachmentsAction: record('x', ok), setProductLogoAction: record('x', ok)},
    '@/lib/actions/products': {createProductAction: record('createProductAction', {ok: true, productId}),
      updateProductAction: record('updateProductAction', ok), setProductArchivedAction: record('x', ok)},
    '@/lib/actions/releases': {advanceReleaseStatusAction: record('x', ok), createReleaseAction: record('x', ok),
      deleteReleaseAction: record('x', ok), setReleaseCheckAction: record('x', ok), setTaskReleaseAction: record('x', ok),
      updateReleaseAction: record('x', ok)},
    '@/lib/actions/status-updates': {deleteStatusUpdateAction: record('x', ok), postStatusUpdateAction: record('x', ok)},
    '@/lib/actions/tasks': {createTaskAction: record('createTaskAction', {ok: true, taskId}), patchTaskAction: record('patchTaskAction', ok),
      deleteTaskAction: record('deleteTaskAction', {ok: true, taskId, storageKeys: ['mcp/tasks/a.png', 'mcp/tasks/b.pdf']})},
    ...actions
  };
  return {tools: typescriptLoader(mocks)('lib/mcp/tools.ts'), recorded};
}

function toolContext(client, permissions = ALL, user = userId) {
  return {insforge: client, origin: 'https://app.example',
    caller: {tokenId, userId: user, displayName: 'Aziz', permissions},
    assistant: async (name, input) => ({ok: true, data: {name, input}})};
}

test('the tool list is exactly what the token was granted, with honest annotations', () => {
  const {tools} = loadTools();
  const readOnly = tools.mcpToolList(['read']);
  assert.ok(readOnly.length >= 8);
  assert.ok(readOnly.every((tool) => tool.annotations.readOnlyHint));
  assert.ok(readOnly.some((tool) => tool.name === 'get_product'));
  const full = tools.mcpToolList(ALL);
  const names = full.map((tool) => tool.name);
  for (const name of ['create_task', 'update_product', 'advance_lifecycle_phase', 'create_knowledge_item', 'create_release',
    'post_message', 'upload_file', 'create_upload_link', 'attach_files_to_task', 'delete_task']) assert.ok(names.includes(name), name);
  for (const tool of full) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.inputSchema.$schema, undefined);
    assert.equal(tool.annotations.destructiveHint, tool.name.startsWith('delete_') || tool.name === 'set_product_archived', tool.name);
  }
  const tasksOnly = tools.mcpToolList(['read', 'tasks']).map((tool) => tool.name);
  assert.ok(tasksOnly.includes('update_task') && !tasksOnly.includes('delete_task') && !tasksOnly.includes('upload_file'));
  assert.equal(tools.toolAllowed('delete_task', ['read', 'tasks']), false);
  assert.equal(tools.toolAllowed('__proto__', ALL), false);
  assert.equal(tools.toolAllowed('toString', ALL), false);
});

test('writes delegate validated input to the existing actions; invalid input explains itself without executing', async () => {
  const {tools, recorded} = loadTools();
  const {client} = fakeClient();
  const created = await tools.runMcpTool('create_task', {title: 'Ship it', productId: null, parentTaskId: null, notes: null,
    dueDate: null, assigneeId: null}, toolContext(client));
  assert.deepEqual(created, {ok: true, changed: true, data: {taskId}, href: '/tasks'});
  await tools.runMcpTool('update_task', {taskId, status: 'completed'}, toolContext(client));
  assert.deepEqual(recorded.find(([name]) => name === 'patchTaskAction'), ['patchTaskAction', taskId, {status: 'completed'}]);
  const invalid = await tools.runMcpTool('update_task', {taskId, created_by: userId}, toolContext(client));
  assert.equal(invalid.error, 'invalid');
  assert.ok(invalid.data.issues.length > 0);
  assert.equal(recorded.filter(([name]) => name === 'patchTaskAction').length, 1);
});

test('partial product updates keep every field the client did not send', async () => {
  const {tools, recorded} = loadTools();
  const {client} = fakeClient({rows: {products: [{name: 'Old', slug: 'old', description: 'd', description_ar: null,
    category: null, stage: 'beta', keywords: ['k'], links: {}, review_interval_days: 14, trend_scan_enabled: true,
    logo_url: null, logo_key: null}]}});
  assert.equal((await tools.runMcpTool('update_product', {productId, name: 'New'}, toolContext(client))).ok, true);
  const [, id, input] = recorded.find(([name]) => name === 'updateProductAction');
  assert.equal(id, productId);
  assert.deepEqual(input, {name: 'New', slug: 'old', description: 'd', descriptionAr: null, category: null, stage: 'beta',
    keywords: ['k'], links: {}, reviewIntervalDays: 14, trendScanEnabled: true, logoUrl: null, logoKey: null});
});

test('uploads are stored under the member session and become fileIds bound to member and purpose', async () => {
  const {tools, recorded} = loadTools();
  const {client, calls} = fakeClient();
  const uploaded = await tools.runMcpTool('upload_file', {purpose: 'task', fileName: 'notes.md', text: '# Hello'}, toolContext(client));
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.data.mimeType, 'text/markdown');
  const upload = calls.find(([kind]) => kind === 'storage.upload');
  assert.equal(upload[1], 'product-media');
  assert.match(upload[2], /^mcp\/tasks\/[0-9a-f-]{36}\.md$/);

  const attached = await tools.runMcpTool('attach_files_to_task', {taskId, fileIds: [uploaded.data.fileId]}, toolContext(client));
  assert.equal(attached.ok, true);
  const [, id, files] = recorded.find(([name]) => name === 'addTaskAttachmentsAction');
  assert.equal(id, taskId);
  assert.deepEqual(Object.keys(files[0]).sort(), ['fileName', 'key', 'mimeType', 'sizeBytes', 'url']);
  assert.equal(files[0].key, upload[2]);

  // Another member, or the wrong purpose, cannot use the handle.
  assert.equal((await tools.runMcpTool('attach_files_to_task', {taskId, fileIds: [uploaded.data.fileId]},
    toolContext(client, ALL, otherUserId))).error, 'invalidFile');
  assert.equal((await tools.runMcpTool('attach_files_to_message', {messageId: taskId, fileIds: [uploaded.data.fileId]},
    toolContext(client))).error, 'invalidFile');
  assert.equal((await tools.runMcpTool('attach_files_to_task', {taskId, fileIds: ['forged.handle']}, toolContext(client))).error,
    'invalidFile');
});

test('uploads enforce type and size rules; files on other records need the attachments permission', async () => {
  const {tools, recorded} = loadTools();
  const {client} = fakeClient();
  assert.equal((await tools.runMcpTool('upload_file', {purpose: 'logo', fileName: 'a.pdf', contentBase64: 'JVBERg=='},
    toolContext(client))).error, 'fileType');
  assert.equal((await tools.runMcpTool('upload_file', {purpose: 'task', fileName: 'run.exe', contentBase64: 'TVo='},
    toolContext(client))).error, 'fileType');
  assert.equal((await tools.runMcpTool('upload_file', {purpose: 'task', fileName: '../x.md', text: 'x'},
    toolContext(client))).error, 'fileName');
  assert.equal((await tools.runMcpTool('upload_file', {purpose: 'task', fileName: 'x.md', text: 'a', contentBase64: 'YQ=='},
    toolContext(client))).error, 'invalid');
  const stored = await tools.runMcpTool('upload_file', {purpose: 'knowledge', fileName: 'brief.pdf', contentBase64: 'JVBERg=='},
    toolContext(client));
  const denied = await tools.runMcpTool('create_knowledge_item', {kind: 'source', title: 'Brief', status: 'draft',
    fileId: stored.data.fileId}, toolContext(client, ['read', 'knowledge']));
  assert.match(denied.error, /attachments permission/);
  assert.equal(recorded.filter(([name]) => name === 'createKnowledgeItemAction').length, 0);
});

test('upload links are signed tickets for this member and token', async () => {
  const {tools} = loadTools();
  const {client} = fakeClient();
  const link = await tools.runMcpTool('create_upload_link', {purpose: 'lifecycle', fileName: 'report.pdf'}, toolContext(client));
  assert.equal(link.ok, true);
  const url = new URL(link.data.uploadUrl);
  assert.equal(url.origin + url.pathname, 'https://app.example/api/mcp/uploads');
  const files = typescriptLoader({'server-only': {}, '@insforge/sdk': {}})('lib/mcp/files.ts');
  assert.deepEqual({...files.openUploadTicket(url.searchParams.get('ticket')), exp: undefined, kind: undefined},
    {userId, tokenId, purpose: 'lifecycle', fileName: 'report.pdf', mimeType: '', exp: undefined, kind: undefined});
  assert.equal((await tools.runMcpTool('create_upload_link', {purpose: 'status_update', fileName: 'x.pdf'}, toolContext(client))).error,
    'fileType');
});

test('deletes clean up storage like the browser does; direct messages need the channels permission', async () => {
  const {tools} = loadTools();
  const {client, calls} = fakeClient({rows: {knowledge_items: [{file_bucket: 'knowledge-files'}]}});
  assert.equal((await tools.runMcpTool('delete_task', {taskId}, toolContext(client))).ok, true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'storage.remove').map(([, bucket, key]) => `${bucket}/${key}`),
    ['product-media/mcp/tasks/a.png', 'product-media/mcp/tasks/b.pdf']);
  await tools.runMcpTool('delete_knowledge_item', {itemId: taskId}, toolContext(client));
  assert.ok(calls.some(([kind, bucket, key]) => kind === 'storage.remove' && bucket === 'knowledge-files' && key === 'sources/f.pdf'));

  const readOnly = await tools.runMcpTool('list_channels', {}, toolContext(client, ['read']));
  assert.deepEqual(readOnly.data.rows.map((row) => row.id), ['c1']);
  assert.deepEqual((await tools.runMcpTool('list_channels', {}, toolContext(client))).data.rows.map((row) => row.id), ['c1', 'c2']);
  assert.match((await tools.runMcpTool('read_channel', {channelId: taskId}, toolContext(client, ['read']))).error, /channels permission/);
});

// ------------------------------------------------------------------ routes

const caller = {tokenId, userId, permissions: ['read', 'tasks'], displayName: 'Aziz'};

function loadRoutes({resolved = caller, resolveError = false, available = true} = {}) {
  const seen = {resolved: [], clients: [], ran: []};
  const load = typescriptLoader({
    'server-only': {},
    'next/headers': {cookies: async () => assert.fail('the MCP routes must never read cookies')},
    '@insforge/sdk/ssr': {createServerClient: (options) => {seen.clients.push(options); return fakeClient().client;}},
    '@insforge/sdk': {},
    '@/lib/mcp/tokens': {
      ...loadTokens().tokens,
      mcpAvailable: () => available,
      readBearerToken: (header) => /^Bearer (c92_\S+)$/.exec(header ?? '')?.[1] ?? null,
      resolveMcpCaller: async (token) => {seen.resolved.push(token); if (resolveError) throw new Error('down'); return resolved;},
      resolveMcpCallerById: async (id) => {seen.resolved.push(id); return resolved;},
      signMemberAccessToken: (id) => `jwt-for-${id}`
    },
    '@/lib/assistant/tools': {createToolExecutor: () => async () => ({ok: true})},
    '@/lib/mcp/tools': {
      mcpToolList: (permissions) => permissions.map((name) => ({name})),
      toolAllowed: (name, permissions) => permissions.includes(name),
      runMcpTool: async (name, input, context) => {seen.ran.push({name, input, permissions: context.caller.permissions}); return {ok: true};}
    }
  });
  return {route: load('app/api/mcp/route.ts'), uploads: load('app/api/mcp/uploads/route.ts'),
    files: load('lib/mcp/files.ts'), seen};
}

const post = (body, headers = {Authorization: 'Bearer c92_valid'}) => new Request('https://app.example/api/mcp', {
  method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers},
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('the route authenticates every request by bearer token and runs tools as the owner with their permissions', async () => {
  const {route, seen} = loadRoutes();
  const listed = await (await route.POST(post({jsonrpc: '2.0', id: 1, method: 'tools/list'}))).json();
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['read', 'tasks']);
  const response = await route.POST(post({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'tasks', arguments: {a: 1}}}));
  assert.equal((await response.json()).result.isError, false);
  assert.deepEqual(seen.ran, [{name: 'tasks', input: {a: 1}, permissions: ['read', 'tasks']}]);
  assert.deepEqual(seen.clients.at(-1), {accessToken: `jwt-for-${userId}`});
  const accepted = await route.POST(post({jsonrpc: '2.0', method: 'notifications/initialized'}));
  assert.equal(accepted.status, 202);
});

test('the route rejects missing, unknown and revoked tokens before reading the body', async () => {
  const {route, seen} = loadRoutes({resolved: null});
  const missing = await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}, {}));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer realm="code92-mcp"');
  const revoked = await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}));
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get('www-authenticate'), /invalid_token/);
  assert.equal(seen.clients.length, 0);
  assert.equal((await loadRoutes({resolveError: true}).route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}))).status, 503);
  assert.equal((await loadRoutes({available: false}).route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}))).status, 503);
});

test('the route bounds bodies, rejects unsupported protocol versions, rate limits and offers no GET stream', async () => {
  const {route} = loadRoutes();
  assert.equal((await route.POST(post('{not json'))).status, 400);
  assert.equal((await route.POST(post('x'.repeat(5 * 1024 * 1024)))).status, 413);
  assert.equal((await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'},
    {Authorization: 'Bearer c92_valid', 'MCP-Protocol-Version': '1999-01-01'}))).status, 400);
  assert.equal(route.GET().status, 405);
  let last;
  for (let index = 0; index < 121; index++) last = await route.POST(post({jsonrpc: '2.0', id: index, method: 'ping'}));
  assert.equal(last.status, 429);
});

test('upload links store bytes once for a live token with the attachments permission', async () => {
  const withFiles = {...caller, permissions: ['read', 'attachments']};
  const {uploads, files, seen} = loadRoutes({resolved: withFiles});
  const ticket = files.createUploadTicket({userId, tokenId, purpose: 'task', fileName: 'notes.md', mimeType: ''});
  const put = (value, body = '# hi') => uploads.PUT(new Request(`https://app.example/api/mcp/uploads?ticket=${encodeURIComponent(value)}`,
    {method: 'PUT', body}));
  const stored = await put(ticket);
  assert.equal(stored.status, 201);
  const json = await stored.json();
  assert.equal(json.mimeType, 'text/markdown');
  assert.equal(files.openFile(json.fileId, userId, 'task').fileName, 'notes.md');
  assert.deepEqual(seen.clients.at(-1), {accessToken: `jwt-for-${userId}`});
  assert.equal((await put('forged')).status, 401);
  assert.equal((await put(ticket, 'x'.repeat(5 * 1024 * 1024))).status, 413);

  assert.equal((await loadRoutes({resolved: caller}).uploads.PUT(new Request(
    `https://app.example/api/mcp/uploads?ticket=${encodeURIComponent(ticket)}`, {method: 'PUT', body: 'x'}))).status, 401);
  assert.equal((await loadRoutes({resolved: null}).uploads.PUT(new Request(
    `https://app.example/api/mcp/uploads?ticket=${encodeURIComponent(ticket)}`, {method: 'PUT', body: 'x'}))).status, 401);
});

test('outside a token-scoped run the server client still uses cookies', async () => {
  const seen = [];
  const store = {get: () => undefined};
  const server = typescriptLoader({
    'next/headers': {cookies: async () => store},
    '@insforge/sdk/ssr': {createServerClient: (options) => {seen.push(options); return {};}}
  })('lib/insforge/server.ts');
  await server.createInsForgeServerClient();
  assert.equal(seen[0].cookies, store);
  await server.runWithAccessToken('jwt', async () => {
    assert.equal(server.hasRequestAccessToken(), true);
    await server.createInsForgeServerClient();
  });
  assert.deepEqual(seen[1], {accessToken: 'jwt'});
});

// ------------------------------------------------------------------ token actions

function loadActions(member = {is_active: true}, rpcError = null) {
  const rpcs = [];
  const actions = typescriptLoader({
    'server-only': {},
    '@insforge/sdk': {createAdminClient: () => assert.fail('token actions must not use the admin client')},
    'next/cache': {revalidatePath: () => {}},
    '@/lib/auth': {getOwnMembership: async () => member},
    '@/lib/insforge/server': {createInsForgeServerClient: async () => ({database: {
      rpc: async (...args) => {rpcs.push(args); return {data: tokenId, error: rpcError};}
    }})}
  })('lib/actions/mcp-tokens.ts');
  return {actions, rpcs};
}

test('creating a token records the chosen permissions and only the hash', async () => {
  const {actions, rpcs} = loadActions();
  const result = await actions.createMcpTokenAction({name: ' Laptop ', permissions: ['tasks', 'attachments', 'tasks'], expiresInDays: 90});
  assert.equal(result.ok, true);
  const [name, params] = rpcs[0];
  assert.equal(name, 'create_mcp_access_token');
  assert.equal(params.p_name, 'Laptop');
  assert.deepEqual(params.p_permissions, ['read', 'tasks', 'attachments']);
  assert.ok(!JSON.stringify(params).includes(result.token));
  const days = (Date.parse(params.p_expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 89.9 && days <= 90);

  assert.deepEqual((await actions.createMcpTokenAction({name: 'x', permissions: [], expiresInDays: 30})).ok, true);
  assert.deepEqual(rpcs[1][1].p_permissions, ['read']);
  for (const permissions of [['admin'], ['read'], 'tasks']) {
    assert.deepEqual(await actions.createMcpTokenAction({name: 'x', permissions, expiresInDays: 30}), {ok: false, error: 'invalid'});
  }
  assert.deepEqual(await loadActions({is_active: true}, {message: 'token limit reached'}).actions
    .createMcpTokenAction({name: 'x', permissions: [], expiresInDays: 30}), {ok: false, error: 'limit'});
});

test('inactive or unlisted users cannot create, list or revoke tokens', async () => {
  for (const member of [null, {is_active: false}]) {
    const {actions, rpcs} = loadActions(member);
    assert.deepEqual(await actions.createMcpTokenAction({name: 'x', permissions: [], expiresInDays: 30}), {ok: false, error: 'forbidden'});
    assert.deepEqual(await actions.getMcpTokensAction(), []);
    assert.deepEqual(await actions.revokeMcpTokenAction(tokenId), {ok: false});
    assert.equal(rpcs.length, 0);
  }
});
