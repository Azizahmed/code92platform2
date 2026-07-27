// Shared implementation-lifecycle vocabulary. Kept out of the 'use server'
// action module so client components can import the constants themselves, not
// just the types.
//
// IMPORTANT: this file MIRRORS the SQL in
// migrations/20260727192151_add-product-lifecycle.sql — specifically
// lifecycle_phase_index(), lifecycle_phase_artifact_types() and
// lifecycle_required_artifacts(). The database is authoritative: it is what
// advance_lifecycle_phase() enforces, and product_lifecycle_phases grants no
// INSERT/UPDATE to clients. This copy exists so the UI can show which artifacts
// are still missing *before* submitting. Change both together.

export const LIFECYCLE_PHASES = [
  'ideation',
  'requirements',
  'plan',
  'code_test',
  'deploy',
  'monitor'
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const LIFECYCLE_STATES = [
  'not_started',
  'in_progress',
  'blocked',
  'complete'
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export function phaseIndex(phase: LifecyclePhase): number {
  return LIFECYCLE_PHASES.indexOf(phase) + 1;
}

// Which artifact types may be filed against each phase. The names follow the
// controls in Anthropic's AI-native SDLC writeup: a Project Security Review
// (psr) at Plan, security review + test evidence at Code & Testing, DAST at
// Deploy, post-mortems at Monitor.
export const PHASE_ARTIFACT_TYPES = {
  ideation: ['concept_brief', 'research_note', 'other'],
  requirements: ['prd', 'threat_model', 'data_classification', 'other'],
  plan: ['design_doc', 'psr', 'architecture_decision', 'other'],
  code_test: ['security_review', 'test_report', 'review_evidence', 'other'],
  deploy: ['deploy_checklist', 'dast_scan', 'pentest_report', 'other'],
  monitor: ['runbook', 'postmortem', 'metrics_report', 'other']
} as const satisfies Record<LifecyclePhase, readonly string[]>;

export type ArtifactType =
  (typeof PHASE_ARTIFACT_TYPES)[LifecyclePhase][number];

export const ALL_ARTIFACT_TYPES = [
  ...new Set(Object.values(PHASE_ARTIFACT_TYPES).flat())
] as ArtifactType[];

export function artifactTypesForPhase(
  phase: LifecyclePhase
): readonly ArtifactType[] {
  return PHASE_ARTIFACT_TYPES[phase];
}

export function isArtifactTypeForPhase(
  phase: LifecyclePhase,
  artifactType: string
): artifactType is ArtifactType {
  return (artifactTypesForPhase(phase) as readonly string[]).includes(
    artifactType
  );
}

// Which of those are REQUIRED before a phase may be completed, by risk tier.
// Low-risk products require nothing anywhere — the tier exists so small
// internal tools stay frictionless while high-risk ones cannot ship unreviewed.
const REQUIRED_ARTIFACTS: Record<
  LifecyclePhase,
  Record<RiskTier, readonly ArtifactType[]>
> = {
  ideation: {low: [], medium: [], high: []},
  requirements: {
    low: [],
    medium: ['prd'],
    high: ['prd', 'threat_model']
  },
  plan: {
    low: [],
    medium: ['design_doc'],
    high: ['design_doc', 'psr']
  },
  code_test: {
    low: [],
    medium: ['test_report'],
    high: ['test_report', 'security_review']
  },
  deploy: {
    low: [],
    medium: ['deploy_checklist'],
    high: ['deploy_checklist', 'dast_scan']
  },
  monitor: {low: [], medium: [], high: ['runbook']}
};

export function requiredArtifacts(
  phase: LifecyclePhase,
  riskTier: RiskTier
): readonly ArtifactType[] {
  return REQUIRED_ARTIFACTS[phase][riskTier];
}

export function missingArtifacts(
  phase: LifecyclePhase,
  riskTier: RiskTier,
  presentTypes: readonly string[]
): ArtifactType[] {
  const present = new Set(presentTypes);
  return requiredArtifacts(phase, riskTier).filter(
    (type) => !present.has(type)
  );
}

// A high-risk product cannot complete a phase with gaps unless an admin writes
// down why. Low and medium advance with the gap recorded instead of blocked.
export function requiresWaiver(
  riskTier: RiskTier,
  missing: readonly string[]
): boolean {
  return riskTier === 'high' && missing.length > 0;
}

// High-risk products are an admin-only surface end to end.
export function canAdvancePhase(opts: {
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

// Phase artifacts live in a private bucket: readers get short-lived signed
// URLs, never a stored public link. Mirrors the knowledge-files setup.
export const LIFECYCLE_FILE_BUCKET = 'lifecycle-artifacts';
export const MAX_LIFECYCLE_FILE_BYTES = 25 * 1024 * 1024;
