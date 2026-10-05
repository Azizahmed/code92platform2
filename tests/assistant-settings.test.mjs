import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {typescriptLoader} from './helpers/load-typescript.mjs';

const envNames = ['NEXT_PUBLIC_INSFORGE_URL', 'INSFORGE_API_KEY', 'ASSISTANT_SETTINGS_ENCRYPTION_KEY',
  'ASSISTANT_BASE_URL', 'ASSISTANT_MODEL', 'ASSISTANT_API_KEY'];
const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, {NEXT_PUBLIC_INSFORGE_URL: 'https://backend.example', INSFORGE_API_KEY: 'test-admin-key',
  ASSISTANT_SETTINGS_ENCRYPTION_KEY: 'ab'.repeat(32), ASSISTANT_BASE_URL: 'https://fallback.example/v1',
  ASSISTANT_MODEL: 'fallback-model', ASSISTANT_API_KEY: 'fallback-key'});
after(() => {for (const [name, value] of Object.entries(original)) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}});

function harness(member = {role: 'admin', is_active: true}) {
  let row = {id: true, base_url: null, model: null, key_ciphertext: null, updated_at: 'v1'};
  const calls = [], paths = [];
  let fail = false;
  const client = {database: {from(name) {
    calls.push(name);
    assert.equal(name, 'assistant_settings');
    let update;
    const filters = [];
    const query = {
      select() {return query;},
      update(value) {update = value; return query;},
      eq(name, value) {filters.push([name, value]); return query;},
      async single() {return {data: {...row}, error: fail ? {message: 'private db error'} : null};},
      then(resolve) {
        const matches = filters.every(([name, value]) => row[name] === value);
        if (!fail && matches && update) row = {...row, ...update, updated_at: row.updated_at + 'x'};
        return Promise.resolve({data: matches ? [{id: true}] : [], error: fail ? {message: 'private db error'} : null}).then(resolve);
      }
    };
    return query;
  }}};
  const load = typescriptLoader({'server-only': {}, '@insforge/sdk': {createAdminClient: () => client},
    '@/lib/auth': {getOwnMembership: async () => member}, 'next/cache': {revalidatePath: (...args) => paths.push(args)}});
  return {settings: load('lib/assistant/settings.ts'), actions: load('lib/actions/assistant-settings.ts'),
    calls, paths, row: () => row, fail: () => {fail = true;}};
}

const input = {baseUrl: 'https://provider.example/api/v1/', model: 'vendor/model', apiKey: 'provider-secret'};

test('saved provider takes precedence, status never returns secrets, clear restores environment fallback', async () => {
  const h = harness();
  assert.equal((await h.settings.loadAssistantProviderConfig()).apiKey, 'fallback-key');
  assert.deepEqual(await h.actions.saveAssistantSettingsAction(input), {ok: true});
  assert.ok(!h.row().key_ciphertext.includes(input.apiKey));
  assert.equal(h.settings.decryptAssistantKey(h.row().key_ciphertext), input.apiKey);
  const status = await h.actions.getAssistantSettingsAction();
  assert.deepEqual(status, {available: true, source: 'admin', baseUrl: 'https://provider.example/api/v1', model: 'vendor/model', hasKey: true});
  assert.ok(!JSON.stringify(status).includes(input.apiKey));
  assert.equal((await h.settings.loadAssistantProviderConfig()).apiKey, input.apiKey);
  assert.ok(h.paths.some(([path]) => path === '/[locale]/settings'));
  assert.deepEqual(await h.actions.clearAssistantSettingsAction(), {ok: true});
  assert.equal(h.row().key_ciphertext, null);
  assert.equal((await h.settings.loadAssistantProviderConfig()).apiKey, 'fallback-key');
});

test('saving a different URL requires its own key while model changes preserve the existing key', async () => {
  const h = harness();
  assert.deepEqual(await h.actions.saveAssistantSettingsAction({...input, apiKey: ''}), {ok: false, error: 'keyRequired'});
  await h.actions.saveAssistantSettingsAction(input);
  assert.deepEqual(await h.actions.saveAssistantSettingsAction({...input, model: 'other/model', apiKey: ''}), {ok: true});
  assert.equal((await h.settings.loadAssistantProviderConfig()).apiKey, input.apiKey);
  assert.deepEqual(await h.actions.saveAssistantSettingsAction({...input, baseUrl: 'https://other.example/v1', apiKey: ''}), {ok: false, error: 'keyRequired'});
  assert.equal(h.row().model, 'other/model');
});

test('members, inactive administrators and signed-out users cannot read, change or test setup', async () => {
  for (const member of [null, {role: 'member', is_active: true}, {role: 'admin', is_active: false}]) {
    const h = harness(member);
    assert.equal(await h.actions.getAssistantSettingsAction(), null);
    for (const operation of [() => h.actions.saveAssistantSettingsAction(input), h.actions.clearAssistantSettingsAction, h.actions.testAssistantSettingsAction]) {
      assert.deepEqual(await operation(), {ok: false, error: 'forbidden'});
    }
    assert.equal(h.calls.length, 0);
  }
});

test('invalid URLs and inputs cannot reach the settings database', async () => {
  const h = harness();
  for (const baseUrl of ['http://provider.example/v1', 'https://localhost/v1', 'https://127.0.0.1/v1',
    'https://[::1]/v1', 'https://metadata.internal/v1', 'https://user:pass@provider.example/v1',
    'https://provider.example/v1?key=secret', 'https://provider.example/v1/chat/completions']) {
    assert.deepEqual(await h.actions.saveAssistantSettingsAction({...input, baseUrl}), {ok: false, error: 'invalid'});
  }
  assert.deepEqual(await h.actions.saveAssistantSettingsAction({...input, apiKey: 'key\r\ninjected'}), {ok: false, error: 'invalid'});
  assert.equal(h.calls.length, 0);
});

test('encryption uses fresh IVs and refuses tampering or a different encryption key', () => {
  const h = harness();
  const ciphertext = h.settings.encryptAssistantKey('secret');
  assert.notEqual(ciphertext, h.settings.encryptAssistantKey('secret'));
  const parts = ciphertext.split('.');
  parts[2] = Buffer.from('tampered').toString('base64');
  assert.throws(() => h.settings.decryptAssistantKey(parts.join('.')));
  const previous = process.env.ASSISTANT_SETTINGS_ENCRYPTION_KEY;
  process.env.ASSISTANT_SETTINGS_ENCRYPTION_KEY = 'cd'.repeat(32);
  try {assert.throws(() => h.settings.decryptAssistantKey(ciphertext));}
  finally {process.env.ASSISTANT_SETTINGS_ENCRYPTION_KEY = previous;}
});

test('database failures are sanitized and cannot silently switch to a different provider', async () => {
  const h = harness();
  h.fail();
  assert.deepEqual(await h.actions.saveAssistantSettingsAction(input), {ok: false, error: 'unavailable'});
  assert.equal((await h.actions.getAssistantSettingsAction()).available, false);
  await assert.rejects(h.settings.loadAssistantProviderConfig(), /notConfigured/);
});

test('connection test sends the saved tool contract but no platform data and sanitizes errors', async () => {
  const h = harness();
  await h.actions.saveAssistantSettingsAction(input);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url, options, body: JSON.parse(options.body)});
    return Response.json({choices: [{message: {content: 'OK'}}]});
  };
  try {
    assert.deepEqual(await h.actions.testAssistantSettingsAction(), {ok: true});
    assert.equal(requests[0].url, 'https://provider.example/api/v1/chat/completions');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer provider-secret');
    assert.deepEqual(requests[0].body.messages, [{role: 'user', content: 'Reply with OK.'}]);
    assert.ok(requests[0].body.tools.length > 0);
    assert.equal(requests[0].options.redirect, 'error');
    globalThis.fetch = async () => Response.json({error: 'private provider details'}, {status: 401});
    assert.deepEqual(await h.actions.testAssistantSettingsAction(), {ok: false, error: 'testFailed'});
  } finally {globalThis.fetch = originalFetch;}
});
