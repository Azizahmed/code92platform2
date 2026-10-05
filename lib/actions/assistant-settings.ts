'use server';

import {revalidatePath} from 'next/cache';
import {getOwnMembership} from '@/lib/auth';
import {assistantTools} from '@/lib/assistant/schemas';
import {assistantSettingsSchema, type AssistantSettingsInput,
  type AssistantSettingsResult, type AssistantSettingsStatus} from '@/lib/assistant/settings-schema';
import {createAssistantSettingsClient, decryptAssistantKey, encryptAssistantKey,
  environmentSettingsStatus, loadAssistantProviderConfig, readStoredAssistantSettings,
  settingsStorageAvailable} from '@/lib/assistant/settings';

async function isAdmin() {
  const member = await getOwnMembership();
  return member?.role === 'admin' && member.is_active;
}

export async function getAssistantSettingsAction(): Promise<AssistantSettingsStatus | null> {
  if (!(await isAdmin())) return null;
  const fallback = environmentSettingsStatus();
  if (!fallback.available) return fallback;
  try {
    const row = await readStoredAssistantSettings();
    return row.key_ciphertext ? {available: true, source: 'admin', baseUrl: row.base_url ?? '',
      model: row.model ?? '', hasKey: true} : fallback;
  } catch {return {...fallback, available: false};}
}

export async function saveAssistantSettingsAction(input: AssistantSettingsInput): Promise<AssistantSettingsResult> {
  if (!(await isAdmin())) return {ok: false, error: 'forbidden'};
  const parsed = assistantSettingsSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  if (!settingsStorageAvailable()) return {ok: false, error: 'unavailable'};
  try {
    const row = await readStoredAssistantSettings();
    let apiKey = parsed.data.apiKey;
    if (!apiKey) {
      // Never silently send a saved key to a different provider.
      if (!row.key_ciphertext || row.base_url !== parsed.data.baseUrl) return {ok: false, error: 'keyRequired'};
      apiKey = decryptAssistantKey(row.key_ciphertext);
    }
    const {data, error} = await createAssistantSettingsClient().database.from('assistant_settings')
      .update({base_url: parsed.data.baseUrl, model: parsed.data.model, key_ciphertext: encryptAssistantKey(apiKey)})
      .eq('id', true).eq('updated_at', row.updated_at).select('id');
    if (error) return {ok: false, error: 'unavailable'};
    if (!data?.length) return {ok: false, error: 'conflict'};
    revalidatePath('/[locale]/settings', 'page');
    return {ok: true};
  } catch {return {ok: false, error: 'unavailable'};}
}

export async function clearAssistantSettingsAction(): Promise<AssistantSettingsResult> {
  if (!(await isAdmin())) return {ok: false, error: 'forbidden'};
  if (!settingsStorageAvailable()) return {ok: false, error: 'unavailable'};
  try {
    const {data, error} = await createAssistantSettingsClient().database.from('assistant_settings')
      .update({base_url: null, model: null, key_ciphertext: null}).eq('id', true).select('id');
    if (error || !data?.length) return {ok: false, error: 'unavailable'};
    revalidatePath('/[locale]/settings', 'page');
    return {ok: true};
  } catch {return {ok: false, error: 'unavailable'};}
}

export async function testAssistantSettingsAction(): Promise<AssistantSettingsResult> {
  if (!(await isAdmin())) return {ok: false, error: 'forbidden'};
  try {
    const config = await loadAssistantProviderConfig();
    // Exercise the same tool-calling request contract without executing any
    // platform action or sending workspace data during a connection test.
    const response = await fetch(config.endpoint, {method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`},
      body: JSON.stringify({model: config.model, messages: [{role: 'user', content: 'Reply with OK.'}],
        tools: assistantTools, tool_choice: 'auto', max_tokens: 64, stream: false})});
    if (!response.ok) return {ok: false, error: 'testFailed'};
    const body = await response.json();
    if (typeof body?.choices?.[0]?.message?.content !== 'string' || !body.choices[0].message.content.trim()) {
      return {ok: false, error: 'testFailed'};
    }
    return {ok: true};
  } catch {return {ok: false, error: 'testFailed'};}
}
