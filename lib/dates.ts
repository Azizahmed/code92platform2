// The team works on the Kuwait calendar. Due dates, "today", stale flags and
// the daily notification run all use it — matching public.business_today()
// in the database — so a task due "today" is the same day for the server
// (UTC on Vercel), the browser, and Postgres.
export const BUSINESS_TIME_ZONE = 'Asia/Kuwait';

// YYYY-MM-DD for the given instant on the business calendar.
export function businessDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at);
}

// Whole days from `from` to `to` (both YYYY-MM-DD).
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(
    Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days)
  );
  return d.toISOString().slice(0, 10);
}

// Sunday–Saturday week containing `date` (Kuwait work week).
export function weekRange(date: string): {start: string; end: string} {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const start = addDays(date, -dow);
  return {start, end: addDays(start, 6)};
}

export function monthRange(date: string): {start: string; end: string} {
  const start = `${date.slice(0, 7)}-01`;
  const next = new Date(
    Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 1)
  );
  next.setUTCDate(0);
  return {start, end: next.toISOString().slice(0, 10)};
}

export type DueState = 'overdue' | 'today' | 'upcoming' | 'none';

export function dueState(dueDate: string | null, today: string): DueState {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

// Short, locale-aware calendar date for a YYYY-MM-DD value (a longer ISO
// string is cut to its date). Formatted in UTC so the day never shifts with
// the viewer's time zone.
export function formatDay(date: string, locale: string): string {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(day);
}
