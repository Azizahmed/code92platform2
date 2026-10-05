import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test, {after} from 'node:test';
import {typescriptLoader} from './helpers/load-typescript.mjs';

const userId = 'a5aef004-2c17-4bce-beb4-0a94f7c0d347';
const tokenId = 'd743f742-bdf5-4133-be64-04d9f06c1e6d';
const jwtSecret = 'test-jwt-secret';

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

test('tokens are high-entropy, stored only as a hash, and parsed strictly from the bearer header', () => {
  const {tokens} = loadTokens();
  const a = tokens.generateMcpToken();
  const b = tokens.generateMcpToken();
  assert.match(a.token, /^c92_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.hash, tokens.hashMcpToken(a.token));
  assert.ok(!a.hash.includes(a.token.slice(4)));
  assert.equal(a.prefix, a.token.slice(0, 12));
  assert.equal(tokens.readBearerToken(`Bearer ${a.token}`), a.token);
  assert.equal(tokens.readBearerToken(`bearer  ${a.token}`), a.token);
  for (const header of [null, '', a.token, `Basic ${a.token}`, `Bearer ${a.token}x`, 'Bearer c92_short', `Bearer ${a.token} extra`]) {
    assert.equal(tokens.readBearerToken(header), null, String(header));
  }
});

test('the signed access token is a short-lived HS256 JWT for exactly the token owner', () => {
  const {tokens} = loadTokens();
  const {header, claims} = decodeJwt(tokens.signMemberAccessToken(userId, 1000));
  assert.deepEqual(header, {alg: 'HS256', typ: 'JWT'});
  assert.deepEqual(claims, {sub: userId, role: 'authenticated', aud: 'insforge-api', iat: 1000, exp: 1300});
});

test('resolution sends only the hash to the privileged function', async () => {
  const {token, hash} = loadTokens().tokens.generateMcpToken();
  const {tokens, calls} = loadTokens(async () => ({data: [{token_id: tokenId, user_id: userId, scope: 'read', display_name: 'Aziz'}], error: null}));
  assert.deepEqual(await tokens.resolveMcpCaller(token), {tokenId, userId, scope: 'read', displayName: 'Aziz'});
  assert.deepEqual(calls[0].args, ['resolve_mcp_access_token', {p_token_hash: hash}]);
  assert.equal(calls[0].options.apiKey, 'test-admin-key');
  assert.equal(await loadTokens(async () => ({data: [], error: null})).tokens.resolveMcpCaller(token), null);
  await assert.rejects(loadTokens(async () => ({data: null, error: {message: 'db down'}})).tokens.resolveMcpCaller(token));
});

function loadServer() {
  return typescriptLoader({'./tokens': {}})('lib/mcp/server.ts');
}

function context(scope, execute = async () => ({ok: true, data: {rows: [{href: '/tasks'}]}, href: '/products/1'})) {
  const calls = [];
  return {calls, context: {caller: {userId, displayName: 'Aziz', scope}, origin: 'https://app.example',
    execute: async (...args) => {calls.push(args); return execute(...args);}}};
}

test('initialize negotiates a supported version and identifies the connected member', async () => {
  const {handleMcpMessage} = loadServer();
  const {context: ctx} = context('read');
  const reply = await handleMcpMessage({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18'}}, ctx);
  assert.equal(reply.result.protocolVersion, '2025-06-18');
  assert.deepEqual(reply.result.capabilities, {tools: {listChanged: false}});
  assert.match(reply.result.instructions, new RegExp(userId));
  assert.match(reply.result.instructions, /read-only/);
  const future = await handleMcpMessage({jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '2099-01-01'}}, ctx);
  assert.equal(future.result.protocolVersion, '2025-11-25');
});

test('read tokens list and call only read tools; write tools are a protocol error that never executes', async () => {
  const {handleMcpMessage, mcpTools} = loadServer();
  assert.deepEqual(mcpTools('read').map((tool) => tool.name), ['list_records', 'search_knowledge', 'read_knowledge']);
  assert.equal(mcpTools('write').length, 7);
  for (const tool of mcpTools('write')) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.$schema, undefined);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  // Defaulted fields stay optional for the client.
  assert.ok(!mcpTools('read')[0].inputSchema.required.includes('offset'));

  const {calls, context: ctx} = context('read');
  const denied = await handleMcpMessage({jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {name: 'create_task', arguments: {title: 'x'}}}, ctx);
  assert.equal(denied.error.code, -32602);
  for (const name of ['__proto__', 'toString', 'unknown']) {
    assert.equal((await handleMcpMessage({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name}}, ctx)).error.code, -32602);
  }
  assert.equal(calls.length, 0);
});

test('tool calls reuse the assistant executor, return absolute links and report failures without internals', async () => {
  const {handleMcpMessage} = loadServer();
  const {calls, context: ctx} = context('write');
  const args = {entity: 'tasks', taskStatus: 'pending'};
  const reply = await handleMcpMessage({jsonrpc: '2.0', id: 'a', method: 'tools/call', params: {name: 'list_records', arguments: args}}, ctx);
  assert.deepEqual(calls, [['list_records', args]]);
  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.structuredContent.href, 'https://app.example/products/1');
  assert.equal(reply.result.structuredContent.data.rows[0].href, 'https://app.example/tasks');
  assert.deepEqual(JSON.parse(reply.result.content[0].text), reply.result.structuredContent);

  const failing = context('write', async () => {throw new Error('secret sql detail');});
  const thrown = await handleMcpMessage({jsonrpc: '2.0', id: 'b', method: 'tools/call', params: {name: 'create_task', arguments: {}}}, failing.context);
  assert.equal(thrown.result.isError, true);
  assert.ok(!JSON.stringify(thrown).includes('secret sql'));
});

test('notifications get no reply; batches are sequential; malformed input is a JSON-RPC error', async () => {
  const {handleMcpBody, handleMcpMessage} = loadServer();
  const {context: ctx} = context('read');
  assert.equal(await handleMcpMessage({jsonrpc: '2.0', method: 'notifications/initialized'}, ctx), null);
  assert.equal(await handleMcpMessage({jsonrpc: '2.0', id: 9, result: {}}, ctx), null);
  assert.deepEqual(await handleMcpMessage({jsonrpc: '2.0', id: 5, method: 'ping'}, ctx), {jsonrpc: '2.0', id: 5, result: {}});
  assert.equal((await handleMcpMessage({jsonrpc: '2.0', id: 6, method: 'resources/list'}, ctx)).error.code, -32601);
  assert.equal((await handleMcpMessage('nope', ctx)).error.code, -32600);
  assert.equal((await handleMcpMessage({jsonrpc: '1.0', id: 7, method: 'ping'}, ctx)).error.code, -32600);
  assert.equal(await handleMcpBody([{jsonrpc: '2.0', method: 'notifications/initialized'}], ctx), null);
  const batch = await handleMcpBody([{jsonrpc: '2.0', id: 1, method: 'ping'}, {jsonrpc: '2.0', method: 'notifications/x'},
    {jsonrpc: '2.0', id: 2, method: 'tools/list'}], ctx);
  assert.deepEqual(batch.map((reply) => reply.id), [1, 2]);
  assert.equal((await handleMcpBody([], ctx)).error.code, -32600);
});

function loadRoute({caller = {tokenId, userId, scope: 'write', displayName: 'Aziz'}, resolveError = false, available = true} = {}) {
  const seen = {resolved: [], clients: [], executed: []};
  const load = typescriptLoader({
    'next/headers': {cookies: async () => assert.fail('the MCP route must never read cookies')},
    '@insforge/sdk/ssr': {createServerClient: (options) => {seen.clients.push(options); return {database: {}};}},
    '@/lib/mcp/tokens': {
      mcpAvailable: () => available,
      readBearerToken: (header) => /^Bearer (c92_\S+)$/.exec(header ?? '')?.[1] ?? null,
      resolveMcpCaller: async (token) => {seen.resolved.push(token); if (resolveError) throw new Error('down'); return caller;},
      signMemberAccessToken: (id) => `jwt-for-${id}`
    },
    '@/lib/assistant/tools': {createToolExecutor: (client) => async (name, input) => {
      seen.executed.push({client, name, input}); return {ok: true, data: {}};
    }},
    '@/lib/mcp/server': {...loadServer()}
  });
  return {route: load('app/api/mcp/route.ts'), server: load('lib/insforge/server.ts'), seen};
}

const post = (body, headers = {Authorization: 'Bearer c92_valid'}) => new Request('https://app.example/api/mcp', {
  method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers},
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('the route authenticates every request by bearer token and runs tools as the token owner', async () => {
  const {route, seen} = loadRoute();
  const response = await route.POST(post({jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {name: 'list_records', arguments: {entity: 'products'}}}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.isError, false);
  assert.deepEqual(seen.resolved, ['c92_valid']);
  assert.deepEqual(seen.clients, [{accessToken: `jwt-for-${userId}`}]);
  assert.equal(seen.executed[0].name, 'list_records');

  const accepted = await route.POST(post({jsonrpc: '2.0', method: 'notifications/initialized'}));
  assert.equal(accepted.status, 202);
  assert.equal(await accepted.text(), '');
});

test('the route rejects missing, unknown and revoked tokens before reading the body', async () => {
  const {route, seen} = loadRoute({caller: null});
  const missing = await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}, {}));
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate'), /^Bearer realm="code92-mcp"$/);
  const revoked = await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}));
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get('www-authenticate'), /invalid_token/);
  assert.equal(seen.clients.length, 0);
  assert.equal(seen.executed.length, 0);

  assert.equal((await loadRoute({resolveError: true}).route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}))).status, 503);
  assert.equal((await loadRoute({available: false}).route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'}))).status, 503);
});

test('the route bounds bodies, rejects unsupported protocol versions and offers no GET stream', async () => {
  const {route} = loadRoute();
  assert.equal((await route.POST(post('{not json'))).status, 400);
  assert.equal((await route.POST(post('x'.repeat(300 * 1024)))).status, 413);
  assert.equal((await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'},
    {Authorization: 'Bearer c92_valid', 'MCP-Protocol-Version': '1999-01-01'}))).status, 400);
  assert.equal((await route.POST(post({jsonrpc: '2.0', id: 1, method: 'ping'},
    {Authorization: 'Bearer c92_valid', 'MCP-Protocol-Version': '2025-06-18'}))).status, 200);
  const get = route.GET();
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
});

test('one token is rate limited per instance', async () => {
  const {route} = loadRoute();
  let last;
  for (let index = 0; index < 121; index++) last = await route.POST(post({jsonrpc: '2.0', id: index, method: 'ping'}));
  assert.equal(last.status, 429);
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
  assert.equal(server.hasRequestAccessToken(), false);
  await server.runWithAccessToken('jwt', async () => {
    assert.equal(server.hasRequestAccessToken(), true);
    await server.createInsForgeServerClient();
  });
  assert.deepEqual(seen[1], {accessToken: 'jwt'});
});

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

test('creating a token returns the plaintext once and sends only its hash to the database', async () => {
  const {actions, rpcs} = loadActions();
  const result = await actions.createMcpTokenAction({name: ' Laptop ', scope: 'read', expiresInDays: 90});
  assert.equal(result.ok, true);
  const [name, params] = rpcs[0];
  assert.equal(name, 'create_mcp_access_token');
  assert.equal(params.p_name, 'Laptop');
  assert.equal(params.p_scope, 'read');
  assert.ok(!JSON.stringify(params).includes(result.token));
  assert.equal(params.p_token_prefix, result.token.slice(0, 12));
  const days = (Date.parse(params.p_expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 89.9 && days <= 90);

  assert.deepEqual(await actions.createMcpTokenAction({name: 'x', scope: 'admin', expiresInDays: 90}), {ok: false, error: 'invalid'});
  assert.deepEqual(await actions.createMcpTokenAction({name: 'x', scope: 'read', expiresInDays: 9999}), {ok: false, error: 'invalid'});
  assert.deepEqual(await loadActions({is_active: true}, {message: 'token limit reached'}).actions
    .createMcpTokenAction({name: 'x', scope: 'read', expiresInDays: 30}), {ok: false, error: 'limit'});
});

test('inactive or unlisted users cannot create, list or revoke tokens', async () => {
  for (const member of [null, {is_active: false}]) {
    const {actions, rpcs} = loadActions(member);
    assert.deepEqual(await actions.createMcpTokenAction({name: 'x', scope: 'read', expiresInDays: 30}), {ok: false, error: 'forbidden'});
    assert.deepEqual(await actions.getMcpTokensAction(), []);
    assert.deepEqual(await actions.revokeMcpTokenAction(tokenId), {ok: false});
    assert.equal(rpcs.length, 0);
  }
});
