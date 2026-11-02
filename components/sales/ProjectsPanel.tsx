import {getTranslations} from 'next-intl/server';

import ProjectPhaseChip from '@/components/projects/ProjectPhaseChip';
import {Link} from '@/i18n/navigation';
import {formatDay} from '@/lib/dates';
import {isProjectPhase, type ProjectOverview} from '@/lib/projects';

// The account's projects. A consultation win opens one; a project can also be
// opened straight from the account, which is what the link at the foot does.
export default async function ProjectsPanel({
  projects,
  accountId,
  locale
}: {
  projects: ProjectOverview[];
  accountId: string;
  locale: string;
}) {
  const t = await getTranslations('sales');
  return (
    <div className="space-y-3">
      {projects.length === 0 ? (
        <p className="text-xs text-faint">{t('engagements.none')}</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project.id} className="rounded-md border border-hairline px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/projects/${project.id}`} className="text-sm text-ink hover:text-accent">
                  {project.name}
                </Link>
                {isProjectPhase(project.phase) ? <ProjectPhaseChip phase={project.phase} /> : null}
                {project.is_stale ? (
                  <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber">
                    {t('engagements.stale')}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-muted">
                {t(`ownership.${project.ownership ?? 'client'}`)} ·{' '}
                <span className="font-mono">{formatDay(project.start_date, locale)}</span>
                {project.deal_id ? (
                  <>
                    {' · '}
                    <Link href={`/sales/deals/${project.deal_id}`} className="hover:text-accent">
                      {t('engagements.fromDeal')}
                    </Link>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link href={`/projects/new?account=${accountId}`} className="inline-flex text-xs text-accent hover:underline">
        {t('engagements.newProject')}
      </Link>
    </div>
  );
}
