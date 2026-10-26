import 'server-only';

import {revalidatePath} from 'next/cache';
import {headers} from 'next/headers';

// Every page a sales or My work mutation can change, as page-type route
// patterns, plus the concrete page the user is on.
//
// The concrete path matters: revalidating only a dynamic pattern
// ('/[locale]/sales/deals/[id]') left the action response intermittently
// without the fresh render of the page in front of the user, while existing
// actions that revalidate a concrete path (`/[locale]/products/${id}`) were
// reliable. Server action POSTs carry the page URL as Referer, so the exact
// path is known without threading record ids through every action.
const SALES_PAGES = [
  '/[locale]/sales',
  '/[locale]/sales/accounts',
  '/[locale]/sales/accounts/[id]',
  '/[locale]/sales/deals/[id]',
  '/[locale]/my-work'
];

export async function revalidateSalesPages() {
  for (const path of SALES_PAGES) revalidatePath(path, 'page');

  const referer = (await headers()).get('referer');
  if (!referer) return;
  try {
    const {pathname} = new URL(referer);
    if (/^\/(en|ar)\/(sales|my-work)(\/|$)/.test(pathname)) revalidatePath(pathname);
  } catch {
    // A malformed Referer only costs the extra precision.
  }
}
