export function toWeekIso(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function weekIsoMonday(weekIso: string): Date {
  const m = weekIso.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`invalid weekIso: ${weekIso}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const offset = dow <= 4 ? 1 - dow : 8 - dow;
  simple.setUTCDate(simple.getUTCDate() + offset);
  return simple;
}

export function weekIsoDays(weekIso: string): Date[] {
  const monday = weekIsoMonday(weekIso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}

export function weekIsoRange(start: string, count: number): string[] {
  const monday = weekIsoMonday(start);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i * 7);
    return toWeekIso(d);
  });
}

export function addWeeks(weekIso: string, delta: number): string {
  const monday = weekIsoMonday(weekIso);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return toWeekIso(monday);
}

export function currentWeekIso(now: Date = new Date()): string {
  return toWeekIso(now);
}

export function weekIsoLabel(weekIso: string): string {
  const monday = weekIsoMonday(weekIso);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

export function weekIsoToYearMonth(weekIso: string): string {
  const monday = weekIsoMonday(weekIso);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function yearMonthWeekIsos(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0));
  const set = new Set<string>();
  for (
    const d = new Date(firstDay);
    d <= lastDay;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    set.add(toWeekIso(new Date(d)));
  }
  return [...set];
}
