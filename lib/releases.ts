// The development track: every release runs the same six stages, and each stage
// closes with the artifacts that prove it.
//
// IMPORTANT: this file MIRRORS the SQL in
// migrations/20261027101000_add-release-loop.sql — release_stage_index(),
// release_status_for_stage(), release_artifact_stage() and
// release_stage_gaps(). The database is authoritative: move_release_stage() and
// advance_release_status() enforce it, and no client role holds a grant on the
// stage or status columns. This copy exists so the UI can show what a stage
// still needs before submitting. Change both together.

import type {RiskTier} from '@/lib/risk';

export const RELEASE_STAGES = [
  'plan',
  'design',
  'build',
  'test',
  'deploy',
  'maintain'
] as const;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export function isReleaseStage(value: string): value is ReleaseStage {
  return (RELEASE_STAGES as readonly string[]).includes(value);
}

export function releaseStageIndex(stage: ReleaseStage): number {
  return RELEASE_STAGES.indexOf(stage) + 1;
}

export function nextReleaseStage(stage: ReleaseStage): ReleaseStage | null {
  return RELEASE_STAGES[RELEASE_STAGES.indexOf(stage) + 1] ?? null;
}

// The status a release shows while it sits in a stage. Entering Deploy means
// Test has closed; entering Maintain means the release has shipped.
const STATUS_FOR_STAGE: Record<ReleaseStage, ReleaseStatus> = {
  plan: 'planned',
  design: 'in_progress',
  build: 'in_progress',
  test: 'in_progress',
  deploy: 'ready',
  maintain: 'released'
};

export function statusForStage(stage: ReleaseStage): ReleaseStatus {
  return STATUS_FOR_STAGE[stage];
}

export const RELEASE_STATUSES = [
  'planned',
  'in_progress',
  'ready',
  'released',
  'rolled_back',
  'cancelled'
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export function isReleaseStatus(value: string): value is ReleaseStatus {
  return (RELEASE_STATUSES as readonly string[]).includes(value);
}

// Every artifact key, and the stage that closes with it. A key belongs to one
// stage only.
export const ARTIFACT_STAGE = {
  intent: 'plan',
  spec: 'design',
  plan: 'design',
  threat_model: 'design',
  pull_request: 'build',
  test_results: 'test',
  review_findings: 'test',
  security_review: 'test',
  release_tag: 'deploy',
  deploy_checklist: 'deploy',
  security_scan: 'deploy',
  incident: 'maintain',
  metric: 'maintain',
  runbook: 'maintain'
} as const satisfies Record<string, ReleaseStage>;

export type ArtifactKey = keyof typeof ARTIFACT_STAGE;
export const ARTIFACT_KEYS = Object.keys(ARTIFACT_STAGE) as ArtifactKey[];

export function isArtifactKey(value: string): value is ArtifactKey {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_STAGE, value);
}

// Incidents, metrics and runbooks seed the next release's intent.
export const CARRY_KEYS: readonly ArtifactKey[] = [
  'incident',
  'metric',
  'runbook'
];

export const RELEASE_CHECK_KEYS = [
  'release_notes',
  'qa_signoff',
  'rollback_plan',
  'security_signoff',
  'change_approval'
] as const;
export type ReleaseCheckKey = (typeof RELEASE_CHECK_KEYS)[number];

export function isReleaseCheckKey(value: string): value is ReleaseCheckKey {
  return (RELEASE_CHECK_KEYS as readonly string[]).includes(value);
}

// The pseudo-gaps that are not artifact keys. 'link' means nothing has been
// filed at this stage at all; 'spec_approval', 'test_pass' and 'findings_closed'
// are the stage-specific conditions; 'open_tasks' is work still open in the
// release.
export const GAP_LINK = 'link';
export const GAP_SPEC_APPROVAL = 'spec_approval';
export const GAP_TEST_PASS = 'test_pass';
export const GAP_FINDINGS_CLOSED = 'findings_closed';
export const OPEN_TASKS_GAP = 'open_tasks';

// At Deploy, unmet checks and open work are the gaps a high-risk release may
// waive with a written reason. Everything else blocks the move outright.
export function isWaivableGap(gap: string): boolean {
  return (RELEASE_CHECK_KEYS as readonly string[]).includes(gap) ||
    gap === OPEN_TASKS_GAP;
}

export function gapLabelKey(gap: string): string {
  if (gap === GAP_LINK) return 'link';
  if (gap === GAP_SPEC_APPROVAL) return 'specApproval';
  if (gap === GAP_TEST_PASS) return 'testPass';
  if (gap === GAP_FINDINGS_CLOSED) return 'findingsClosed';
  if (gap === OPEN_TASKS_GAP) return 'openTasks';
  if (isReleaseCheckKey(gap)) return `checks.${gap}`;
  if (isArtifactKey(gap)) return `artifacts.${gap}`;
  return 'unknown';
}

// The MVP is Release 0; every later release is a cycle.
export type ReleaseKind = 'mvp' | 'cycle';

export function releaseKind(releaseNumber: number): ReleaseKind {
  return releaseNumber === 0 ? 'mvp' : 'cycle';
}

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

// Who may touch a release at all. Mirrors can_manage_release_for_product(), and
// the stricter high-risk rule that move_release_stage() and
// advance_release_status() apply on top.
export function canManageRelease(opts: {
  riskTier: RiskTier;
  isOwner: boolean;
  isAdmin: boolean;
  isArchived: boolean;
}): boolean {
  if (opts.isArchived) return false;
  if (!opts.isOwner && !opts.isAdmin) return false;
  return true;
}

// High-risk releases move stage and change status through an admin only.
export function needsAdminToMove(riskTier: RiskTier, isAdmin: boolean): boolean {
  return riskTier === 'high' && !isAdmin;
}

// The exits from the loop: cancelling, rolling a shipped release back, and the
// two ways back in from those. Everything else is a stage move.
export function exitTargets(status: ReleaseStatus): readonly ReleaseStatus[] {
  switch (status) {
    case 'planned':
    case 'in_progress':
    case 'ready':
      return ['cancelled'];
    case 'released':
      return ['rolled_back'];
    case 'rolled_back':
      return ['in_progress'];
    case 'cancelled':
      return ['planned'];
    default:
      return [];
  }
}

export type ReleaseOverview = {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_logo_url: string | null;
  product_business_stage: string;
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
  release_number: number;
  is_mvp: boolean;
  goal: string | null;
  success_criteria: string | null;
  stage: ReleaseStage;
  spec_approved_at: string | null;
  spec_self_approved: boolean;
  test_result: 'pass' | 'fail' | null;
  findings_open: number;
  findings_closed: number;
  artifacts_required: number;
  artifacts_filed: number;
  stage_gap_count: number;
};

export type ReleaseArtifact = {
  id: string;
  release_id: string;
  stage: ReleaseStage;
  artifact_key: ArtifactKey;
  title: string;
  url: string | null;
  knowledge_item_id: string | null;
  commit_ref: string | null;
  carry_to_next: boolean;
  created_by: string;
  created_at: string;
};

export type ReleaseRequirement = {
  artifact_key: ArtifactKey;
  is_required: boolean;
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
  from_stage: ReleaseStage | null;
  to_stage: ReleaseStage | null;
  actor_id: string;
  risk_tier_at_time: RiskTier;
  missing_checks: string[];
  missing_artifacts: string[];
  artifact_ids: string[];
  waiver_reason: string | null;
  self_approved: boolean;
  note: string | null;
  created_at: string;
};
