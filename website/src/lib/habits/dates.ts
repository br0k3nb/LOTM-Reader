// Local calendar-day helpers. Habit days are local dates (YYYY-MM-DD), the
// same key format the app and the reading-sync API use.

export function dateKey(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: unknown): Date | null {
  if (typeof key !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function isDateKey(key: unknown): key is string {
  return parseDateKey(key) !== null;
}

/** Local midnight of `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Whole calendar days from `b` to `a` (DST-safe). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/** ISO weekday: Monday = 1 … Sunday = 7 (Dart's `DateTime.weekday`). */
export function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

export function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -(isoWeekday(day) - 1));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function longDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}
