import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('direct messages are a first-class channel kind with viewer-specific labels', async () => {
  const source = await read('lib/channels.ts');

  assert.match(source, /CHANNEL_KINDS = \['standing', 'product', 'dm'\]/);
  assert.match(source, /channel\.kind === 'dm' && viewer/);
  assert.match(source, /dm_user_a/);
  assert.match(source, /dm_user_b/);
});

test('DM visibility follows the source channel across every related table', async () => {
  const migration = (
    await Promise.all([
      read('migrations/20260825098000_add-direct-messages.sql'),
      read('migrations/20260825123000_harden-direct-message-privacy.sql')
    ])
  ).join('\n');

  for (const policy of [
    'active members read channels',
    'active members read messages',
    'active members read channel membership',
    'active members read mentions',
    'active members read proposals',
    'admins read agent runs',
    'active members read agent schedules'
  ]) {
    assert.match(migration, new RegExp(`DROP POLICY "${policy}"`));
    assert.match(migration, new RegExp(`CREATE POLICY "${policy}"`));
  }

  assert.match(migration, /public\.can_read_channel\(channel_id\)/);
  assert.match(migration, /kind <> 'dm'[\s\S]*auth\.uid\(\)[\s\S]*dm_user_a/);
});

test('DM side effects cannot disclose a message to outsiders or agents', async () => {
  const migration = await read(
    'migrations/20260825123000_harden-direct-message-privacy.sql'
  );

  assert.match(migration, /CREATE TRIGGER notifications_guard_dm_recipient/);
  assert.match(migration, /NEW\.user_id IN \(c\.dm_user_a, c\.dm_user_b\)/);
  assert.match(migration, /CREATE TRIGGER message_mentions_guard_dm_recipient/);
  assert.match(migration, /NEW\.mentioned_user_id NOT IN \(c\.dm_user_a, c\.dm_user_b\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.messages_queue_agent_runs\(\)/);
  assert.match(migration, /NEW\.channel_id AND kind = 'dm'/);
  assert.match(migration, /CREATE TRIGGER agent_schedules_reject_dm/);
});

test('open_dm is the only client path to one ordered human pair', async () => {
  const migration = await read('migrations/20260825098000_add-direct-messages.sql');

  assert.match(migration, /CREATE UNIQUE INDEX channels_dm_pair_key/);
  assert.match(migration, /lo := least\(me, p_other_user\)/);
  assert.match(migration, /hi := greatest\(me, p_other_user\)/);
  assert.match(migration, /their_kind <> 'human'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.open_dm\(UUID\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.open_dm\(UUID\) TO authenticated/);
});
