import 'server-only';

import {z} from 'zod';

import {setTaskWatchAction} from '@/lib/actions/notifications';
import {
  attachFilesToMessageAction, createChannelAction, deleteMessageAction, getChannelsAction,
  getChannelViewAction, openDirectMessageAction, postMessageAction
} from '@/lib/actions/channels';
import {
  createKnowledgeItemAction, createTagAction, deleteKnowledgeItemAction, setKnowledgeArchivedAction,
  signKnowledgeFileAction, updateKnowledgeItemAction
} from '@/lib/actions/knowledge';
import {
  addPhaseArtifactAction, advanceLifecyclePhaseAction, deletePhaseArtifactAction,
  setLifecyclePhaseDetailsAction, setProductRiskTierAction
} from '@/lib/actions/lifecycle';
import {addStatusUpdateAttachmentsAction, addTaskAttachmentsAction, setProductLogoAction} from '@/lib/actions/media';
import {createProductAction, setProductArchivedAction, updateProductAction} from '@/lib/actions/products';
import {
  advanceReleaseStatusAction, createReleaseAction, deleteReleaseAction, setReleaseCheckAction,
  setTaskReleaseAction, updateReleaseAction
} from '@/lib/actions/releases';
import {deleteStatusUpdateAction, postStatusUpdateAction} from '@/lib/actions/status-updates';
import {createTaskAction, deleteTaskAction, patchTaskAction} from '@/lib/actions/tasks';
import type {ToolResult} from '@/lib/assistant/protocol';
import {toolDescriptions, toolSchemas} from '@/lib/assistant/schemas';
import type {createInsForgeServerClient} from '@/lib/insforge/server';
import {KNOWLEDGE_KINDS, KNOWLEDGE_STATUSES} from '@/lib/knowledge';
import {ALL_ARTIFACT_TYPES, LIFECYCLE_PHASES, LIFECYCLE_STATES, RISK_TIERS} from '@/lib/lifecycle';
import {RELEASE_CHECK_KEYS, RELEASE_STATUSES} from '@/lib/releases';
import {
  createUploadTicket, FILE_PURPOSE_NAMES, FILE_PURPOSES, MAX_MCP_INLINE_UPLOAD_BYTES, MAX_MCP_UPLOAD_BYTES, McpFileError,
  openFile,
  storeFile, type FilePurpose
} from './files';
import type {McpPermission} from './permissions';
import type {McpCaller} from './tokens';

// Every tool an MCP client can be granted, grouped by the permission that
// unlocks it. Each is a thin adapter over an existing Server Action, so
// validation, RLS, triggers, error mapping and page revalidation are the
// ones the web app already uses; this file adds no authority of its own.
//
// Deliberately absent: membership, agents and their proposals, integrations
// (GitHub, OpenRouter, the assistant provider) and MCP tokens themselves.
// Those are workspace administration and stay in the browser.

type ServerClient = Awaited<ReturnType<typeof createInsForgeServerClient>>;

export type ToolContext = {
  insforge: ServerClient;
  caller: McpCaller;
  // Absolute app origin, for links and upload URLs.
  origin: string;
  // The workspace assistant's executor, for the read tools both share.
  assistant: (name: string, input: unknown) => Promise<ToolResult>;
};

type Tool<S extends z.ZodType = z.ZodType> = {
  permission: McpPermission;
  title: string;
  description: string;
  schema: S;
  readOnly?: boolean;
  destructive?: boolean;
  run: (args: z.infer<S>, context: ToolContext) => Promise<ToolResult>;
};

function tool<S extends z.ZodType>(definition: Tool<S>): Tool {
  return definition as unknown as Tool;
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fileId = z.string().min(1).max(8000);
const fileIds = z.array(fileId).min(1).max(8);

type ActionResult = {ok: true} | {ok: false; error: string};

function done(result: ActionResult & Record<string, unknown>, data: unknown, href?: string): ToolResult {
  return result.ok ? {ok: true, changed: true, data, href} : {ok: false, error: result.error};
}

function needsAttachments(context: ToolContext): ToolResult | null {
  return context.caller.permissions.includes('attachments') ? null
    : {ok: false, error: 'files need the attachments permission on this token'};
}

function files(ids: string[], context: ToolContext, purpose: FilePurpose) {
  return ids.map((id) => openFile(id, context.caller.userId, purpose));
}

// Storage cleanup the browser does after a delete. Best effort, like there: a
// failed removal leaves litter, not a broken record.
async function removeObjects(context: ToolContext, bucket: string, keys: (string | null | undefined)[]) {
  const present = keys.filter((key): key is string => Boolean(key));
  await Promise.allSettled(present.map((key) => context.insforge.storage.from(bucket).remove(key)));
}

async function readRow<T>(context: ToolContext, table: string, columns: string, id: string): Promise<T | null> {
  const {data, error} = await context.insforge.database.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw new Error('readFailed');
  return (data as T | null) ?? null;
}

const statusUpdateSchema = toolSchemas.post_status_update;

export const MCP_TOOLS: Record<string, Tool> = {
  // ---------------------------------------------------------------- read
  list_records: tool({
    permission: 'read', readOnly: true, title: 'List products, tasks, members or releases',
    description: toolDescriptions.list_records, schema: toolSchemas.list_records,
    run: (args, context) => context.assistant('list_records', args)
  }),
  search_knowledge: tool({
    permission: 'read', readOnly: true, title: 'Search the knowledge base',
    description: toolDescriptions.search_knowledge, schema: toolSchemas.search_knowledge,
    run: (args, context) => context.assistant('search_knowledge', args)
  }),
  read_knowledge: tool({
    permission: 'read', readOnly: true, title: 'Read a knowledge item',
    description: 'Read a knowledge item: content (long content is truncated explicitly), kind, status, URL, tags, linked products and, for an uploaded file, a short-lived download link.',
    schema: z.object({id: uuid}).strict(),
    run: async ({id}, context) => {
      const [item, tags, products] = await Promise.all([
        readRow<Record<string, unknown>>(context, 'knowledge_items',
          'id, kind, title, content, url, status, file_name, mime_type, size_bytes, archived_at, author_id, created_at, updated_at', id),
        context.insforge.database.from('knowledge_item_tags').select('tag_id').eq('item_id', id),
        context.insforge.database.from('knowledge_item_products').select('product_id').eq('item_id', id)
      ]);
      if (!item) return {ok: false, error: 'notFound'};
      const content = typeof item.content === 'string' ? item.content : '';
      const link = item.file_name ? await signKnowledgeFileAction(id) : null;
      return {ok: true, href: `/knowledge/${id}`, data: {
        ...item, content: content.slice(0, 50000), truncated: content.length > 50000,
        tagIds: (tags.data ?? []).map((row) => row.tag_id),
        productIds: (products.data ?? []).map((row) => row.product_id),
        downloadUrl: link?.ok ? link.url : null
      }};
    }
  }),
  list_tags: tool({
    permission: 'read', readOnly: true, title: 'List knowledge tags',
    description: 'List knowledge base tags (id and name), for use as tagIds.',
    schema: z.object({}).strict(),
    run: async (_args, context) => {
      const {data, error} = await context.insforge.database.from('tags').select('id, name').order('name').limit(500);
      return error ? {ok: false, error: 'readFailed'} : {ok: true, data: {rows: data ?? []}};
    }
  }),
  get_product: tool({
    permission: 'read', readOnly: true, title: 'Get a product in detail',
    description: 'Read one product: overview, lifecycle phases with their ids, states and artifacts, the 10 latest status updates and its releases.',
    schema: z.object({productId: uuid}).strict(),
    run: async ({productId}, context) => {
      const db = context.insforge.database;
      const [overview, phases, updates, releases] = await Promise.all([
        db.from('product_overview').select('*').eq('id', productId).maybeSingle(),
        db.from('product_lifecycle_phases').select('id, cycle, phase, state, owner_id, notes, entered_at, completed_at')
          .eq('product_id', productId).order('cycle', {ascending: false}),
        db.from('status_updates').select('id, health, stage, summary, details, author_id, source_type, created_at')
          .eq('product_id', productId).order('created_at', {ascending: false}).limit(10),
        db.from('release_overview').select('*').eq('product_id', productId).order('created_at', {ascending: false}).limit(20)
      ]);
      if (overview.error || phases.error || updates.error || releases.error) return {ok: false, error: 'readFailed'};
      if (!overview.data) return {ok: false, error: 'notFound'};
      const phaseIds = (phases.data ?? []).map((phase) => phase.id as string);
      const artifacts = phaseIds.length ? await db.from('phase_artifacts')
        .select('id, phase_id, artifact_type, title, file_name, url, knowledge_item_id, notes, created_at')
        .in('phase_id', phaseIds) : {data: [], error: null};
      if (artifacts.error) return {ok: false, error: 'readFailed'};
      return {ok: true, href: `/products/${productId}`, data: {
        product: overview.data,
        lifecyclePhases: (phases.data ?? []).map((phase) => ({...phase,
          artifacts: (artifacts.data ?? []).filter((artifact) => artifact.phase_id === phase.id)})),
        recentStatusUpdates: updates.data ?? [],
        releases: releases.data ?? []
      }};
    }
  }),
  get_task: tool({
    permission: 'read', readOnly: true, title: 'Get a task in detail',
    description: 'Read one task with its full notes, attachments (with links) and subtasks.',
    schema: z.object({taskId: uuid}).strict(),
    run: async ({taskId}, context) => {
      const db = context.insforge.database;
      const [task, attachments, subtasks] = await Promise.all([
        readRow<Record<string, unknown>>(context, 'product_tasks', '*', taskId),
        db.from('task_attachments').select('id, file_name, mime_type, size_bytes, storage_url, created_at').eq('task_id', taskId),
        db.from('product_tasks').select('id, title, status, due_date, assignee_id').eq('parent_task_id', taskId)
      ]);
      if (!task) return {ok: false, error: 'notFound'};
      return {ok: true, href: '/tasks', data: {task, attachments: attachments.data ?? [], subtasks: subtasks.data ?? []}};
    }
  }),
  get_release: tool({
    permission: 'read', readOnly: true, title: 'Get a release in detail',
    description: 'Read one release with its checklist and scoped tasks.',
    schema: z.object({releaseId: uuid}).strict(),
    run: async ({releaseId}, context) => {
      const db = context.insforge.database;
      const [release, checks, tasks] = await Promise.all([
        db.from('release_overview').select('*').eq('id', releaseId).maybeSingle(),
        db.from('release_checks').select('id, check_key, is_required, completed_at, completed_by, note').eq('release_id', releaseId),
        db.from('product_tasks').select('id, title, status, assignee_id, due_date').eq('release_id', releaseId)
      ]);
      if (release.error) return {ok: false, error: 'readFailed'};
      if (!release.data) return {ok: false, error: 'notFound'};
      return {ok: true, href: `/releases/${releaseId}`, data: {release: release.data, checks: checks.data ?? [], tasks: tasks.data ?? []}};
    }
  }),
  list_channels: tool({
    permission: 'read', readOnly: true, title: 'List channels',
    description: 'List the channels this member can see. Direct messages are included only when the token has the channels permission.',
    schema: z.object({}).strict(),
    run: async (_args, context) => {
      const withDms = context.caller.permissions.includes('channels');
      const channels = (await getChannelsAction()).filter((channel) => withDms || !channel.dm_user_a);
      return {ok: true, data: {rows: channels.map((channel) => ({id: channel.id, name: channel.name, topic: channel.topic,
        kind: channel.kind, productId: channel.product_id, parentId: channel.parent_id,
        archived: Boolean(channel.archived_at), href: `/channels/${channel.id}`}))}};
    }
  }),
  read_channel: tool({
    permission: 'read', readOnly: true, title: 'Read a channel',
    description: 'Read the recent messages of a channel (with thread parent ids) and its file attachments.',
    schema: z.object({channelId: uuid}).strict(),
    run: async ({channelId}, context) => {
      const view = await getChannelViewAction(channelId);
      if (!view.channel) return {ok: false, error: 'notFound'};
      if (view.channel.dm_user_a && !context.caller.permissions.includes('channels')) {
        return {ok: false, error: 'direct messages need the channels permission on this token'};
      }
      return {ok: true, href: `/channels/${channelId}`, data: {
        channel: {id: view.channel.id, name: view.channel.name, topic: view.channel.topic, kind: view.channel.kind},
        messages: view.messages.filter((message) => !message.deleted_at).map((message) => ({id: message.id,
          parentId: message.parent_id, authorId: message.author_id, kind: message.kind, body: message.body,
          createdAt: message.created_at, editedAt: message.edited_at})),
        attachments: view.attachments.map((file) => ({knowledgeItemId: file.id, messageId: file.source_message_id,
          fileName: file.file_name, mimeType: file.mime_type, sizeBytes: file.size_bytes}))
      }};
    }
  }),

  // ---------------------------------------------------------------- tasks
  create_task: tool({
    permission: 'tasks', title: 'Create a task',
    description: `${toolDescriptions.create_task} lifecyclePhase (product tasks only) files the work under a delivery phase.`,
    schema: toolSchemas.create_task.extend({lifecyclePhase: z.enum(LIFECYCLE_PHASES).nullable().optional()}),
    run: async (args) => {
      const result = await createTaskAction(args);
      return done(result, result.ok ? {taskId: result.taskId} : null, '/tasks');
    }
  }),
  update_task: tool({
    permission: 'tasks', title: 'Update a task',
    description: `${toolDescriptions.update_task} productId adopts a general task into a product.`,
    schema: toolSchemas.update_task.extend({
      lifecyclePhase: z.enum(LIFECYCLE_PHASES).nullable().optional(),
      productId: uuid.optional()
    }),
    run: async ({taskId, ...patch}) => done(await patchTaskAction(taskId, patch), {taskId}, '/tasks')
  }),
  set_task_watch: tool({
    permission: 'tasks', title: 'Watch or unwatch a task',
    description: 'Follow (watching: true) or stop following a task for notifications.',
    schema: z.object({taskId: uuid, watching: z.boolean()}).strict(),
    run: async ({taskId, watching}) => done(await setTaskWatchAction(taskId, watching), {taskId, watching}, '/tasks')
  }),
  set_task_release: tool({
    permission: 'tasks', title: 'Scope a task into a release',
    description: 'Put a product task into one of its product\'s releases, or remove it (releaseId: null).',
    schema: z.object({taskId: uuid, releaseId: uuid.nullable()}).strict(),
    run: async ({taskId, releaseId}) => done(await setTaskReleaseAction(taskId, releaseId), {taskId, releaseId}, '/tasks')
  }),

  // ---------------------------------------------------------------- products
  create_product: tool({
    permission: 'products', title: 'Create a product',
    description: 'Register a new product. The caller becomes its owner. slug is lowercase words joined by hyphens and must be unique.',
    schema: z.object({
      name: z.string().trim().min(1).max(120),
      slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z.string().trim().max(2000).nullable().default(null),
      descriptionAr: z.string().trim().max(2000).nullable().default(null),
      category: z.string().trim().max(80).nullable().default(null),
      stage: z.enum(['idea', 'development', 'beta', 'live', 'paused', 'sunset']).default('idea'),
      keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
      links: z.record(z.string().trim().min(1).max(60), z.string().url().max(500)).default({}),
      reviewIntervalDays: z.number().int().min(1).max(365).default(14),
      trendScanEnabled: z.boolean().default(false)
    }).strict(),
    run: async (args) => {
      const result = await createProductAction({...args, logoUrl: null, logoKey: null});
      return done(result, result.ok ? {productId: result.productId} : null,
        result.ok ? `/products/${result.productId}` : undefined);
    }
  }),
  update_product: tool({
    permission: 'products', title: 'Update a product',
    description: 'Change only the given product fields. Stage and health normally move through post_status_update. ownerId is honoured for admins only.',
    schema: z.object({
      productId: uuid,
      name: z.string().trim().min(1).max(120).optional(),
      slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      descriptionAr: z.string().trim().max(2000).nullable().optional(),
      category: z.string().trim().max(80).nullable().optional(),
      stage: z.enum(['idea', 'development', 'beta', 'live', 'paused', 'sunset']).optional(),
      keywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
      links: z.record(z.string().trim().min(1).max(60), z.string().url().max(500)).optional(),
      reviewIntervalDays: z.number().int().min(1).max(365).optional(),
      trendScanEnabled: z.boolean().optional(),
      ownerId: uuid.optional()
    }).strict(),
    run: async ({productId, ...patch}, context) => {
      const current = await readRow<Record<string, never>>(context, 'products',
        'name, slug, description, description_ar, category, stage, keywords, links, review_interval_days, trend_scan_enabled, logo_url, logo_key',
        productId);
      if (!current) return {ok: false, error: 'notFound'};
      const result = await updateProductAction(productId, {
        name: current.name, slug: current.slug, description: current.description,
        descriptionAr: current.description_ar, category: current.category, stage: current.stage,
        keywords: current.keywords ?? [], links: current.links ?? {},
        reviewIntervalDays: current.review_interval_days, trendScanEnabled: current.trend_scan_enabled,
        logoUrl: current.logo_url, logoKey: current.logo_key, ...patch
      });
      return done(result, {productId}, `/products/${productId}`);
    }
  }),
  post_status_update: tool({
    permission: 'products', title: 'Post a product status update',
    description: toolDescriptions.post_status_update, schema: statusUpdateSchema,
    run: async (args) => {
      const result = await postStatusUpdateAction(args);
      return done(result, result.ok ? {statusUpdateId: result.statusUpdateId} : null, `/products/${args.productId}`);
    }
  }),
  set_product_risk_tier: tool({
    permission: 'products', title: 'Set a product\'s risk tier',
    description: 'Set the risk tier (low, medium, high), which decides how strict the lifecycle gates are.',
    schema: z.object({productId: uuid, riskTier: z.enum(RISK_TIERS)}).strict(),
    run: async ({productId, riskTier}) =>
      done(await setProductRiskTierAction(productId, riskTier), {productId, riskTier}, `/products/${productId}`)
  }),

  // ---------------------------------------------------------------- lifecycle
  update_lifecycle_phase: tool({
    permission: 'lifecycle', title: 'Update a lifecycle phase',
    description: 'Change the owner and/or notes of a lifecycle phase (ids from get_product). Omitted fields are kept.',
    schema: z.object({phaseId: uuid, ownerId: uuid.nullable().optional(),
      notes: z.string().trim().max(5000).nullable().optional()}).strict(),
    run: async ({phaseId, ownerId, notes}, context) => {
      const current = await readRow<{owner_id: string | null; notes: string | null}>(context,
        'product_lifecycle_phases', 'owner_id, notes', phaseId);
      if (!current) return {ok: false, error: 'notFound'};
      return done(await setLifecyclePhaseDetailsAction(phaseId,
        ownerId === undefined ? current.owner_id : ownerId, notes === undefined ? current.notes : notes), {phaseId});
    }
  }),
  advance_lifecycle_phase: tool({
    permission: 'lifecycle', title: 'Move a lifecycle phase to a new state',
    description: 'Set a phase to not_started, in_progress, blocked or complete. Completing without the required evidence needs a waiverReason, and the gate rules for the product\'s risk tier still apply.',
    schema: z.object({phaseId: uuid, state: z.enum(LIFECYCLE_STATES),
      waiverReason: z.string().trim().max(2000).nullable().optional()}).strict(),
    run: async ({phaseId, state, waiverReason}) =>
      done(await advanceLifecyclePhaseAction(phaseId, state, waiverReason ?? null), {phaseId, state})
  }),
  add_lifecycle_artifact: tool({
    permission: 'lifecycle', title: 'Add evidence to a lifecycle phase',
    description: 'File evidence on a phase: a link (url), an existing knowledge item, or an uploaded file (fileId from upload_file/create_upload_link with purpose "lifecycle"; needs the attachments permission). At least one is required.',
    schema: z.object({
      phaseId: uuid,
      artifactType: z.enum(ALL_ARTIFACT_TYPES as [string, ...string[]]),
      title: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(5000).nullable().default(null),
      url: z.string().trim().url().max(2000).regex(/^https?:\/\//).nullable().default(null),
      knowledgeItemId: uuid.nullable().default(null),
      fileId: fileId.nullable().default(null)
    }).strict(),
    run: async ({fileId: id, ...args}, context) => {
      if (id) {
        const denied = needsAttachments(context);
        if (denied) return denied;
      }
      const result = await addPhaseArtifactAction({...args,
        artifactType: args.artifactType as Parameters<typeof addPhaseArtifactAction>[0]['artifactType'],
        file: id ? openFile(id, context.caller.userId, 'lifecycle') : null});
      return done(result, result.ok ? result : null);
    }
  }),

  // ---------------------------------------------------------------- knowledge
  create_knowledge_item: tool({
    permission: 'knowledge', title: 'Create a knowledge item',
    description: 'Create an article or note (content required; status draft or published) or a source (url and/or an uploaded file; status from the source review pipeline). fileId comes from upload_file/create_upload_link with purpose "knowledge" and needs the attachments permission.',
    schema: z.object({
      kind: z.enum(KNOWLEDGE_KINDS),
      title: z.string().trim().min(1).max(240),
      content: z.string().trim().max(100000).nullable().default(null),
      url: z.string().trim().url().max(2000).regex(/^https?:\/\//).nullable().default(null),
      status: z.enum(KNOWLEDGE_STATUSES).default('draft'),
      tagIds: z.array(uuid).max(30).default([]),
      productIds: z.array(uuid).max(30).default([]),
      fileId: fileId.nullable().default(null)
    }).strict(),
    run: async ({fileId: id, ...args}, context) => {
      if (id) {
        const denied = needsAttachments(context);
        if (denied) return denied;
      }
      const result = await createKnowledgeItemAction({...args,
        file: id ? openFile(id, context.caller.userId, 'knowledge') : null});
      return done(result, result.ok ? {itemId: result.itemId} : null,
        result.ok ? `/knowledge/${result.itemId}` : undefined);
    }
  }),
  update_knowledge_item: tool({
    permission: 'knowledge', title: 'Update a knowledge item',
    description: 'Change only the given fields of a knowledge item. tagIds/productIds replace the existing links when given.',
    schema: z.object({
      itemId: uuid,
      title: z.string().trim().min(1).max(240).optional(),
      content: z.string().trim().max(100000).nullable().optional(),
      url: z.string().trim().url().max(2000).regex(/^https?:\/\//).nullable().optional(),
      status: z.enum(KNOWLEDGE_STATUSES).optional(),
      tagIds: z.array(uuid).max(30).optional(),
      productIds: z.array(uuid).max(30).optional()
    }).strict(),
    run: async ({itemId, ...patch}, context) => {
      const db = context.insforge.database;
      const [item, tags, products] = await Promise.all([
        readRow<Record<string, never>>(context, 'knowledge_items',
          'kind, title, content, url, status, file_url, file_key, file_name, mime_type, size_bytes', itemId),
        db.from('knowledge_item_tags').select('tag_id').eq('item_id', itemId),
        db.from('knowledge_item_products').select('product_id').eq('item_id', itemId)
      ]);
      if (!item) return {ok: false, error: 'notFound'};
      if (tags.error || products.error) return {ok: false, error: 'readFailed'};
      const result = await updateKnowledgeItemAction(itemId, {
        kind: item.kind, title: item.title, content: item.content, url: item.url, status: item.status,
        tagIds: (tags.data ?? []).map((row) => row.tag_id as string),
        productIds: (products.data ?? []).map((row) => row.product_id as string),
        file: item.file_key ? {url: item.file_url, key: item.file_key, fileName: item.file_name,
          mimeType: item.mime_type, sizeBytes: item.size_bytes} : null,
        ...patch
      });
      return done(result, {itemId}, `/knowledge/${itemId}`);
    }
  }),
  set_knowledge_archived: tool({
    permission: 'knowledge', title: 'Archive or restore a knowledge item',
    description: 'Archive (archived: true) or restore a knowledge item.',
    schema: z.object({itemId: uuid, archived: z.boolean()}).strict(),
    run: async ({itemId, archived}) =>
      done(await setKnowledgeArchivedAction(itemId, archived), {itemId, archived}, `/knowledge/${itemId}`)
  }),
  create_tag: tool({
    permission: 'knowledge', title: 'Create a knowledge tag',
    description: 'Create a tag (or return the existing one with that name).',
    schema: z.object({name: z.string().trim().min(1).max(60)}).strict(),
    run: async ({name}) => {
      const result = await createTagAction(name);
      return done(result, result.ok ? result.tag : null);
    }
  }),

  // ---------------------------------------------------------------- releases
  create_release: tool({
    permission: 'releases', title: 'Create a release',
    description: 'Plan a release for a product. version must be unique within the product.',
    schema: z.object({productId: uuid, version: z.string().trim().min(1).max(60),
      name: z.string().trim().max(240).nullable().default(null), notes: z.string().trim().max(5000).nullable().default(null),
      targetDate: date.nullable().default(null), ownerId: uuid.nullable().default(null)}).strict(),
    run: async (args) => {
      const result = await createReleaseAction(args);
      return done(result, result.ok ? {releaseId: result.releaseId} : null,
        result.ok ? `/releases/${result.releaseId}` : undefined);
    }
  }),
  update_release: tool({
    permission: 'releases', title: 'Update a release',
    description: 'Change only the given fields of a release. Status moves through advance_release_status.',
    schema: z.object({releaseId: uuid, version: z.string().trim().min(1).max(60).optional(),
      name: z.string().trim().max(240).nullable().optional(), notes: z.string().trim().max(5000).nullable().optional(),
      targetDate: date.nullable().optional(), ownerId: uuid.nullable().optional()}).strict(),
    run: async ({releaseId, ...patch}, context) => {
      const current = await readRow<{version: string; name: string | null; notes: string | null;
        target_date: string | null; owner_id: string | null}>(context, 'product_releases',
        'version, name, notes, target_date, owner_id', releaseId);
      if (!current) return {ok: false, error: 'notFound'};
      return done(await updateReleaseAction(releaseId, {version: current.version, name: current.name,
        notes: current.notes, targetDate: current.target_date, ownerId: current.owner_id, ...patch}),
      {releaseId}, `/releases/${releaseId}`);
    }
  }),
  advance_release_status: tool({
    permission: 'releases', title: 'Move a release to a new status',
    description: `Move a release through ${RELEASE_STATUSES.join(' → ')}. Shipping with open required checks needs a waiverReason; some transitions require an admin.`,
    schema: z.object({releaseId: uuid, status: z.enum(RELEASE_STATUSES),
      waiverReason: z.string().trim().max(2000).nullable().optional()}).strict(),
    run: async ({releaseId, status, waiverReason}) =>
      done(await advanceReleaseStatusAction(releaseId, status, waiverReason ?? null), {releaseId, status}, `/releases/${releaseId}`)
  }),
  set_release_check: tool({
    permission: 'releases', title: 'Tick or untick a release check',
    description: `Mark a release checklist item (${RELEASE_CHECK_KEYS.join(', ')}) done or not done, with an optional note.`,
    schema: z.object({releaseId: uuid, checkKey: z.enum(RELEASE_CHECK_KEYS), done: z.boolean(),
      note: z.string().trim().max(2000).nullable().optional()}).strict(),
    run: async ({releaseId, checkKey, done: complete, note}) =>
      done(await setReleaseCheckAction(releaseId, checkKey, complete, note ?? null), {releaseId, checkKey}, `/releases/${releaseId}`)
  }),

  // ---------------------------------------------------------------- channels
  post_message: tool({
    permission: 'channels', title: 'Post a message',
    description: 'Post a message to a channel, or reply in a thread with parentId. Posted as this member; @handles mention people and agents.',
    schema: z.object({channelId: uuid, body: z.string().trim().min(1).max(20000), parentId: uuid.nullable().optional()}).strict(),
    run: async (args) => {
      const result = await postMessageAction(args);
      return done(result, result.ok ? {messageId: result.messageId} : null, `/channels/${args.channelId}`);
    }
  }),
  create_channel: tool({
    permission: 'channels', title: 'Create a channel',
    description: 'Create a standing channel, optionally bound to a product or nested under another channel.',
    schema: z.object({name: z.string().trim().min(1).max(80), topic: z.string().trim().max(500).optional(),
      productId: uuid.optional(), parentId: uuid.optional()}).strict(),
    run: async (args) => {
      const result = await createChannelAction(args);
      return done(result, result.ok ? {channelId: result.channelId} : null,
        result.ok ? `/channels/${result.channelId}` : undefined);
    }
  }),
  open_direct_message: tool({
    permission: 'channels', title: 'Open a direct message',
    description: 'Open (or find) the private conversation with another member; post into it with post_message.',
    schema: z.object({userId: uuid}).strict(),
    run: async ({userId}) => {
      const result = await openDirectMessageAction(userId) as ActionResult & {channelId?: string};
      return done(result, result.ok ? {channelId: result.channelId} : null);
    }
  }),

  // ---------------------------------------------------------------- attachments
  upload_file: tool({
    permission: 'attachments', title: 'Upload a small file',
    description: `Store a file you have in hand and get a fileId for the attach tools. Pass text (UTF-8, e.g. Markdown or CSV you wrote) or contentBase64 (small binaries), up to ${MAX_MCP_INLINE_UPLOAD_BYTES / 1024 / 1024} MB. For a file on disk prefer create_upload_link. purpose decides where it can be attached: ${FILE_PURPOSE_NAMES.join(', ')}. status_update and logo take images only.`,
    schema: z.object({
      purpose: z.enum(FILE_PURPOSE_NAMES),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().max(200).optional(),
      text: z.string().max(MAX_MCP_INLINE_UPLOAD_BYTES).optional(),
      contentBase64: z.string().max(Math.ceil(MAX_MCP_INLINE_UPLOAD_BYTES * 4 / 3) + 4)
        .regex(/^[A-Za-z0-9+/=\s]*$/).optional()
    }).strict().refine((value) => (value.text === undefined) !== (value.contentBase64 === undefined),
      {message: 'pass exactly one of text or contentBase64'}),
    run: async ({purpose, fileName, mimeType, text, contentBase64}, context) => {
      const bytes = text !== undefined ? new TextEncoder().encode(text) : Buffer.from(contentBase64!, 'base64');
      if (bytes.byteLength > MAX_MCP_INLINE_UPLOAD_BYTES) return {ok: false, error: 'fileSize'};
      const stored = await storeFile(context.insforge, context.caller.userId, purpose, {fileName, mimeType, bytes});
      return {ok: true, changed: true, data: stored};
    }
  }),
  create_upload_link: tool({
    permission: 'attachments', title: 'Get a link to upload a file',
    description: `Get a one-off URL (valid 15 minutes) to upload a file from disk with an HTTP PUT of the raw bytes, e.g. with the returned curl command. The response is JSON containing the fileId for the attach tools. Up to ${MAX_MCP_UPLOAD_BYTES / 1024 / 1024} MB. purpose: ${FILE_PURPOSE_NAMES.join(', ')}.`,
    schema: z.object({purpose: z.enum(FILE_PURPOSE_NAMES), fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().max(200).optional()}).strict(),
    run: async ({purpose, fileName, mimeType}, context) => {
      const ticket = createUploadTicket({userId: context.caller.userId, tokenId: context.caller.tokenId,
        purpose, fileName, mimeType: mimeType ?? ''});
      const uploadUrl = `${context.origin}/api/mcp/uploads?ticket=${encodeURIComponent(ticket)}`;
      return {ok: true, data: {uploadUrl, method: 'PUT', expiresInSeconds: 900,
        maxBytes: Math.min(FILE_PURPOSES[purpose].maxBytes, MAX_MCP_UPLOAD_BYTES),
        curl: `curl -sS -X PUT --data-binary @'<path to ${fileName.replace(/'/g, '')}>' '${uploadUrl}'`}};
    }
  }),
  attach_files_to_task: tool({
    permission: 'attachments', title: 'Attach files to a task',
    description: 'Attach uploaded files (fileIds with purpose "task") to a task.',
    schema: z.object({taskId: uuid, fileIds}).strict(),
    run: async ({taskId, fileIds: ids}, context) =>
      done(await addTaskAttachmentsAction(taskId, files(ids, context, 'task')), {taskId, attached: ids.length}, '/tasks')
  }),
  attach_images_to_status_update: tool({
    permission: 'attachments', title: 'Attach images to a status update',
    description: 'Attach uploaded images (fileIds with purpose "status_update") to a status update.',
    schema: z.object({statusUpdateId: uuid, fileIds}).strict(),
    run: async ({statusUpdateId, fileIds: ids}, context) =>
      done(await addStatusUpdateAttachmentsAction(statusUpdateId, files(ids, context, 'status_update')),
        {statusUpdateId, attached: ids.length})
  }),
  attach_files_to_message: tool({
    permission: 'attachments', title: 'Attach files to a message',
    description: 'Attach uploaded files (fileIds with purpose "message") to a message you posted. They become knowledge sources linked to the message.',
    schema: z.object({messageId: uuid, fileIds}).strict(),
    run: async ({messageId, fileIds: ids}, context) =>
      done(await attachFilesToMessageAction({messageId, files: files(ids, context, 'message')}), {messageId, attached: ids.length})
  }),
  set_product_logo: tool({
    permission: 'attachments', title: 'Set or clear a product logo',
    description: 'Set a product logo from an uploaded image (fileId with purpose "logo"), or clear it with fileId: null.',
    schema: z.object({productId: uuid, fileId: fileId.nullable()}).strict(),
    run: async ({productId, fileId: id}, context) => {
      const result = await setProductLogoAction(productId, id ? openFile(id, context.caller.userId, 'logo') : null);
      if (result.ok && result.previousKey) await removeObjects(context, 'product-media', [result.previousKey]);
      return done(result, {productId}, `/products/${productId}`);
    }
  }),

  // ---------------------------------------------------------------- delete
  delete_task: tool({
    permission: 'delete', destructive: true, title: 'Delete a task',
    description: 'Permanently delete a task, its subtasks\' links and its attachments.',
    schema: z.object({taskId: uuid}).strict(),
    run: async ({taskId}, context) => {
      const result = await deleteTaskAction(taskId);
      if (result.ok) await removeObjects(context, 'product-media', result.storageKeys ?? []);
      return done(result, {taskId});
    }
  }),
  delete_status_update: tool({
    permission: 'delete', destructive: true, title: 'Delete a status update',
    description: 'Permanently delete a status update and its images. Derived health and stage are recalculated.',
    schema: z.object({statusUpdateId: uuid}).strict(),
    run: async ({statusUpdateId}, context) => {
      const result = await deleteStatusUpdateAction(statusUpdateId);
      if (result.ok) await removeObjects(context, 'product-media', result.storageKeys);
      return done(result, {statusUpdateId});
    }
  }),
  delete_knowledge_item: tool({
    permission: 'delete', destructive: true, title: 'Delete a knowledge item',
    description: 'Permanently delete a knowledge item (archive it with set_knowledge_archived to keep it).',
    schema: z.object({itemId: uuid}).strict(),
    run: async ({itemId}, context) => {
      const item = await readRow<{file_bucket: string | null}>(context, 'knowledge_items', 'file_bucket', itemId);
      const result = await deleteKnowledgeItemAction(itemId);
      // Lifecycle-synced items point at the artifact's object; only remove
      // files the knowledge base owns.
      if (result.ok && item?.file_bucket === 'knowledge-files') {
        await removeObjects(context, 'knowledge-files', [result.fileKey]);
      }
      return done(result, {itemId});
    }
  }),
  delete_release: tool({
    permission: 'delete', destructive: true, title: 'Delete a release',
    description: 'Delete a release that has not shipped. Its tasks are unscoped, not deleted.',
    schema: z.object({releaseId: uuid}).strict(),
    run: async ({releaseId}) => done(await deleteReleaseAction(releaseId), {releaseId}, '/releases')
  }),
  delete_message: tool({
    permission: 'delete', destructive: true, title: 'Delete a message',
    description: 'Delete a message you are allowed to delete.',
    schema: z.object({messageId: uuid}).strict(),
    run: async ({messageId}) => done(await deleteMessageAction({messageId}), {messageId})
  }),
  delete_lifecycle_artifact: tool({
    permission: 'delete', destructive: true, title: 'Delete lifecycle evidence',
    description: 'Remove an artifact from a lifecycle phase.',
    schema: z.object({artifactId: uuid}).strict(),
    run: async ({artifactId}) => done(await deletePhaseArtifactAction(artifactId), {artifactId})
  }),
  set_product_archived: tool({
    permission: 'delete', destructive: true, title: 'Archive or restore a product',
    description: 'Archive (archived: true) or restore a product. Admins only.',
    schema: z.object({productId: uuid, archived: z.boolean()}).strict(),
    run: async ({productId, archived}) =>
      done(await setProductArchivedAction(productId, archived), {productId, archived}, `/products/${productId}`)
  })
};

export function toolAllowed(name: string, permissions: readonly McpPermission[]): boolean {
  return Object.hasOwn(MCP_TOOLS, name) && permissions.includes(MCP_TOOLS[name].permission);
}

export function mcpToolList(permissions: readonly McpPermission[]) {
  return Object.entries(MCP_TOOLS).filter(([name]) => toolAllowed(name, permissions)).map(([name, definition]) => {
    // MCP fixes the schema dialect itself; drop the generator's $schema.
    const inputSchema: Record<string, unknown> = {...z.toJSONSchema(definition.schema, {io: 'input'})};
    delete inputSchema.$schema;
    return {
      name,
      title: definition.title,
      description: definition.description,
      inputSchema,
      annotations: {title: definition.title, readOnlyHint: Boolean(definition.readOnly),
        destructiveHint: Boolean(definition.destructive), idempotentHint: Boolean(definition.readOnly),
        openWorldHint: false}
    };
  });
}

export async function runMcpTool(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
  const definition = MCP_TOOLS[name];
  const parsed = definition.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return {ok: false, error: 'invalid', data: {issues: parsed.error.issues.slice(0, 10).map((issue) =>
      ({path: issue.path.join('.'), message: issue.message}))}};
  }
  try {
    return await definition.run(parsed.data, context);
  } catch (error) {
    if (error instanceof McpFileError) return {ok: false, error: error.code};
    // Never forward an internal error message to the client.
    return {ok: false, error: 'generic'};
  }
}
