// Shared release vocabulary. Kept out of the 'use server' action module so
// client components can import the constants themselves, not just the types.
//
// IMPORTANT: this file MIRRORS the SQL in
// migrations/20260803090500_add-release-management.sql — specifically
// release_status_index(), release_required_checks() and
// release_status_can_follow(). The database is authoritative: it is what
// advance_release_status() enforces, and product_releases grants no UPDATE on
// `status` to any client. This copy exists so the UI can show which checks are
// outstanding and which buttons to offer *before* submitting. Change both
// together.

import type {RiskTier} from '@/lib/lifecycle';

export const RELEASE_STATUSES = [
  'planned',
  'in_progress',
  'ready',
  'released',
  'rolled_back',
  'cancelled'
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_CHECK_KEYS = [
  'release_notes',
  'qa_signoff',
  'rollback_plan',
  'security_signoff',
  'change_approval'
] as const;
export type ReleaseCheckKey = (typeof RELEASE_CHECK_KEYS)[number];

// The pseudo-entry advance_release_status() appends to missing_checks when work
// scoped into the release is still open. It is not a row in release_checks, so
// anything rendering a missing list has to know it may appear.
export const OPEN_TASKS_GAP = 'open_tasks';

const REQUIRED_CHECKS: Record<RiskTier, readonly ReleaseCheckKey[]> = {
  low: ['release_notes'],
  medium: ['release_notes', 'qa_signoff', 'rollback_plan'],
  high: [
    'release_notes',
    'qa_signoff',
    'rollback_plan',
    'security_signoff',
    'change_approval'
  ]
};

export function requiredChecks(
  riskTier: RiskTier
): readonly ReleaseCheckKey[] {
  return REQUIRED_CHECKS[riskTier] ?? REQUIRED_CHECKS.medium;
}

const NEXT_STATUSES: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'planned', 'cancelled'],
  ready: ['released', 'in_progress', 'cancelled'],
  released: ['rolled_back'],
  rolled_back: ['in_progress'],
  cancelled: ['planned']
};

export function nextStatuses(
  status: ReleaseStatus
): readonly ReleaseStatus[] {
  return NEXT_STATUSES[status] ?? [];
}

export function isReleaseStatus(value: string): value is ReleaseStatus {
  return (RELEASE_STATUSES as readonly string[]).includes(value);
}

export function isReleaseCheckKey(value: string): value is ReleaseCheckKey {
  return (RELEASE_CHECK_KEYS as readonly string[]).includes(value);
}

// A high-risk release cannot go out with gaps unless an admin writes down why.
// Low and medium ship with the gap recorded instead of blocked — the same
// bargain the lifecycle gate makes.
export function requiresWaiver(
  riskTier: RiskTier,
  status: ReleaseStatus,
  missing: readonly string[]
): boolean {
  return riskTier === 'high' && status === 'released' && missing.length > 0;
}

// Who may touch a release at all. Mirrors can_manage_release_for_product().
export function canManageRelease(opts: {
  riskTier: RiskTier;
  isOwner: boolean;
  isAdmin: boolean;
  isArchived: boolean;
}): boolean {
  if (opts.isArchived) return false;
  if (!opts.isOwner && !opts.isAdmin) return false;
  if (opts.riskTier === 'high' && !opts.isAdmin) return false;
  return true;
}

export type ReleaseOverview = {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_logo_url: string | null;
  risk_tier: RiskTier;
  product_archived_at: string | null;
  version: string;
  name: string | null;
  notes: string | null;
  status: ReleaseStatus;
  target_date: string | null;
  released_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
  checks_required: number;
  checks_done: number;
  task_count: number;
  open_task_count: number;
};

export type ReleaseCheck = {
  id: string;
  release_id: string;
  check_key: ReleaseCheckKey;
  is_required: boolean;
  completed_at: string | null;
  completed_by: string | null;
  note: string | null;
};

export type ReleaseTransition = {
  id: string;
  release_id: string;
  product_id: string;
  from_status: ReleaseStatus | null;
  to_status: ReleaseStatus;
  actor_id: string;
  risk_tier_at_time: RiskTier;
  missing_checks: string[];
  waiver_reason: string | null;
  self_approved: boolean;
  created_at: string;
};

// Which statuses count as "still in flight" for the default board view.
export const ACTIVE_RELEASE_STATUSES: readonly ReleaseStatus[] = [
  'planned',
  'in_progress',
  'ready'
];
