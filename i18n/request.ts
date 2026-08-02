import {hasLocale} from 'next-intl';
import {getRequestConfig} from 'next-intl/server';

import {routing} from './routing';

// Message files are split by namespace (messages/<locale>/<namespace>.json)
// so parallel workstreams can add files without merge conflicts.
// To add a namespace: create <namespace>.json for BOTH locales and append
// the namespace name here.
const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'products',
  'tasks',
  'trends',
  'knowledge',
  'lifecycle',
  'github',
  'releases',
  'notifications',
  'settings',
  'admin'
] as const;

type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(target: Messages, source: Messages): Messages {
  const out: Messages = {...target};
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMerge(existing, value)
        : value;
  }
  return out;
}

export default getRequestConfig(async ({requestLocale}) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  let messages: Messages = {};
  for (const namespace of NAMESPACES) {
    const nsMessages = (await import(`../messages/${locale}/${namespace}.json`))
      .default as Messages;
    messages = deepMerge(messages, {[namespace]: nsMessages});
  }

  return {locale, messages};
});
