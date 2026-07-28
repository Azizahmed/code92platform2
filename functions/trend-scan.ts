// trend-scan: market-intelligence trend scan pipeline.
// Invoked by an InsForge schedule (Authorization: Bearer <CRON_SECRET>) or by an
// active admin user's JWT (future "Scan now" button). Scans a batch of up to 5
// due products, asks a web-search-capable OpenRouter model for recent trend
// items, dedups by normalized URL, and links items to products.

import { createClient, createAdminClient } from 'npm:@insforge/sdk';
import { z } from 'npm:zod';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// KILL SWITCH — the trend pipeline is switched off.
//
// While this is false the function does no work at all: no database reads, no
// scan_runs row, and above all no OpenRouter call, so it costs nothing even
// though the schedule still fires. Nothing else in the file was changed, and no
// table or row was touched, so re-enabling is this constant plus a redeploy:
//
//   npx @insforge/cli functions deploy trend-scan --file functions/trend-scan.ts
//
// The InsForge schedule "trend-scan" (*/15 1 * * *) is still marked active in
// schedules.jobs; it cannot be switched off from the CLI (the table is not
// writable by this role), so it keeps making one no-op HTTP call per slot.
// Turn it off in the InsForge dashboard under Schedules to stop even that.
const PIPELINE_ENABLED = false;

const BATCH_SIZE = 5;
const RESCAN_INTERVAL_HOURS = 20;
const OPENROUTER_TIMEOUT_MS = 10000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'perplexity/sonar';

const trendItemSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  summary_ar: z.string().nullish(),
  url: z.string().min(1),
  source_name: z.string().nullish(),
  published_date: z.string().nullish(),
  relevance_score: z.number().min(0).max(1).nullish(),
  relevance_note: z.string().nullish(),
});

type TrendItem = z.infer<typeof trendItemSchema>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Normalize a URL for dedup: lowercase, strip protocol + www., drop the whole
// query string (covers utm params), strip trailing slash. Returns null when the
// URL is not parseable as http(s).
function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    try {
      u = new URL('https://' + raw.trim());
    } catch {
      return null;
    }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  return host + path;
}

function parsePublishedAt(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function isAuthorized(req: Request, admin: any, baseUrl: string): Promise<boolean> {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && token === cronSecret) return true;

  // Fall back to admin user JWT (future "Scan now" button).
  try {
    const userClient = createClient({ baseUrl, accessToken: token });
    const { data } = await userClient.auth.getCurrentUser();
    const userId = data?.user?.id;
    if (!userId) return false;
    const { data: members } = await admin.database
      .from('team_members')
      .select('role, is_active')
      .eq('user_id', userId)
      .limit(1);
    const member = members?.[0];
    return !!member && member.role === 'admin' && member.is_active === true;
  } catch {
    return false;
  }
}

function buildPrompt(product: { name: string; description: string | null; keywords: string[] }): string {
  const keywords = (product.keywords || []).join(', ') || 'none';
  return [
    `Find up to 5 significant market-intelligence trend items (news, product launches, funding, regulation, research) published in the LAST 7 DAYS relevant to this product:`,
    `Name: ${product.name}`,
    `Description: ${product.description || 'n/a'}`,
    `Keywords: ${keywords}`,
    ``,
    `Return ONLY a strict JSON array (no markdown fences, no commentary) of up to 5 objects with exactly these keys:`,
    `[{"title": string, "summary": string (1-2 sentences, English), "summary_ar": string (Arabic translation of summary), "url": string (direct article URL), "source_name": string, "published_date": string (YYYY-MM-DD), "relevance_score": number between 0 and 1, "relevance_note": string (why it matters to this product)}]`,
    `Only include items with a real, direct URL. If nothing relevant was published in the last 7 days, return [].`,
  ].join('\n');
}

async function fetchTrendsFromModel(
  product: { name: string; description: string | null; keywords: string[] },
  apiKey: string,
  model: string,
): Promise<TrendItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  let content: string;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_completion_tokens: 1500,
        messages: [
          {
            role: 'system',
            content:
              'You are a market-intelligence analyst with web search. Answer with ONLY a strict JSON array — no markdown fences, no commentary.',
          },
          { role: 'user', content: buildPrompt(product) },
        ],
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`OpenRouter HTTP ${res.status}: ${text}`);
    }
    const json = await res.json();
    content = json?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }

  // Extract the JSON array even if the model wrapped it in fences or prose.
  const cleaned = content.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    if (cleaned.trim() === '' || cleaned.includes('[]')) return [];
    throw new Error('model response did not contain a JSON array');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`model response JSON parse failed: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('model response was not an array');

  const items: TrendItem[] = [];
  for (const raw of parsed.slice(0, 5)) {
    const result = trendItemSchema.safeParse(raw);
    if (result.success) items.push(result.data);
  }
  return items;
}

// Insert a trend_items row, or reuse the existing row on url_norm conflict.
// Returns { id, inserted }.
async function upsertTrendItem(
  admin: any,
  item: TrendItem,
  urlNorm: string,
): Promise<{ id: string; inserted: boolean }> {
  const row = {
    title: item.title,
    summary: item.summary,
    summary_ar: item.summary_ar ?? null,
    url: item.url,
    url_norm: urlNorm,
    source_name: item.source_name ?? null,
    published_at: parsePublishedAt(item.published_date),
    raw: item,
  };
  const { data, error } = await admin.database.from('trend_items').insert([row]).select('id');
  if (!error && data?.[0]?.id) return { id: data[0].id, inserted: true };

  // Unique violation on url_norm (or any insert error) → look up the existing row.
  const { data: existing, error: selErr } = await admin.database
    .from('trend_items')
    .select('id')
    .eq('url_norm', urlNorm)
    .limit(1);
  if (selErr) throw new Error(`trend_items lookup failed: ${selErr.message}`);
  if (existing?.[0]?.id) return { id: existing[0].id, inserted: false };
  throw new Error(`trend_items insert failed: ${error?.message || 'unknown'}`);
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Checked before authorization, before the admin client, before any query —
  // a disabled pipeline must not read, write, or spend anything.
  if (!PIPELINE_ENABLED) {
    return jsonResponse({ status: 'disabled', message: 'trend scanning is disabled' });
  }

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL')!;
  const admin = createAdminClient({
    baseUrl,
    apiKey: Deno.env.get('API_KEY')!,
  });

  if (!(await isAuthorized(req, admin, baseUrl))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const model = Deno.env.get('OPENROUTER_TREND_MODEL') || DEFAULT_MODEL;
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');

  // Open a run row for observability.
  const { data: runRows, error: runErr } = await admin.database
    .from('scan_runs')
    .insert([{ status: 'running', details: { model, trigger: req.headers.get('x-trigger') || 'schedule' } }])
    .select('id');
  if (runErr || !runRows?.[0]?.id) {
    return jsonResponse({ error: `failed to open scan_runs row: ${runErr?.message || 'unknown'}` }, 500);
  }
  const runId: string = runRows[0].id;

  const finalize = async (
    status: 'success' | 'partial' | 'failed',
    counts: { products_scanned: number; items_inserted: number; items_linked: number },
    details: Record<string, unknown>,
  ) => {
    await admin.database
      .from('scan_runs')
      .update({
        status,
        products_scanned: counts.products_scanned,
        items_inserted: counts.items_inserted,
        items_linked: counts.items_linked,
        details,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    return jsonResponse({ run_id: runId, status, ...counts, details });
  };

  // Pick the batch: scan-enabled, not archived, due (never scanned or > 20h ago),
  // least-recently-scanned first.
  const cutoff = new Date(Date.now() - RESCAN_INTERVAL_HOURS * 3600 * 1000).toISOString();
  const { data: products, error: prodErr } = await admin.database
    .from('products')
    .select('id, name, description, keywords')
    .eq('trend_scan_enabled', true)
    .is('archived_at', null)
    .or(`last_trend_scan_at.is.null,last_trend_scan_at.lt.${cutoff}`)
    .order('last_trend_scan_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (prodErr) {
    return await finalize(
      'failed',
      { products_scanned: 0, items_inserted: 0, items_linked: 0 },
      { model, error: `product batch query failed: ${prodErr.message}`, products: [] },
    );
  }

  if (!products || products.length === 0) {
    return await finalize(
      'success',
      { products_scanned: 0, items_inserted: 0, items_linked: 0 },
      { model, message: 'no products due for scanning', products: [] },
    );
  }

  let itemsInserted = 0;
  let itemsLinked = 0;
  const perProduct: Array<Record<string, unknown>> = [];

  for (const product of products) {
    const detail: Record<string, unknown> = {
      product_id: product.id,
      name: product.name,
      items_found: 0,
      items_inserted: 0,
      items_linked: 0,
    };
    try {
      if (!openrouterKey) throw new Error('OPENROUTER_API_KEY secret is not set');

      const items = await fetchTrendsFromModel(product, openrouterKey, model);
      detail.items_found = items.length;

      for (const item of items) {
        const urlNorm = normalizeUrl(item.url);
        if (!urlNorm) continue; // drop items without a parseable URL
        const { id: trendItemId, inserted } = await upsertTrendItem(admin, item, urlNorm);
        if (inserted) {
          itemsInserted++;
          detail.items_inserted = (detail.items_inserted as number) + 1;
        }
        // Idempotent link: PK conflict on (product_id, trend_item_id) means already linked.
        const { error: linkErr } = await admin.database.from('product_trends').insert([
          {
            product_id: product.id,
            trend_item_id: trendItemId,
            relevance_score: item.relevance_score ?? null,
            relevance_note: item.relevance_note ?? null,
          },
        ]);
        if (!linkErr) {
          itemsLinked++;
          detail.items_linked = (detail.items_linked as number) + 1;
        }
      }
      detail.ok = true;
    } catch (e) {
      detail.ok = false;
      detail.error = (e as Error).message;
    } finally {
      // ALWAYS stamp the product, even on failure, so one bad product cannot
      // starve the scan queue.
      await admin.database
        .from('products')
        .update({ last_trend_scan_at: new Date().toISOString() })
        .eq('id', product.id);
    }
    perProduct.push(detail);
  }

  const succeeded = perProduct.filter((p) => p.ok).length;
  const status =
    succeeded === perProduct.length ? 'success' : succeeded === 0 ? 'failed' : 'partial';

  return await finalize(
    status,
    {
      products_scanned: products.length,
      items_inserted: itemsInserted,
      items_linked: itemsLinked,
    },
    { model, products: perProduct },
  );
}
