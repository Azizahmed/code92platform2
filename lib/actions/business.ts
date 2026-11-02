'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {
  BUSINESS_STAGES,
  CHECKLIST_DEFAULTS,
  ORIGINATIONS,
  OWNERSHIPS
} from '@/lib/business-track';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type BusinessActionResult =
  | {ok: true; id?: string}
  | {ok: false; error: string; detail?: string};

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const stageSchema = z.enum(BUSINESS_STAGES);

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateProduct(productId: string) {
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/products', 'page');
  revalidatePath('/[locale]', 'page');
  revalidatePath('/[locale]/governance', 'page');
}

// The business RPCs raise with a readable reason. Map the ones a person can act
// on to keys; anything else is the generic failure.
function mapBusinessError(error: unknown): {error: string; detail?: string} {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as {message: unknown}).message)
      : String(error ?? '');

  if (message.includes('only the product owner, its business owner'))
    return {error: 'forbidden'};
  if (message.includes('only founders')) return {error: 'notFounder'};
  if (message.includes('operator required')) return {error: 'operatorRequired'};
  if (message.includes('Gate 1 needs a go decision')) return {error: 'gate1Required'};
  if (message.includes('Gate 2 needs a PMF go decision')) return {error: 'gate2Required'};
  if (message.includes('PMF criteria and evidence are required'))
    return {error: 'pmfRequired'};
  if (message.includes('is decided while a product is in'))
    return {error: 'wrongStageForGate'};
  if (message.includes('a note is required for a gate decision'))
    return {error: 'noteRequired'};
  if (message.includes('move one stage at a time'))
    return {error: 'oneStepAtATime', detail: message};
  if (message.includes('reason required')) return {error: 'reasonRequired'};
  if (message.includes('already in stage')) return {error: 'alreadyInStage'};
  if (message.includes('archived')) return {error: 'archived'};
  if (message.includes('products_co_owned_needs_equity'))
    return {error: 'equityRequired'};
  if (message.includes('products_equity_needs_co_owned'))
    return {error: 'equityNeedsCoOwned'};
  if (message.includes('reason too long')) return {error: 'tooLong'};
  if (message.includes('duplicate key')) return {error: 'duplicate'};
  return {error: 'generic'};
}

// ---------- Stages and gates ----------

export async function moveBusinessStageAction(input: {
  productId: string;
  toStage: string;
  reason?: string | null;
}): Promise<BusinessActionResult> {
  const stage = stageSchema.safeParse(input.toStage);
  if (!uuid.safeParse(input.productId).success || !stage.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('move_business_stage', {
    p_product_id: input.productId,
    p_to_stage: stage.data,
    p_reason: input.reason?.trim() || null
  });

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidateProduct(input.productId);
  return {ok: true};
}

export async function recordGateDecisionAction(input: {
  productId: string;
  gate: 1 | 2;
  decision: 'go' | 'no_go';
  note: string;
  pmfCriteria?: string | null;
  evidence?: string | null;
}): Promise<BusinessActionResult> {
  if (
    !uuid.safeParse(input.productId).success ||
    ![1, 2].includes(input.gate) ||
    !['go', 'no_go'].includes(input.decision) ||
    input.note.trim().length === 0 ||
    input.note.length > 2000
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('record_gate_decision', {
    p_product_id: input.productId,
    p_gate: input.gate,
    p_decision: input.decision,
    p_note: input.note.trim(),
    p_pmf_criteria: input.pmfCriteria?.trim() || null,
    p_evidence: input.evidence?.trim() || null
  });

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidateProduct(input.productId);
  return {ok: true};
}

// ---------- Business details ----------

const businessDetailsSchema = z.object({
  origination: z.enum(ORIGINATIONS).nullable(),
  ownership: z.enum(OWNERSHIPS).nullable(),
  code92EquityPct: z.number().min(0).max(100).nullable(),
  operatorName: z.string().trim().max(200).nullable(),
  operatorUserId: nullableUuid,
  operatorContactId: nullableUuid,
  businessOwnerId: nullableUuid,
  sector: z.string().trim().max(100).nullable()
});

export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;

export async function updateProductBusinessAction(
  productId: string,
  input: BusinessDetailsInput
): Promise<BusinessActionResult> {
  const parsed = businessDetailsSchema.safeParse(input);
  if (!uuid.safeParse(productId).success || !parsed.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const d = parsed.data;
  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('update_product_business', {
    p_product_id: productId,
    p_origination: d.origination,
    p_ownership: d.ownership,
    p_code92_equity_pct: d.ownership === 'co_owned' ? d.code92EquityPct : null,
    p_operator_name: d.operatorName || null,
    p_operator_user_id: d.operatorUserId,
    p_operator_contact_id: d.operatorContactId,
    p_business_owner_id: d.businessOwnerId,
    p_sector: d.sector || null
  });

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidateProduct(productId);
  return {ok: true};
}

// ---------- Checklists ----------

export async function addChecklistItemAction(input: {
  productId: string;
  stage: string;
  label: string;
}): Promise<BusinessActionResult> {
  const stage = stageSchema.safeParse(input.stage);
  const label = input.label.trim();
  if (
    !uuid.safeParse(input.productId).success ||
    !stage.success ||
    label.length < 1 ||
    label.length > 200
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: last} = await insforge.database
    .from('product_stage_checklist_items')
    .select('position')
    .eq('product_id', input.productId)
    .eq('stage', stage.data)
    .order('position', {ascending: false})
    .limit(1)
    .maybeSingle();

  const {data, error} = await insforge.database
    .from('product_stage_checklist_items')
    .insert([
      {
        product_id: input.productId,
        stage: stage.data,
        label,
        position: ((last?.position as number | undefined) ?? -1) + 1
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, ...mapBusinessError(error)};
  revalidateProduct(input.productId);
  return {ok: true, id: data.id as string};
}

export async function setChecklistItemDoneAction(
  itemId: string,
  done: boolean
): Promise<BusinessActionResult> {
  if (!uuid.safeParse(itemId).success || typeof done !== 'boolean') {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_stage_checklist_items')
    .update({done})
    .eq('id', itemId)
    .select('product_id');

  if (error) return {ok: false, ...mapBusinessError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};
  revalidateProduct(data[0].product_id as string);
  return {ok: true, id: itemId};
}

export async function deleteChecklistItemAction(
  itemId: string
): Promise<BusinessActionResult> {
  if (!uuid.safeParse(itemId).success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_stage_checklist_items')
    .delete()
    .eq('id', itemId)
    .select('product_id');

  if (error) return {ok: false, ...mapBusinessError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};
  revalidateProduct(data[0].product_id as string);
  return {ok: true};
}

// Used by the Business tab when a product has no checklist yet (a product
// created before the seed existed). Writes the defaults for every stage.
export async function seedChecklistDefaultsAction(
  productId: string
): Promise<BusinessActionResult> {
  if (!uuid.safeParse(productId).success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const rows = BUSINESS_STAGES.flatMap((stage) =>
    CHECKLIST_DEFAULTS[stage].map((item, position) => ({
      product_id: productId,
      stage,
      label: item.label,
      default_key: item.key,
      position
    }))
  );
  const {error} = await insforge.database
    .from('product_stage_checklist_items')
    .insert(rows);

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidateProduct(productId);
  return {ok: true};
}

// ---------- Watching ----------

export async function setProductWatchingAction(
  productId: string,
  watching: boolean
): Promise<BusinessActionResult> {
  if (!uuid.safeParse(productId).success || typeof watching !== 'boolean') {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const query = insforge.database.from('product_watchers');
  const { error } = watching
    ? await query.insert([{product_id: productId, user_id: caller.user.id}])
    : await query
        .delete()
        .eq('product_id', productId)
        .eq('user_id', caller.user.id);

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  return {ok: true};
}

// ---------- Founders (admin) ----------

export async function setFounderAction(
  userId: string,
  founder: boolean
): Promise<BusinessActionResult> {
  if (!uuid.safeParse(userId).success || typeof founder !== 'boolean') {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};
  if (caller.member.role !== 'admin') return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('admin_set_founder', {
    target: userId,
    new_founder: founder
  });

  if (error) return {ok: false, ...mapBusinessError(error)};
  revalidatePath('/[locale]/admin', 'page');
  revalidatePath('/[locale]/governance', 'page');
  return {ok: true};
}

// ---------- Knowledge links: track and release ----------

export async function setKnowledgeProductLinkAction(input: {
  itemId: string;
  productId: string;
  track: 'business' | 'development' | null;
  releaseId: string | null;
}): Promise<BusinessActionResult> {
  if (
    !uuid.safeParse(input.itemId).success ||
    !uuid.safeParse(input.productId).success ||
    (input.releaseId !== null && !uuid.safeParse(input.releaseId).success)
  ) {
    return {ok: false, error: 'invalid'};
  }
  // A release link is development material by definition.
  const track = input.releaseId ? 'development' : input.track;

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('knowledge_item_products')
    .update({track, release_id: input.releaseId})
    .eq('item_id', input.itemId)
    .eq('product_id', input.productId)
    .select('item_id');

  if (error) return {ok: false, ...mapBusinessError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};
  revalidateProduct(input.productId);
  return {ok: true, id: input.itemId};
}
