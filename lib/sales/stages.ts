// Client-side mirror of the deal stage rules enforced by
// public.move_deal_stage(). The database is the authority; this lets the UI
// ask for a reason or ownership BEFORE calling the RPC instead of failing.
// tests/unit/stages.test.ts and tests/sql/20_sales_stages.test.sql pin both
// sides to the same matrix.

import {addDays, daysBetween} from '@/lib/dates';

export const DEAL_STAGES = [
  'lead',
  'meeting',
  'discovery_demo',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost'
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const OPEN_STAGES = DEAL_STAGES.slice(0, 5) as readonly DealStage[];

export const DEAL_TYPES = ['product', 'consultation'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_SOURCES = [
  'referral',
  'inbound',
  'outbound',
  'operator_introduced'
] as const;
export type DealSource = (typeof DEAL_SOURCES)[number];

export const OWNERSHIP_OPTIONS = [
  'client',
  'code92_full',
  'code92_partial'
] as const;
export type Ownership = (typeof OWNERSHIP_OPTIONS)[number];

export const STALE_AFTER_DAYS = 7;

export function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGES as readonly string[]).includes(value);
}

export function stageRank(stage: DealStage): number {
  return stage === 'closed_lost' ? 6 : DEAL_STAGES.indexOf(stage) + 1;
}

export function isClosed(stage: DealStage): boolean {
  return stage === 'closed_won' || stage === 'closed_lost';
}

// Backward = lower rank, or any move out of a closed stage (reopen).
export function isBackward(from: DealStage, to: DealStage): boolean {
  return isClosed(from) || stageRank(to) < stageRank(from);
}

export function requiresReason(from: DealStage, to: DealStage): boolean {
  return isBackward(from, to) || to === 'closed_lost';
}

export function requiresOwnership(type: DealType, to: DealStage): boolean {
  return type === 'consultation' && to === 'closed_won';
}

export type StaleInput = {
  stage: DealStage;
  next_action: string | null;
  next_action_date: string | null;
  next_action_updated_at: string;
};

// Same definition as deal_overview.is_stale.
export function isStale(deal: StaleInput, today: string, now = new Date()): boolean {
  if (isClosed(deal.stage)) return false;
  if (deal.next_action_date && daysBetween(deal.next_action_date, today) > STALE_AFTER_DAYS) {
    return true;
  }
  if (!deal.next_action) {
    const since = new Date(deal.next_action_updated_at).getTime();
    return now.getTime() - since > STALE_AFTER_DAYS * 86_400_000;
  }
  return false;
}

// Date after which a deal with this next-action date becomes stale.
export function staleFrom(nextActionDate: string): string {
  return addDays(nextActionDate, STALE_AFTER_DAYS + 1);
}
