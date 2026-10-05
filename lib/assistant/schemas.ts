import {z} from 'zod';
import {assistantAttachmentSchema} from './attachment-schema';
import {chatAttachmentsFit, chatTextSize, MAX_ASSISTANT_FILES} from './attachments';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const nullableUuid = uuid.nullable();
const text = z.string().trim().min(1).max(240);

export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(12000),
    attachments: z.array(assistantAttachmentSchema).max(MAX_ASSISTANT_FILES).optional()
  }).strict().refine((message) => message.role === 'user' || !message.attachments?.length)).min(1).max(20),
  locale: z.enum(['en', 'ar']),
  pathname: z.string().max(250).regex(/^\/(?:[a-zA-Z0-9_\-/]*)$/)
}).strict().refine((value) => value.messages.at(-1)?.role === 'user')
  .refine((value) => chatTextSize(value.messages) <= 60000 && chatAttachmentsFit(value.messages));

export const toolSchemas = {
  list_records: z.object({
    entity: z.enum(['products', 'tasks', 'members', 'releases']),
    query: z.string().trim().max(120).optional(),
    productId: uuid.optional(),
    assigneeId: uuid.optional(),
    taskStatus: z.enum(['pending', 'completed']).optional(),
    offset: z.number().int().min(0).max(10000).default(0)
  }).strict(),
  search_knowledge: z.object({query: z.string().trim().max(200), productId: uuid.optional()}).strict(),
  read_knowledge: z.object({id: uuid}).strict(),
  create_task: z.object({
    title: text,
    productId: nullableUuid,
    parentTaskId: nullableUuid,
    notes: z.string().trim().max(5000).nullable(),
    dueDate: date,
    assigneeId: nullableUuid
  }).strict(),
  update_task: z.object({
    taskId: uuid,
    title: text.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    dueDate: date.optional(),
    assigneeId: nullableUuid.optional(),
    status: z.enum(['pending', 'completed']).optional(),
    completionNote: z.string().trim().max(5000).nullable().optional()
  }).strict(),
  post_status_update: z.object({
    productId: uuid,
    health: z.enum(['green', 'yellow', 'red', 'unknown']),
    stage: z.enum(['idea', 'development', 'beta', 'live', 'paused', 'sunset']).nullable(),
    summary: z.string().trim().min(1).max(500),
    details: z.string().trim().max(5000).nullable()
  }).strict(),
  create_knowledge_note: z.object({
    title: text,
    content: z.string().trim().min(1).max(10000),
    productIds: z.array(uuid).max(10)
  }).strict()
};
export type ToolName = keyof typeof toolSchemas;

const descriptions: Record<ToolName, string> = {
  list_records: 'Read a page of visible products, tasks, active team members or releases. Search by name/title. Filters productId (tasks/releases), assigneeId and taskStatus (tasks only). Returns up to 25 rows, hasMore, nextOffset and internal links.',
  search_knowledge: 'Search the bilingual knowledge base. Returns up to 15 excerpts with links. Query may be empty to browse recent items. Use read_knowledge to read a specific item.',
  read_knowledge: 'Read the content of a visible knowledge item. Long content is truncated explicitly.',
  create_task: 'Create a task requested by the user. Resolve product, parent and assignee IDs first; use null for unrequested optional fields. Null productId creates a general task.',
  update_task: 'Update only the requested fields of an existing task. Complete with status completed and an optional completionNote; reopen with pending. Omitted fields are preserved.',
  post_status_update: 'Append a requested product status update. This changes derived health and optionally stage. Null stage leaves the stage unchanged.',
  create_knowledge_note: 'Save a user-requested knowledge note as a draft. Never publishes. Include product IDs only if the user requested links to those products.'
};

export const assistantTools = (Object.keys(toolSchemas) as ToolName[]).map((name) => ({
  type: 'function' as const,
  function: {
    name,
    description: descriptions[name],
    parameters: z.toJSONSchema(toolSchemas[name], {target: 'draft-7'})
  }
}));
