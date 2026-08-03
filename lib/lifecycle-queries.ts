// Server-side read helpers for the lifecycle. Deliberately NOT a 'use server'
// module: every export from one of those becomes a callable server action, and
// these are only ever used from Server Components.

import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {
  LifecyclePhaseRow,
  PhaseArtifact,
  PhaseTransition
} from '@/lib/actions/lifecycle';
import {LIFECYCLE_PHASES, type LifecyclePhase, type RiskTier} from '@/lib/lifecycle';

const PHASE_COLUMNS =
  'id, product_id, cycle, phase, state, owner_id, notes, entered_at, completed_at, updated_at';

const ARTIFACT_COLUMNS =
  'id, phase_id, artifact_type, title, storage_url, storage_key, file_name, mime_type, size_bytes, url, knowledge_item_id, notes, generated_by, uploader_id, github_path, github_commit_sha, github_synced_at, github_sync_error, github_sync_state, created_at';

const TRANSITION_COLUMNS =
  'id, product_id, cycle, phase, from_state, to_state, actor_id, risk_tier_at_time, missing_artifacts, waiver_reason, self_approved, created_at';

// One row of product_lifecycle_overview — the /governance projection.
export type LifecycleOverviewRow = {
  product_id: string;
  name: string;
  slug: string;
  stage: string;
  risk_tier: RiskTier;
  owner_id: string;
  owner_name: string | null;
  archived_at: string | null;
  cycle: number | null;
  current_phase: LifecyclePhase | null;
  current_state: string | null;
  current_phase_entered_at: string | null;
  days_in_current_phase: number;
  phases_complete: number;
  missing_required_count: number;
  is_blocked: boolean | null;
};

// Ordered phase rows plus their artifacts for one product, in two round trips.
// Artifacts come back as a plain Record because the result crosses into Client
// Components, where a Map is not serializable.
export async function loadProductLifecycle(productId: string): Promise<{
  phases: LifecyclePhaseRow[];
  artifacts: Record<string, PhaseArtifact[]>;
}> {
  const insforge = await createInsForgeServerClient();
  const {data: phases} = await insforge.database
    .from('product_lifecycle_phases')
    .select(PHASE_COLUMNS)
    .eq('product_id', productId);

  // Phase order is vocabulary, not data — sort in code rather than paying for
  // an ORDER BY on the function index.
  const rows = ((phases ?? []) as unknown as LifecyclePhaseRow[]).sort(
    (a, b) =>
      a.cycle - b.cycle ||
      LIFECYCLE_PHASES.indexOf(a.phase) - LIFECYCLE_PHASES.indexOf(b.phase)
  );

  const artifacts: Record<string, PhaseArtifact[]> = {};
  const phaseIds = rows.map((row) => row.id);
  if (phaseIds.length === 0) return {phases: rows, artifacts};

  const {data: artifactRows} = await insforge.database
    .from('phase_artifacts')
    .select(ARTIFACT_COLUMNS)
    .in('phase_id', phaseIds)
    .order('created_at', {ascending: true});

  const artifactList = (artifactRows ?? []) as unknown as PhaseArtifact[];

  // The knowledge item each artifact was mirrored into, so the phase panel can
  // link forward the same way the knowledge card links back. One extra query
  // for the whole product rather than one per artifact.
  const artifactIds = artifactList.map((artifact) => artifact.id);
  const mirrors = new Map<string, string>();
  if (artifactIds.length > 0) {
    const {data: mirrorRows} = await insforge.database
      .from('knowledge_items')
      .select('id, source_artifact_id')
      .in('source_artifact_id', artifactIds);
    for (const row of mirrorRows ?? []) {
      mirrors.set(row.source_artifact_id as string, row.id as string);
    }
  }

  for (const artifact of artifactList) {
    (artifacts[artifact.phase_id] ??= []).push({
      ...artifact,
      knowledge_mirror_id: mirrors.get(artifact.id) ?? null
    });
  }

  return {phases: rows, artifacts};
}

export async function loadLifecycleOverview(): Promise<LifecycleOverviewRow[]> {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('product_lifecycle_overview')
    .select('*')
    .is('archived_at', null);

  return ((data ?? []) as unknown as LifecycleOverviewRow[]).sort(
    (a, b) =>
      b.missing_required_count - a.missing_required_count ||
      a.name.localeCompare(b.name)
  );
}

export async function loadPhaseTransitions(
  limit = 50
): Promise<PhaseTransition[]> {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('phase_transitions')
    .select(TRANSITION_COLUMNS)
    .order('created_at', {ascending: false})
    .limit(limit);

  return (data ?? []) as unknown as PhaseTransition[];
}

// The waiver register: completions that shipped with known gaps.
export async function loadWaivers(limit = 50): Promise<PhaseTransition[]> {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('phase_transitions')
    .select(TRANSITION_COLUMNS)
    .not('waiver_reason', 'is', null)
    .order('created_at', {ascending: false})
    .limit(limit);

  return (data ?? []) as unknown as PhaseTransition[];
}
