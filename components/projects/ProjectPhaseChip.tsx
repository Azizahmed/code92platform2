import {getTranslations} from 'next-intl/server';

import type {ProjectPhase} from '@/lib/projects';

const STYLE: Record<ProjectPhase, string> = {
  kickoff: 'border-hairline bg-raised text-muted',
  discovery: 'border-accent/25 bg-accent/10 text-accent',
  delivery: 'border-accent/30 bg-accent/15 text-accent',
  handover: 'border-amber/30 bg-amber/10 text-amber',
  closed: 'border-hairline bg-raised text-faint'
};

export default async function ProjectPhaseChip({phase}: {phase: ProjectPhase}) {
  const t = await getTranslations('projects');
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STYLE[phase]}`}>
      {t(`phases.${phase}`)}
    </span>
  );
}
