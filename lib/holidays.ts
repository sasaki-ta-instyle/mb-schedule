import { JP_HOLIDAYS } from "./holidays-data";
import { weekIsoDays } from "./week";

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isHoliday(date: Date): boolean {
  return toIsoDate(date) in JP_HOLIDAYS;
}

export function holidayName(date: Date): string | null {
  return JP_HOLIDAYS[toIsoDate(date)] ?? null;
}

export function holidaysInWeek(weekIso: string): { date: string; name: string }[] {
  return weekIsoDays(weekIso)
    .map((d) => {
      const iso = toIsoDate(d);
      const name = JP_HOLIDAYS[iso];
      return name ? { date: iso, name } : null;
    })
    .filter((x): x is { date: string; name: string } => x !== null);
}
