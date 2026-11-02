import type {RiskTier} from '@/lib/risk';

// The product page's header and every tab read the same overview row, so they
// share its shape. Mirrors public.product_overview; see
// migrations/20261027103000_add-0-3-projections.sql.
export type ProductOverviewRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  description_ar: string | null;
  category: string | null;
  stage: string;
  health: 'green' | 'yellow' | 'red' | 'unknown';
  owner_id: string;
  owner_name: string | null;
  review_interval_days: number;
  next_review_at: string | null;
  last_status_update_at: string | null;
  archived_at: string | null;
  created_at: string;
  is_overdue: boolean;
  staleness_days: number;
  last_update_summary: string | null;
  last_update_author: string | null;
  logo_url: string | null;
  risk_tier: RiskTier;
  business_stage: string;
  origination: string | null;
  ownership: string | null;
  code92_equity_pct: number | null;
  operator_name: string | null;
  operator_user_id: string | null;
  operator_contact_id: string | null;
  business_owner_id: string | null;
  business_owner_name: string | null;
  sector: string | null;
  gate1_go: boolean | null;
  gate2_go: boolean | null;
  current_release_id: string | null;
  current_release_version: string | null;
  current_release_stage: string | null;
  current_release_status: string | null;
  checklist_done: number;
  checklist_total: number;
};
