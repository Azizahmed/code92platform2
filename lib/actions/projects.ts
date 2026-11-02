'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {CODE_OWNERSHIPS, PROJECT_PHASES} from '@/lib/projects';

export type ProjectActionResult =
  | {ok: true; id?: string}
  | {ok: false; error: string; detail?: string};

const uuid = z.string().uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateProject(projectId?: string) {
  revalidatePath('/[locale]/projects', 'page');
  if (projectId) revalidatePath(`/[locale]/projects/${projectId}`, 'page');
  revalidatePath('/[locale]', 'page');
  revalidatePath('/[locale]/sales', 'page');
}

function mapProjectError(error: unknown): {error: string} {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as {message: unknown}).message)
      : String(error ?? '');

  if (message.includes('outcome note is required')) return {error: 'outcomeRequired'};
  if (message.includes('already in phase')) return {error: 'alreadyInPhase'};
  if (message.includes('project not found')) return {error: 'notFound'};
  if (message.includes('row-level security')) return {error: 'forbidden'};
  if (message.includes('projects_dates_in_order')) return {error: 'datesOrder'};
  if (message.includes('projects_closed_complete')) return {error: 'outcomeRequired'};
  if (message.includes('name of up to 200')) return {error: 'nameRequired'};
  if (message.includes('problem statement is required')) return {error: 'problemRequired'};
  if (message.includes('duplicate key')) return {error: 'duplicate'};
  return {error: 'generic'};
}

const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ownerId: uuid,
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  targetEndDate: dateSchema,
  ownership: z.enum(CODE_OWNERSHIPS).nullable(),
  notes: z.string().trim().max(5000).nullable()
});

export type ProjectInput = z.input<typeof projectSchema>;

export async function createProjectAction(input: {
  accountId: string;
  project: ProjectInput;
}): Promise<ProjectActionResult> {
  const parsed = projectSchema.safeParse(input.project);
  if (!uuid.safeParse(input.accountId).success || !parsed.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('projects')
    .insert([
      {
        account_id: input.accountId,
        name: parsed.data.name,
        owner_id: parsed.data.ownerId,
        start_date: parsed.data.startDate,
        target_end_date: parsed.data.targetEndDate,
        ownership: parsed.data.ownership,
        notes: parsed.data.notes || null,
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, ...mapProjectError(error)};
  revalidateProject();
  revalidatePath(`/[locale]/sales/accounts/${input.accountId}`, 'page');
  return {ok: true, id: data.id as string};
}

export async function updateProjectAction(
  projectId: string,
  input: ProjectInput
): Promise<ProjectActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!uuid.safeParse(projectId).success || !parsed.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('projects')
    .update({
      name: parsed.data.name,
      owner_id: parsed.data.ownerId,
      start_date: parsed.data.startDate,
      target_end_date: parsed.data.targetEndDate,
      ownership: parsed.data.ownership,
      notes: parsed.data.notes || null
    })
    .eq('id', projectId)
    .select('id');

  if (error) return {ok: false, ...mapProjectError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};
  revalidateProject(projectId);
  return {ok: true, id: projectId};
}

export async function moveProjectPhaseAction(input: {
  projectId: string;
  toPhase: string;
  note?: string | null;
}): Promise<ProjectActionResult> {
  const phase = z.enum(PROJECT_PHASES).safeParse(input.toPhase);
  if (!uuid.safeParse(input.projectId).success || !phase.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('move_project_phase', {
    p_project_id: input.projectId,
    p_to_phase: phase.data,
    p_note: input.note?.trim() || null
  });

  if (error) return {ok: false, ...mapProjectError(error)};
  revalidateProject(input.projectId);
  return {ok: true, id: input.projectId};
}

export async function addProjectNoteAction(
  projectId: string,
  body: string
): Promise<ProjectActionResult> {
  const text = body.trim();
  if (!uuid.safeParse(projectId).success || text.length < 1 || text.length > 5000) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database
    .from('project_activities')
    .insert([
      {project_id: projectId, actor_id: caller.user.id, kind: 'note', body: text}
    ]);

  if (error) return {ok: false, ...mapProjectError(error)};
  revalidatePath(`/[locale]/projects/${projectId}`, 'page');
  return {ok: true, id: projectId};
}

export async function captureProjectIdeaAction(input: {
  projectId: string;
  name: string;
  problem: string;
}): Promise<ProjectActionResult> {
  if (
    !uuid.safeParse(input.projectId).success ||
    input.name.trim().length === 0 ||
    input.problem.trim().length === 0
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('capture_project_idea', {
    p_project_id: input.projectId,
    p_name: input.name.trim(),
    p_problem: input.problem.trim()
  });

  if (error) return {ok: false, ...mapProjectError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as {id?: string} | undefined;
  revalidateProject(input.projectId);
  revalidatePath('/[locale]/products', 'page');
  return {ok: true, id: row?.id};
}

export async function linkProjectKnowledgeAction(
  projectId: string,
  itemId: string,
  linked: boolean
): Promise<ProjectActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(itemId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const query = insforge.database.from('knowledge_item_projects');
  const {error} = linked
    ? await query.insert([{item_id: itemId, project_id: projectId}])
    : await query.delete().eq('item_id', itemId).eq('project_id', projectId);

  if (error) return {ok: false, ...mapProjectError(error)};
  revalidateProject(projectId);
  return {ok: true, id: projectId};
}

export async function setProjectWatchingAction(
  projectId: string,
  watching: boolean
): Promise<ProjectActionResult> {
  if (!uuid.safeParse(projectId).success || typeof watching !== 'boolean') {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const query = insforge.database.from('project_watchers');
  const {error} = watching
    ? await query.insert([{project_id: projectId, user_id: caller.user.id}])
    : await query.delete().eq('project_id', projectId).eq('user_id', caller.user.id);

  if (error) return {ok: false, ...mapProjectError(error)};
  revalidateProject(projectId);
  return {ok: true, id: projectId};
}

export async function setProjectMemberAction(
  projectId: string,
  userId: string,
  member: boolean
): Promise<ProjectActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(userId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const query = insforge.database.from('project_members');
  const {error} = member
    ? await query.insert([
        {project_id: projectId, user_id: userId, added_by: caller.user.id}
      ])
    : await query.delete().eq('project_id', projectId).eq('user_id', userId);

  if (error) return {ok: false, ...mapProjectError(error)};
  revalidateProject(projectId);
  return {ok: true, id: projectId};
}
