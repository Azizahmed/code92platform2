import {z} from 'zod';
import {isIP} from 'node:net';

// Setup accepts public HTTPS providers. The administrator supplies the key
// for that provider; changing its URL also requires a new key.
export function isProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && host.includes('.') &&
      !isIP(host.replace(/^\[|\]$/g, '')) &&
      !['localhost', 'local', 'internal'].some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) &&
      !url.pathname.replace(/\/+$/, '').endsWith('/chat/completions');
  } catch {return false;}
}

export const assistantSettingsSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048).refine(isProviderBaseUrl)
    .transform((value) => value.replace(/\/+$/, '')),
  model: z.string().trim().min(1).max(200).regex(/^[^\s\x00-\x1f]+$/),
  apiKey: z.string().trim().max(4096).refine((value) => !/[\r\n]/.test(value)).optional()
}).strict();

export type AssistantSettingsInput = z.input<typeof assistantSettingsSchema>;
export type AssistantSettingsStatus = {
  available: boolean;
  source: 'admin' | 'environment' | 'none';
  baseUrl: string;
  model: string;
  hasKey: boolean;
};
export type AssistantSettingsResult = {ok: true} | {
  ok: false;
  error: 'forbidden' | 'invalid' | 'keyRequired' | 'unavailable' | 'conflict' | 'testFailed';
};
