'use server';

import {getLocale} from 'next-intl/server';
import {z} from 'zod';

import {redirect} from '@/i18n/navigation';
import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {drainEmailsAfterResponse} from '@/lib/email-drain';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {revalidateSalesPages} from '@/lib/revalidate';
import {
  DEAL_SOURCES,
  DEAL_STAGES,
  OPEN_STAGES,
  OWNERSHIP_OPTIONS,
  type DealStage,
  type Ownership
} from '@/lib/sales/stages';

export type SalesActionResult =
  | {ok: true; id: string}
  | {ok: false; error: string};

const uuid = z.string().uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const revalidateSales = revalidateSalesPages;

// Form saves land on the record from inside the action. A client router.push()
// after the action resolves races the action's own revalidation commit (the
// promise resolves before that commit lands) and the new page sometimes never
// shows; redirecting here also brings the record page back in the same response.
async function redirectToRecord(href: string): Promise<never> {
  return redirect({href, locale: await getLocale()});
}

// Maps database errors raised by triggers / move_deal_stage to UI keys.
function mapDbError(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('reason required')) return 'reasonRequired';
  if (m.includes('ownership required')) return 'ownershipRequired';
  if (m.includes('already in stage')) return 'sameStage';
  if (m.includes('forbidden') || m.includes('permission denied')) return 'forbidden';
  if (m.includes('owner or an admin')) return 'archiveForbidden';
  if (m.includes('requires_product')) return 'productRequired';
  if (m.includes('belong to the deal')) return 'contactAccount';
  return 'generic';
}

async function requireCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  const caller = {user, member};
  return {caller, insforge: await createInsForgeServerClient()};
}

// ============================================================
// Accounts
// ============================================================

const accountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sector: optionalText(100),
  city: optionalText(100),
  ownerId: uuid,
  notes: optionalText(5000)
});

export type AccountInput = z.input<typeof accountSchema>;

export async function createAccountAction(input: AccountInput): Promise<SalesActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('accounts')
    .insert([
      {
        name: parsed.data.name,
        sector: parsed.data.sector,
        city: parsed.data.city,
        owner_id: parsed.data.ownerId,
        notes: parsed.data.notes,
        created_by: ctx.caller.user.id
      }
    ])
    .select('id')
    .single();
  if (error || !data) return {ok: false, error: mapDbError(error?.message)};

  await revalidateSales();
  drainEmailsAfterResponse();
  return redirectToRecord(`/sales/accounts/${data.id as string}`);
}

export async function updateAccountAction(
  accountId: string,
  input: AccountInput
): Promise<SalesActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!uuid.safeParse(accountId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('accounts')
    .update({
      name: parsed.data.name,
      sector: parsed.data.sector,
      city: parsed.data.city,
      owner_id: parsed.data.ownerId,
      notes: parsed.data.notes
    })
    .eq('id', accountId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  drainEmailsAfterResponse();
  return redirectToRecord(`/sales/accounts/${accountId}`);
}

export async function setAccountArchivedAction(
  accountId: string,
  archived: boolean
): Promise<SalesActionResult> {
  if (!uuid.safeParse(accountId).success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('accounts')
    .update({archived_at: archived ? new Date().toISOString() : null})
    .eq('id', accountId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  if (archived) drainEmailsAfterResponse();
  return {ok: true, id: accountId};
}

// ============================================================
// Contacts
// ============================================================

const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  title: optionalText(200),
  email: z
    .string()
    .trim()
    .max(320)
    .nullable()
    .transform((value) => (value ? value : null))
    .pipe(z.string().email().nullable()),
  phone: optionalText(50),
  notes: optionalText(5000),
  isPrimary: z.boolean()
});

export type ContactInput = z.input<typeof contactSchema>;

export async function createContactAction(
  accountId: string,
  input: ContactInput
): Promise<SalesActionResult> {
  const parsed = contactSchema.safeParse(input);
  if (!uuid.safeParse(accountId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('contacts')
    .insert([
      {
        account_id: accountId,
        name: parsed.data.name,
        title: parsed.data.title,
        email: parsed.data.email,
        phone: parsed.data.phone,
        notes: parsed.data.notes,
        is_primary: parsed.data.isPrimary,
        created_by: ctx.caller.user.id
      }
    ])
    .select('id')
    .single();
  if (error || !data) return {ok: false, error: mapDbError(error?.message)};

  await revalidateSales();
  return {ok: true, id: data.id as string};
}

export async function updateContactAction(
  contactId: string,
  input: ContactInput
): Promise<SalesActionResult> {
  const parsed = contactSchema.safeParse(input);
  if (!uuid.safeParse(contactId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('contacts')
    .update({
      name: parsed.data.name,
      title: parsed.data.title,
      email: parsed.data.email,
      phone: parsed.data.phone,
      notes: parsed.data.notes,
      is_primary: parsed.data.isPrimary
    })
    .eq('id', contactId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  return {ok: true, id: contactId};
}

export async function deleteContactAction(contactId: string): Promise<SalesActionResult> {
  if (!uuid.safeParse(contactId).success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {error} = await ctx.insforge.database.from('contacts').delete().eq('id', contactId);
  if (error) return {ok: false, error: mapDbError(error.message)};

  await revalidateSales();
  return {ok: true, id: contactId};
}

// ============================================================
// Deals
// ============================================================

const dealSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['product', 'consultation']),
    productId: uuid.nullable(),
    ownerId: uuid,
    valueAmount: z.number().min(0).max(99_999_999_999).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    expectedClose: isoDate,
    nextAction: optionalText(500),
    nextActionDate: isoDate,
    source: z.enum(DEAL_SOURCES).nullable()
  })
  .refine((value) => value.type !== 'product' || value.productId !== null, {
    path: ['productId']
  });

export type DealInput = z.input<typeof dealSchema>;

function dealColumns(data: z.output<typeof dealSchema>) {
  return {
    name: data.name,
    type: data.type,
    product_id: data.productId,
    owner_id: data.ownerId,
    value_amount: data.valueAmount,
    currency: data.currency,
    expected_close: data.expectedClose,
    next_action: data.nextAction,
    next_action_date: data.nextActionDate,
    source: data.source
  };
}

export async function createDealAction(input: {
  accountId: string;
  stage: DealStage;
  contactIds: string[];
  deal: DealInput;
}): Promise<SalesActionResult> {
  const parsed = dealSchema.safeParse(input.deal);
  if (
    !parsed.success ||
    !uuid.safeParse(input.accountId).success ||
    !(OPEN_STAGES as readonly string[]).includes(input.stage) ||
    !z.array(uuid).max(50).safeParse(input.contactIds).success
  ) {
    return {ok: false, error: 'invalid'};
  }
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('deals')
    .insert([
      {
        ...dealColumns(parsed.data),
        account_id: input.accountId,
        stage: input.stage,
        created_by: ctx.caller.user.id
      }
    ])
    .select('id')
    .single();
  if (error || !data) return {ok: false, error: mapDbError(error?.message)};

  const dealId = data.id as string;
  if (input.contactIds.length > 0) {
    const {error: contactError} = await ctx.insforge.database
      .from('deal_contacts')
      .insert(input.contactIds.map((contactId) => ({deal_id: dealId, contact_id: contactId})));
    if (contactError) return {ok: false, error: mapDbError(contactError.message)};
  }

  await revalidateSales();
  drainEmailsAfterResponse();
  return redirectToRecord(`/sales/deals/${dealId}`);
}

export async function updateDealAction(
  dealId: string,
  input: DealInput
): Promise<SalesActionResult> {
  const parsed = dealSchema.safeParse(input);
  if (!uuid.safeParse(dealId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('deals')
    .update(dealColumns(parsed.data))
    .eq('id', dealId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  drainEmailsAfterResponse();
  return redirectToRecord(`/sales/deals/${dealId}`);
}

// Next action only — the inline editor on the deal page and kanban.
export async function setDealNextActionAction(
  dealId: string,
  input: {nextAction: string | null; nextActionDate: string | null}
): Promise<SalesActionResult> {
  const parsed = z
    .object({nextAction: optionalText(500), nextActionDate: isoDate})
    .safeParse(input);
  if (!uuid.safeParse(dealId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('deals')
    .update({
      next_action: parsed.data.nextAction,
      next_action_date: parsed.data.nextActionDate
    })
    .eq('id', dealId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  return {ok: true, id: dealId};
}

export async function moveDealStageAction(input: {
  dealId: string;
  toStage: DealStage;
  reason: string | null;
  ownership: Ownership | null;
}): Promise<SalesActionResult> {
  const parsed = z
    .object({
      dealId: uuid,
      toStage: z.enum(DEAL_STAGES),
      reason: z.string().trim().max(1000).nullable(),
      ownership: z.enum(OWNERSHIP_OPTIONS).nullable()
    })
    .safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {error} = await ctx.insforge.database.rpc('move_deal_stage', {
    p_deal_id: parsed.data.dealId,
    p_to_stage: parsed.data.toStage,
    p_reason: parsed.data.reason || null,
    p_ownership: parsed.data.ownership
  });
  if (error) return {ok: false, error: mapDbError(error.message)};

  await revalidateSales();
  if (parsed.data.toStage === 'closed_won' || parsed.data.toStage === 'closed_lost') {
    drainEmailsAfterResponse();
  }
  return {ok: true, id: parsed.data.dealId};
}

export async function setDealContactsAction(
  dealId: string,
  contactIds: string[]
): Promise<SalesActionResult> {
  if (!uuid.safeParse(dealId).success || !z.array(uuid).max(50).safeParse(contactIds).success) {
    return {ok: false, error: 'invalid'};
  }
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data: current, error: readError} = await ctx.insforge.database
    .from('deal_contacts')
    .select('contact_id')
    .eq('deal_id', dealId);
  if (readError) return {ok: false, error: 'generic'};

  const have = new Set((current ?? []).map((row) => row.contact_id as string));
  const want = new Set(contactIds);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  const [added, removed] = await Promise.all([
    toAdd.length
      ? ctx.insforge.database
          .from('deal_contacts')
          .insert(toAdd.map((contactId) => ({deal_id: dealId, contact_id: contactId})))
      : Promise.resolve({error: null}),
    toRemove.length
      ? ctx.insforge.database
          .from('deal_contacts')
          .delete()
          .eq('deal_id', dealId)
          .in('contact_id', toRemove)
      : Promise.resolve({error: null})
  ]);
  if (added.error || removed.error) {
    return {ok: false, error: mapDbError((added.error ?? removed.error)?.message)};
  }

  await revalidateSales();
  return {ok: true, id: dealId};
}

export async function addDealNoteAction(dealId: string, body: string): Promise<SalesActionResult> {
  const parsed = z.string().trim().min(1).max(5000).safeParse(body);
  if (!uuid.safeParse(dealId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {error} = await ctx.insforge.database.from('deal_activities').insert([
    {deal_id: dealId, actor_id: ctx.caller.user.id, kind: 'note', body: parsed.data}
  ]);
  if (error) return {ok: false, error: mapDbError(error.message)};

  await revalidateSales();
  return {ok: true, id: dealId};
}

export async function updateEngagementAction(
  engagementId: string,
  input: {name: string; ownership: Ownership; notes: string | null}
): Promise<SalesActionResult> {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(200),
      ownership: z.enum(OWNERSHIP_OPTIONS),
      notes: optionalText(5000)
    })
    .safeParse(input);
  if (!uuid.safeParse(engagementId).success || !parsed.success) return {ok: false, error: 'invalid'};
  const ctx = await requireCaller();
  if (!ctx) return {ok: false, error: 'forbidden'};

  const {data, error} = await ctx.insforge.database
    .from('engagements')
    .update(parsed.data)
    .eq('id', engagementId)
    .select('id');
  if (error) return {ok: false, error: mapDbError(error.message)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  await revalidateSales();
  return {ok: true, id: engagementId};
}
