import { isHoliday } from "./holidays";
import { weekIsoDays, weekIsoToYearMonth, yearMonthWeekIsos } from "./week";
import { weekCapacityWithHolidays, WORK_RULES } from "./work-rules";

const WORKDAYS = new Set(WORK_RULES.workDays);

export function weeklyCapacityHours(weekIso: string): number {
  const workdayHolidays = weekIsoDays(weekIso).filter((d) => {
    const day = d.getUTCDay();
    if (!WORKDAYS.has(day as 1 | 2 | 3 | 4 | 5)) return false;
    return isHoliday(d);
  }).length;
  return weekCapacityWithHolidays(workdayHolidays);
}

export function monthlyBaselineHours(yearMonth: string): number {
  return yearMonthWeekIsos(yearMonth).reduce(
    (sum, w) => sum + weeklyCapacityHours(w),
    0,
  );
}

export function monthOvertimeHours(
  totalPlannedForMonth: number,
  yearMonth: string,
): number {
  return Math.max(0, totalPlannedForMonth - monthlyBaselineHours(yearMonth));
}

export function isOvertimeOverLimit(
  totalPlannedForMonth: number,
  yearMonth: string,
): boolean {
  return (
    monthOvertimeHours(totalPlannedForMonth, yearMonth) >
    WORK_RULES.monthlyOvertimeLimitHours
  );
}

export function aggregateMonthlyPlanned(
  workloadByWeek: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [weekIso, hours] of Object.entries(workloadByWeek)) {
    const ym = weekIsoToYearMonth(weekIso);
    out[ym] = (out[ym] ?? 0) + hours;
  }
  return out;
}
