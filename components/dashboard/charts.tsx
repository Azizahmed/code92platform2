'use client';

import {useLocale, useTranslations} from 'next-intl';
import {useEffect, useRef, useState} from 'react';

import {Link} from '@/i18n/navigation';
import {niceTicks, type WeekPoint, type WorkloadRow} from '@/lib/dashboard';

// Chart colours are the app's own tokens, so both themes follow the toggle.
// Pairs used together were checked with the dataviz validator: accent + amber
// (workload) and accent / grey / danger (status, with grey between green and
// red and a labelled legend as the second channel).
const COLOR = {
  accent: 'rgb(var(--color-accent))',
  amber: 'rgb(var(--color-amber))',
  danger: 'rgb(var(--color-danger))',
  muted: 'rgb(var(--color-muted))',
  faint: 'rgb(var(--color-faint))',
  grid: 'rgb(var(--color-hairline))',
  surface: 'rgb(var(--color-panel))'
} as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function weekLabel(start: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(
    new Date(`${start}T00:00:00Z`)
  );
}

// ------------------------------------------------------------
// Created vs completed, weekly — two lines on one axis
// ------------------------------------------------------------

export function TrendChart({weeks}: {weeks: WeekPoint[]}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const pad = {top: 12, right: 40, bottom: 26, left: 32};
  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(1, ...weeks.map((week) => Math.max(week.created, week.completed))));
  const max = ticks[ticks.length - 1];
  const x = (index: number) => pad.left + (weeks.length <= 1 ? 0 : (index / (weeks.length - 1)) * plotWidth);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const series = [
    {key: 'created', color: COLOR.muted, values: weeks.map((week) => week.created)},
    {key: 'completed', color: COLOR.accent, values: weeks.map((week) => week.completed)}
  ] as const;
  const path = (values: readonly number[]) =>
    values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const labelEvery = width < 420 ? 3 : 2;
  const last = weeks.length - 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{background: item.color}} />
            {t(`charts.trend.${item.key}`)}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative" dir="ltr">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={t('charts.trend.label')}
            onPointerMove={(event) => {
              const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
              const relative = event.clientX - rect.left - pad.left;
              const index = Math.round((relative / Math.max(1, plotWidth)) * last);
              setHover(Math.max(0, Math.min(last, index)));
            }}
            onPointerLeave={() => setHover(null)}
            className="block touch-pan-y"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={COLOR.grid} strokeWidth={1} />
                <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-faint font-mono text-[10px]">
                  {tick}
                </text>
              </g>
            ))}
            {weeks.map((week, index) =>
              index % labelEvery === (last % labelEvery) ? (
                <text key={week.start} x={x(index)} y={height - 8} textAnchor="middle" className="fill-faint text-[10px]">
                  {weekLabel(week.start, locale)}
                </text>
              ) : null
            )}
            {hover !== null ? (
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotHeight} stroke={COLOR.faint} strokeWidth={1} />
            ) : null}
            {series.map((item) => (
              <g key={item.key}>
                <path d={path(item.values)} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(last)} cy={y(item.values[last])} r={4} fill={item.color} stroke={COLOR.surface} strokeWidth={2} />
                <text x={x(last) + 9} y={y(item.values[last])} dy="0.32em" className="fill-muted font-mono text-[11px]">
                  {item.values[last]}
                </text>
                {hover !== null ? (
                  <circle cx={x(hover)} cy={y(item.values[hover])} r={4} fill={item.color} stroke={COLOR.surface} strokeWidth={2} />
                ) : null}
              </g>
            ))}
          </svg>
        ) : (
          <div style={{height}} />
        )}
        {hover !== null && width > 0 ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-[140px] rounded-md border border-hairline bg-panel px-3 py-2 text-xs shadow-xl"
            style={{
              left: Math.min(Math.max(0, x(hover) + 12), width - 150)
            }}
          >
            <div className="mb-1 text-[11px] text-faint">{t('charts.trend.weekOf', {date: weekLabel(weeks[hover].start, locale)})}</div>
            {series.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{background: item.color}} />
                  {t(`charts.trend.${item.key}`)}
                </span>
                <span className="font-mono text-ink">{item.values[hover]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{t('charts.trend.label')}</caption>
        <thead>
          <tr>
            <th>{t('charts.trend.week')}</th>
            <th>{t('charts.trend.created')}</th>
            <th>{t('charts.trend.completed')}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.start}>
              <td>{week.start}</td>
              <td>{week.created}</td>
              <td>{week.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------
// Sparkline for a stat tile — trend in grey, now in accent
// ------------------------------------------------------------

export function Sparkline({values, label}: {values: number[]; label: string}) {
  const width = 96;
  const height = 28;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const x = (index: number) => 2 + (index / Math.max(1, values.length - 1)) * (width - 6);
  const y = (value: number) => 3 + (height - 6) - ((value - min) / span) * (height - 6);
  const d = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="block shrink-0">
      <path d={d} fill="none" stroke={COLOR.faint} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last] ?? 0)} r={3} fill={COLOR.accent} stroke={COLOR.surface} strokeWidth={1.5} />
    </svg>
  );
}

// ------------------------------------------------------------
// Open work by status — one whole split into parts
// ------------------------------------------------------------

export function StatusSplit({
  byStatus
}: {
  byStatus: {todo: number; in_progress: number; blocked: number};
}) {
  const t = useTranslations('dashboard');
  const tTasks = useTranslations('tasks');
  // Grey sits between green and red so the two never touch.
  const parts = [
    {key: 'in_progress', value: byStatus.in_progress, color: COLOR.accent, href: '/tasks?status=in_progress'},
    {key: 'todo', value: byStatus.todo, color: COLOR.faint, href: '/tasks?status=todo'},
    {key: 'blocked', value: byStatus.blocked, color: COLOR.danger, href: '/tasks?status=blocked'}
  ] as const;
  const total = parts.reduce((sum, part) => sum + part.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold text-ink">{total}</span>
        <span className="text-xs text-muted">{t('charts.status.openTasks')}</span>
      </div>
      <div
        role="img"
        aria-label={parts.map((part) => `${tTasks(`status.${part.key}`)} ${part.value}`).join(', ')}
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-raised"
      >
        {total > 0
          ? parts
              .filter((part) => part.value > 0)
              .map((part) => (
                <span
                  key={part.key}
                  title={`${tTasks(`status.${part.key}`)}: ${part.value}`}
                  className="h-full first:rounded-s-full last:rounded-e-full"
                  style={{width: `${(part.value / total) * 100}%`, background: part.color}}
                />
              ))
          : null}
      </div>
      <ul className="space-y-1">
        {parts.map((part) => (
          <li key={part.key}>
            <Link
              href={part.href}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-raised"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{background: part.color}} />
              <span className="flex-1 text-muted">{tTasks(`status.${part.key}`)}</span>
              <span className="font-mono text-ink">{part.value}</span>
              <span className="w-10 text-end font-mono text-[11px] text-faint">
                {total > 0 ? `${Math.round((part.value / total) * 100)}%` : '–'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Workload — open tasks per person, on track vs overdue
// ------------------------------------------------------------

export function WorkloadChart({
  rows,
  names,
  currentUserId
}: {
  rows: WorkloadRow[];
  names: Record<string, string>;
  currentUserId: string;
}) {
  const t = useTranslations('dashboard');
  const shown = rows.slice(0, 8);
  const max = Math.max(1, ...shown.map((row) => row.onTrack + row.overdue));

  if (shown.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">{t('charts.workload.empty')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{background: COLOR.accent}} />
          {t('charts.workload.onTrack')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{background: COLOR.amber}} />
          {t('charts.workload.overdue')}
        </span>
      </div>
      <ul className="space-y-1">
        {shown.map((row) => {
          const total = row.onTrack + row.overdue;
          const name = row.userId
            ? row.userId === currentUserId
              ? t('charts.workload.you', {name: names[row.userId] ?? ''})
              : names[row.userId] ?? t('charts.workload.former')
            : t('charts.workload.unassigned');
          const href = `/tasks?assignee=${row.userId === currentUserId ? 'me' : row.userId ?? 'none'}`;
          return (
            <li key={row.userId ?? 'none'}>
              <Link
                href={href}
                title={t('charts.workload.tooltip', {name, onTrack: row.onTrack, overdue: row.overdue})}
                className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2rem] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-raised"
              >
                <span className={`truncate text-xs ${row.userId ? 'text-muted' : 'italic text-faint'}`}>{name}</span>
                <span className="flex h-2.5 gap-[2px]" style={{width: `${(total / max) * 100}%`}}>
                  {row.onTrack > 0 ? (
                    <span
                      className="h-full rounded-s-sm last:rounded-e-[4px]"
                      style={{flex: row.onTrack, background: COLOR.accent}}
                    />
                  ) : null}
                  {row.overdue > 0 ? (
                    <span
                      className="h-full rounded-e-[4px] first:rounded-s-sm"
                      style={{flex: row.overdue, background: COLOR.amber}}
                    />
                  ) : null}
                </span>
                <span className="text-end font-mono text-xs text-ink">{total}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length ? (
        <p className="text-[11px] text-faint">{t('charts.workload.more', {count: rows.length - shown.length})}</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// A pipeline: ordered stages as one-hue bars, each a link
// ------------------------------------------------------------

export type StageRow = {key: string; label: string; value: number; href: string};

export function StageBars({
  rows,
  attention
}: {
  rows: StageRow[];
  attention?: {label: string; value: number; href: string};
}) {
  const t = useTranslations('dashboard');
  const max = Math.max(1, ...rows.map((row) => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="flex h-full flex-col gap-3">
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2rem] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-raised"
            >
              <span className="truncate text-xs text-muted">{row.label}</span>
              <span className="h-2 overflow-hidden rounded-e-[4px]">
                {row.value > 0 ? (
                  <span
                    className="block h-full rounded-e-[4px]"
                    style={{width: `${Math.max(4, (row.value / max) * 100)}%`, background: COLOR.accent, opacity: 0.85}}
                  />
                ) : (
                  <span className="block h-px translate-y-[3px] bg-hairline" />
                )}
              </span>
              <span className={`text-end font-mono text-xs ${row.value > 0 ? 'text-ink' : 'text-faint'}`}>{row.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-3 text-xs">
        <span className="text-faint">{t('charts.total', {count: total})}</span>
        {attention ? (
          <Link
            href={attention.href}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${
              attention.value > 0
                ? 'border-amber/30 bg-amber/10 text-amber hover:bg-amber/15'
                : 'border-hairline text-faint hover:text-muted'
            }`}
          >
            <span className="font-mono">{attention.value}</span>
            {attention.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
