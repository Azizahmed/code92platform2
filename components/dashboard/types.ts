import type {Health} from '@/components/HealthBadge';
import type {Stage} from '@/components/StageChip';
import type {LifecyclePhase, LifecycleState, RiskTier} from '@/lib/lifecycle';

// Row shape of the product_overview view (see migration 0001_core_schema,
// extended by add-product-tasks-and-media and add-product-lifecycle).
export type ProductOverview = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  description_ar: string | null;
  category: string | null;
  stage: Stage;
  health: Health;
  owner_id: string | null;
  owner_name: string | null;
  review_interval_days: number;
  next_review_at: string | null;
  last_status_update_at: string | null;
  last_trend_scan_at: string | null;
  trend_scan_enabled: boolean;
  archived_at: string | null;
  created_at: string;
  is_overdue: boolean;
  staleness_days: number | null;
  last_update_summary: string | null;
  last_update_author: string | null;
  trend_count_7d: number;
  logo_url: string | null;
  risk_tier: RiskTier;
  // Null only for a product whose phase rows have somehow gone missing; the
  // seed trigger creates all six on insert.
  lifecycle_phase: LifecyclePhase | null;
  lifecycle_state: LifecycleState | null;
  lifecycle_complete_count: number;
};
