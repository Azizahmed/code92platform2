import 'server-only';

import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {createAdminClient} from '@insforge/sdk';

import {AssistantError, readProviderConfig, type ProviderConfig} from './runtime';
import type {AssistantSettingsStatus} from './settings-schema';

export type StoredAssistantSettings = {
  id: boolean;
  base_url: string | null;
  model: string | null;
  key_ciphertext: string | null;
  updated_at: string;
};

// This privileged client is restricted to the settings singleton. Platform
// reads and actions continue using the member's own client and RLS.
export function createAssistantSettingsClient() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!baseUrl || !apiKey) throw new AssistantError('notConfigured');
  return createAdminClient({baseUrl, apiKey});
}

function encryptionKey(): Buffer {
  const key = process.env.ASSISTANT_SETTINGS_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw new AssistantError('notConfigured');
  return Buffer.from(key, 'hex');
}

export function settingsStorageAvailable(): boolean {
  try {encryptionKey(); return Boolean(process.env.INSFORGE_API_KEY && process.env.NEXT_PUBLIC_INSFORGE_URL);}
  catch {return false;}
}

export function encryptAssistantKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('code92-assistant-settings-v1'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decryptAssistantKey(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new AssistantError('notConfigured');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from('code92-assistant-settings-v1'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export async function readStoredAssistantSettings(): Promise<StoredAssistantSettings> {
  const {data, error} = await createAssistantSettingsClient().database
    .from('assistant_settings').select('id, base_url, model, key_ciphertext, updated_at').eq('id', true).single();
  if (error || !data) throw new AssistantError('notConfigured');
  return data as StoredAssistantSettings;
}

export function environmentSettingsStatus(): AssistantSettingsStatus {
  try {
    const config = readProviderConfig(process.env);
    return {available: settingsStorageAvailable(), source: 'environment',
      baseUrl: config.endpoint.slice(0, -'/chat/completions'.length), model: config.model, hasKey: true};
  } catch {
    return {available: settingsStorageAvailable(), source: 'none', baseUrl: '', model: '', hasKey: false};
  }
}

// Called only after the chat route authenticates an active member. No key is
// returned by an action or sent as props to a browser component.
export async function loadAssistantProviderConfig(): Promise<ProviderConfig> {
  if (settingsStorageAvailable()) {
    const row = await readStoredAssistantSettings();
    if (row.key_ciphertext) {
      try {
        return readProviderConfig({ASSISTANT_BASE_URL: row.base_url ?? undefined,
          ASSISTANT_MODEL: row.model ?? undefined, ASSISTANT_API_KEY: decryptAssistantKey(row.key_ciphertext)});
      } catch {throw new AssistantError('notConfigured');}
    }
  }
  return readProviderConfig(process.env);
}
