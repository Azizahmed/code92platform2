import {getTranslations} from 'next-intl/server';

import ProjectPhaseChip from '@/components/projects/ProjectPhaseChip';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import type {ProjectOverview} from '@/lib/projects';

// The projects list: one row per engagement, with the phase it is in, who owns
// it, and whether it has gone quiet. Stale rows are flagged, not hidden.
export default async function ProjectsList({
  projects,
  locale
}: {
  projects: ProjectOverview[];
  locale: string;
}) {
  const t = await getTranslations('projects');
  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});

  if (projects.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline px-4 py-10 text-center text-xs text-faint">{t('list.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.name')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.account')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.owner')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.phase')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.dates')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.activity')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('list.columns.work')}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="border-b border-hairline last:border-0 hover:bg-raised/40">
              <td className="px-4 py-3">
                <Link href={`/projects/${project.id}`} className="font-medium text-ink hover:text-accent">
                  {project.name}
                </Link>
                {project.is_stale ? (
                  <span className="ms-2 rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber">
                    {t('list.stale')}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-muted">{project.account_name}</td>
              <td className="px-4 py-3 text-muted">{project.owner_name ?? '—'}</td>
              <td className="px-4 py-3"><ProjectPhaseChip phase={project.phase} /></td>
              <td className="px-4 py-3 font-mono text-[11px] text-faint">
                {dateFormat.format(new Date(`${project.start_date}T00:00:00`))}
                {project.target_end_date
                  ? ` → ${dateFormat.format(new Date(`${project.target_end_date}T00:00:00`))}`
                  : ''}
              </td>
              <td className="px-4 py-3 text-xs text-faint"><RelativeTime date={project.last_activity_at} /></td>
              <td className="px-4 py-3 font-mono text-[11px] text-muted">
                {t('list.work', {open: project.open_task_count, ideas: project.idea_count})}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
