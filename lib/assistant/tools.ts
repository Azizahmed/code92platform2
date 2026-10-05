import {createKnowledgeItemAction} from '@/lib/actions/knowledge';
import {postStatusUpdateAction} from '@/lib/actions/status-updates';
import {createTaskAction, patchTaskAction} from '@/lib/actions/tasks';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {toolSchemas, type ToolName} from './schemas';
import type {ToolResult} from './protocol';

type ServerClient = Awaited<ReturnType<typeof createInsForgeServerClient>>;

export function createToolExecutor(insforge: ServerClient) {
  return async function execute(name: string, input: unknown): Promise<ToolResult> {
    if (!Object.hasOwn(toolSchemas, name)) return {ok: false, error: 'unsupportedTool'};
    const schema = toolSchemas[name as ToolName];
    if (!schema.safeParse(input).success) return {ok: false, error: 'invalid'};

    switch (name) {
      case 'list_records': {
        const args = toolSchemas.list_records.parse(input);
        if ((args.productId && !['tasks', 'releases'].includes(args.entity)) ||
            ((args.assigneeId || args.taskStatus) && args.entity !== 'tasks')) {
          return {ok: false, error: 'invalid'};
        }
        const sources = {
          products: {table: 'product_overview', columns: 'id, name, description, stage, health, owner_id, owner_name, next_review_at, is_overdue, last_update_summary, risk_tier, lifecycle_phase, lifecycle_state', label: 'name', order: 'name', route: 'products'},
          tasks: {table: 'product_tasks', columns: 'id, product_id, parent_task_id, title, notes, status, due_date, assignee_id, completion_note', label: 'title', order: 'created_at', route: 'tasks'},
          members: {table: 'team_members', columns: 'user_id, display_name, role', label: 'display_name', order: 'display_name', route: 'settings'},
          releases: {table: 'release_overview', columns: 'id, product_id, name, status, target_date', label: 'name', order: 'created_at', route: 'releases'}
        } as const;
        const source = sources[args.entity];
        let query = insforge.database.from(source.table).select(source.columns)
          .order(source.order, {ascending: args.entity === 'products' || args.entity === 'members'})
          .order(args.entity === 'members' ? 'user_id' : 'id')
          .range(args.offset, args.offset + 25);
        if (args.entity === 'products') query = query.is('archived_at', null);
        if (args.entity === 'members') query = query.eq('is_active', true);
        if (args.productId) query = query.eq('product_id', args.productId);
        if (args.assigneeId) query = query.eq('assignee_id', args.assigneeId);
        if (args.taskStatus) query = query.eq('status', args.taskStatus);
        if (args.query) query = query.ilike(source.label, `%${args.query.replace(/[\\%_]/g, '\\$&')}%`);
        const {data, error} = await query;
        if (error) return {ok: false, error: 'readFailed'};
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        return {ok: true, data: {
          rows: rows.slice(0, 25).map((row) => ({...row,
            // A task may contain long human-authored notes; list reads only
            // need a preview, keeping repeated tool results within context.
            ...(typeof row.notes === 'string' ? {notes: row.notes.slice(0, 1000)} : {}),
            ...(typeof row.completion_note === 'string' ? {completion_note: row.completion_note.slice(0, 1000)} : {}),
            href: args.entity === 'tasks' || args.entity === 'members'
              ? `/${source.route}` : `/${source.route}/${row.id}`
          })),
          hasMore: rows.length > 25,
          nextOffset: rows.length > 25 ? args.offset + 25 : null
        }};
      }
      case 'search_knowledge': {
        const args = toolSchemas.search_knowledge.parse(input);
        const {data, error} = await insforge.database.rpc('search_knowledge_items', {
          p_query: args.query || null, p_product: args.productId ?? null,
          p_kind: null, p_status: null, p_tag: null, p_include_archived: false,
          p_limit: 15, p_origin: null, p_phase: null
        });
        if (error) return {ok: false, error: 'readFailed'};
        return {ok: true, data: {rows: (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id, title: row.title, excerpt: row.excerpt, status: row.status,
          href: `/knowledge/${row.id}`
        })), limit: 15}};
      }
      case 'read_knowledge': {
        const args = toolSchemas.read_knowledge.parse(input);
        const {data, error} = await insforge.database.from('knowledge_items')
          .select('id, title, content, kind, status').eq('id', args.id).maybeSingle();
        if (error) return {ok: false, error: 'readFailed'};
        if (!data) return {ok: false, error: 'notFound'};
        const content = typeof data.content === 'string' ? data.content : '';
        return {ok: true, data: {...data, content: content.slice(0, 16000), truncated: content.length > 16000}, href: `/knowledge/${args.id}`};
      }
      case 'create_task': {
        const result = await createTaskAction(toolSchemas.create_task.parse(input));
        return result.ok ? {ok: true, changed: true, data: {taskId: result.taskId}, href: '/tasks'} : result;
      }
      case 'update_task': {
        const {taskId, ...patch} = toolSchemas.update_task.parse(input);
        const result = await patchTaskAction(taskId, patch);
        return result.ok ? {ok: true, changed: true, data: {taskId}, href: '/tasks'} : result;
      }
      case 'post_status_update': {
        const args = toolSchemas.post_status_update.parse(input);
        const result = await postStatusUpdateAction(args);
        return result.ok ? {ok: true, changed: true, data: {statusUpdateId: result.statusUpdateId}, href: `/products/${args.productId}`} : result;
      }
      case 'create_knowledge_note': {
        const args = toolSchemas.create_knowledge_note.parse(input);
        const result = await createKnowledgeItemAction({
          ...args, kind: 'note', status: 'draft', url: null, file: null, tagIds: []
        });
        return result.ok ? {ok: true, changed: true, data: {itemId: result.itemId}, href: `/knowledge/${result.itemId}`} : result;
      }
      default: return {ok: false, error: 'unsupportedTool'};
    }
  };
}
