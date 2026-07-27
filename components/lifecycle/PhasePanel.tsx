'use client';

import {Check, Plus, Trash2, TriangleAlert} from 'lucide-react';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import ArtifactLink from '@/components/lifecycle/ArtifactLink';
import AdvanceGateDialog from '@/components/lifecycle/AdvanceGateDialog';
import PhaseArtifactForm, {
  type KnowledgeOption
} from '@/components/lifecycle/PhaseArtifactForm';
import RelativeTime from '@/components/RelativeTime';
import {
  advanceLifecyclePhaseAction,
  deletePhaseArtifactAction,
  setLifecyclePhaseDetailsAction,
  type LifecyclePhaseRow,
  type PhaseArtifact
} from '@/lib/actions/lifecycle';
import {removeArtifactFile} from '@/lib/lifecycle-upload';
import {
  LIFECYCLE_STATES,
  missingArtifacts,
  requiredArtifacts,
  type LifecycleState,
  type RiskTier
} from '@/lib/lifecycle';

const STATE_CHIP: Record<LifecycleState, string> = {
  complete: 'border-accent/40 bg-accent/10 text-accent',
  in_progress: 'border-accent/30 bg-accent/5 text-accent',
  blocked: 'border-danger/40 bg-danger/10 text-danger',
  not_started: 'border-hairline bg-raised text-faint'
};

export default function PhasePanel({
  row,
  artifacts,
  riskTier,
  canEdit,
  knowledgeOptions,
  memberNames
}: {
  row: LifecyclePhaseRow;
  artifacts: PhaseArtifact[];
  riskTier: RiskTier;
  canEdit: boolean;
  knowledgeOptions: KnowledgeOption[];
  memberNames: Record<string, string>;
}) {
  const t = useTranslations('lifecycle');
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [gateOpen, setGateOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const present = artifacts.map((artifact) => artifact.artifact_type);
  const required = requiredArtifacts(row.phase, riskTier);
  const missing = missingArtifacts(row.phase, riskTier, present);
  const notesDirty = notes.trim() !== (row.notes ?? '').trim();

  function applyState(state: LifecycleState, waiverReason: string | null) {
    setErrorKey(null);
    startTransition(async () => {
      const result = await advanceLifecyclePhaseAction(
        row.id,
        state,
        waiverReason
      );
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setGateOpen(false);
    });
  }

  function handleStateClick(state: LifecycleState) {
    // Only completion runs the gate; the rest are free moves.
    if (state === 'complete' && missing.length > 0) {
      setErrorKey(null);
      setGateOpen(true);
      return;
    }
    applyState(state, null);
  }

  function handleSaveNotes() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await setLifecyclePhaseDetailsAction(
        row.id,
        row.owner_id,
        notes.trim() === '' ? null : notes.trim()
      );
      if (!result.ok) setErrorKey(result.error);
    });
  }

  function handleDeleteArtifact(artifact: PhaseArtifact) {
    setErrorKey(null);
    startTransition(async () => {
      const result = await deletePhaseArtifactAction(artifact.id);
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      // Row is gone; drop the storage object it referenced.
      if (result.storageKey) await removeArtifactFile(result.storageKey);
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-hairline bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t(`phases.${row.phase}`)}</h3>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATE_CHIP[row.state]}`}
            >
              {t(`states.${row.state}`)}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {t(`phaseHints.${row.phase}`)}
          </p>
        </div>
        {row.completed_at ? (
          <span className="shrink-0 text-[11px] text-faint">
            <RelativeTime date={row.completed_at} />
          </span>
        ) : row.entered_at ? (
          <span className="shrink-0 text-[11px] text-faint">
            <RelativeTime date={row.entered_at} />
          </span>
        ) : null}
      </div>

      {/* Required-artifact checklist — the gate, made visible before you hit it. */}
      <div className="rounded-md border border-hairline bg-bg/50 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">
          {t('gate.required')}
        </div>
        {required.length === 0 ? (
          <p className="text-xs text-faint">{t('gate.noneRequired')}</p>
        ) : (
          <ul className="space-y-1.5">
            {required.map((type) => {
              const satisfied = present.includes(type);
              return (
                <li
                  key={type}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {satisfied ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                        strokeWidth={2.5}
                      />
                    ) : (
                      <TriangleAlert
                        className="h-3.5 w-3.5 shrink-0 text-amber"
                        strokeWidth={2}
                      />
                    )}
                    <span className="truncate text-muted">
                      {t(`artifacts.types.${type}`)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                      satisfied ? 'text-accent' : 'text-amber'
                    }`}
                  >
                    {t(satisfied ? 'gate.present' : 'gate.absent')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Artifacts */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted">
            {t('artifacts.heading')}
          </h4>
          {canEdit && !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              {t('artifacts.add')}
            </button>
          ) : null}
        </div>

        {artifacts.length === 0 && !adding ? (
          <p className="text-xs text-faint">{t('artifacts.none')}</p>
        ) : null}

        {artifacts.length > 0 ? (
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-hairline bg-bg/40 p-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                      {t(`artifacts.types.${artifact.artifact_type}`)}
                    </span>
                    {artifact.generated_by === 'agent' ? (
                      <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                        {t('artifacts.byAgent')}
                      </span>
                    ) : null}
                  </div>
                  <ArtifactLink artifact={artifact} />
                  {artifact.notes ? (
                    <p dir="auto" className="text-[11px] leading-relaxed text-faint">
                      {artifact.notes}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-faint">
                    {t('artifacts.uploadedBy', {
                      name: memberNames[artifact.uploader_id] ?? '—'
                    })}{' '}
                    · <RelativeTime date={artifact.created_at} />
                  </p>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteArtifact(artifact)}
                    disabled={pending}
                    aria-label={t('artifacts.delete')}
                    title={t('artifacts.delete')}
                    className="shrink-0 rounded-md border border-hairline p-1.5 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {adding ? (
          <PhaseArtifactForm
            phaseId={row.id}
            phase={row.phase}
            knowledgeOptions={knowledgeOptions}
            onDone={() => setAdding(false)}
          />
        ) : null}
      </div>

      {/* Notes + state controls */}
      {canEdit ? (
        <div className="space-y-3 border-t border-hairline pt-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">
              {t('artifacts.notesLabel')}
            </span>
            <textarea
              rows={2}
              maxLength={5000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('artifacts.notesPlaceholder')}
              className="w-full resize-y rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
            />
          </label>
          {notesDirty ? (
            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={pending}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {t('artifacts.submit')}
            </button>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {LIFECYCLE_STATES.filter((state) => state !== row.state).map(
              (state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => handleStateClick(state)}
                  disabled={pending}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    state === 'complete'
                      ? 'border-accent/40 text-accent hover:bg-accent/10'
                      : state === 'blocked'
                        ? 'border-danger/30 text-danger hover:bg-danger/10'
                        : 'border-hairline text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  {t(`stateActions.${state}`)}
                </button>
              )
            )}
          </div>
        </div>
      ) : null}

      {errorKey && !gateOpen ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      {gateOpen ? (
        <AdvanceGateDialog
          phase={row.phase}
          riskTier={riskTier}
          missing={missing}
          pending={pending}
          errorKey={errorKey}
          onConfirm={(reason) => applyState('complete', reason)}
          onCancel={() => {
            setGateOpen(false);
            setErrorKey(null);
          }}
        />
      ) : null}
    </div>
  );
}
