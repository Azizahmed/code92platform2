// What an MCP token may do, chosen by its owner at creation. Mirrors the CHECK
// in migrations/20261006090000_mcp-token-permissions.sql — change both
// together. 'read' is always granted; every other entry unlocks one group of
// tools in lib/mcp/tools.ts. None of them can exceed the owner's own rights:
// tools run under the owner's RLS.
export const MCP_GRANTABLE_PERMISSIONS = [
  'tasks',
  'products',
  'lifecycle',
  'knowledge',
  'releases',
  'channels',
  'attachments',
  'delete'
] as const;

export const MCP_PERMISSIONS = ['read', ...MCP_GRANTABLE_PERMISSIONS] as const;

export type McpPermission = (typeof MCP_PERMISSIONS)[number];
export type McpGrantablePermission = (typeof MCP_GRANTABLE_PERMISSIONS)[number];

export function isMcpPermission(value: unknown): value is McpPermission {
  return typeof value === 'string' && (MCP_PERMISSIONS as readonly string[]).includes(value);
}
