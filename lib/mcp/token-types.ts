import type {McpPermission} from './permissions';

export type McpTokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  permissions: McpPermission[];
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
