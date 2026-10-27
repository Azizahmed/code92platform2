// The business track: the Code92 funnel a product moves through, from the pitch
// deck, and the two gates on it.
//
//   Idea → Concept ‖ Gate 1 ‖ Build → Venture ‖ Gate 2 ‖ Company → Board
//
// IMPORTANT: this file MIRRORS the SQL in
// migrations/20261027100000_add-business-track.sql — business_stage_index(),
// move_business_stage(), record_gate_decision() and business_checklist_defaults().
// The database is authoritative. This copy lets the UI say what a move needs
// before it is submitted. Change both together.

export const BUSINESS_STAGES = [
  'idea',
  'concept',
  'build',
  'venture',
  'company',
  'board'
] as const;
export type BusinessStage = (typeof BUSINESS_STAGES)[number];

export function isBusinessStage(value: string): value is BusinessStage {
  return (BUSINESS_STAGES as readonly string[]).includes(value);
}

export function businessStageIndex(stage: BusinessStage): number {
  return BUSINESS_STAGES.indexOf(stage) + 1;
}

export function nextBusinessStage(stage: BusinessStage): BusinessStage | null {
  return BUSINESS_STAGES[BUSINESS_STAGES.indexOf(stage) + 1] ?? null;
}

// Gates sit on two edges of the funnel and are the only hard blocks in it.
export type GateNumber = 1 | 2;

// The gate a stage is waiting on a decision for: Concept waits on Gate 1,
// Venture on Gate 2.
export function gateWaitingAt(stage: BusinessStage): GateNumber | null {
  if (stage === 'concept') return 1;
  if (stage === 'venture') return 2;
  return null;
}

// What a forward move still needs, in the order the database checks it. The
// strings are keys the UI translates; an empty list means the move can go.
export type MoveBlocker = 'operator' | 'gate1Go' | 'gate2Go';

export function movementBlockers(input: {
  from: BusinessStage;
  to: BusinessStage;
  operatorName: string | null;
  gate1Outcome: 'go' | 'no_go' | null;
  gate2Outcome: 'go' | 'no_go' | null;
}): MoveBlocker[] {
  if (businessStageIndex(input.to) <= businessStageIndex(input.from)) return [];
  const blockers: MoveBlocker[] = [];
  if (input.to === 'build') {
    if (!input.operatorName?.trim()) blockers.push('operator');
    if (input.gate1Outcome !== 'go') blockers.push('gate1Go');
  }
  if (input.to === 'company' && input.gate2Outcome !== 'go') {
    blockers.push('gate2Go');
  }
  return blockers;
}

export const ORIGINATIONS = [
  'discovery',
  'operator_brought',
  'bench_built'
] as const;
export type Origination = (typeof ORIGINATIONS)[number];

export const OWNERSHIPS = ['code92_full', 'co_owned', 'client'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

// Checklist defaults, seeded per stage. `key` is what the UI translates; the
// label is the English fallback the database also stores.
export const CHECKLIST_DEFAULTS: Record<
  BusinessStage,
  readonly {key: string; label: string}[]
> = {
  idea: [
    {key: 'problem_statement', label: 'Problem statement'},
    {key: 'source', label: 'Source of the idea'},
    {key: 'first_screen_decision', label: 'First-screen decision'}
  ],
  concept: [
    {key: 'problem_validated', label: 'Problem validated'},
    {key: 'business_case', label: 'Business case'},
    {key: 'operator_identified', label: 'Operator identified'},
    {key: 'ownership_agreed', label: 'Ownership agreed'}
  ],
  build: [
    {key: 'gtm_plan', label: 'Go-to-market plan'},
    {key: 'pricing', label: 'Pricing'},
    {key: 'first_customer_target', label: 'First customer target'},
    {key: 'contracts_template', label: 'Contracts template'}
  ],
  venture: [
    {key: 'first_customers', label: 'First customers'},
    {key: 'revenue_tracking', label: 'Revenue tracking'},
    {key: 'pmf_criteria_defined', label: 'PMF criteria defined'}
  ],
  company: [
    {key: 'own_team_plan', label: 'Own team plan'},
    {key: 'own_pnl', label: 'Own P&L'},
    {key: 'bench_exit_plan', label: 'Bench exit plan'}
  ],
  board: [
    {key: 'board_seat_recorded', label: 'Board seat recorded'},
    {key: 'reporting_cadence', label: 'Reporting cadence'}
  ]
};
