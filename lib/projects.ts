// Projects: a consultation engagement, from kickoff to close. A project is never
// a product. An idea that comes out of one is captured as a product at Idea.
//
// IMPORTANT: this file MIRRORS the phase rules in
// migrations/20261027102000_add-projects.sql (move_project_phase(),
// project_overview). Change both together.

export const PROJECT_PHASES = [
  'kickoff',
  'discovery',
  'delivery',
  'handover',
  'closed'
] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export function isProjectPhase(value: string): value is ProjectPhase {
  return (PROJECT_PHASES as readonly string[]).includes(value);
}

// A project with no task or log activity for this long is stale.
export const PROJECT_STALE_DAYS = 14;

// Closing is the one move that needs a note: the outcome.
export function requiresOutcomeNote(to: ProjectPhase): boolean {
  return to === 'closed';
}

// Who an account's project is for, as the engagement records it.
export const CODE_OWNERSHIPS = [
  'client',
  'code92_full',
  'code92_partial'
] as const;
export type CodeOwnership = (typeof CODE_OWNERSHIPS)[number];

// One row of project_overview: the engagement, its phase, and what keeps it
// moving. Staleness is computed in the view, not here.
export type ProjectOverview = {
  id: string;
  name: string;
  account_id: string;
  account_name: string;
  deal_id: string | null;
  owner_id: string;
  owner_name: string | null;
  ownership: CodeOwnership | null;
  phase: ProjectPhase;
  start_date: string;
  target_end_date: string | null;
  closed_at: string | null;
  outcome_note: string | null;
  created_at: string;
  updated_at: string;
  is_open: boolean;
  last_activity_at: string;
  is_stale: boolean;
  task_count: number;
  open_task_count: number;
  idea_count: number;
  channel_id: string | null;
};
