export const WORK_RULES = {
  workDays: [1, 2, 3, 4, 5],
  dailyWorkHours: 7.5,
  weeklyMtgHours: 5,
  monthlyOvertimeLimitHours: 11,
  shiftStart: "10:00",
  shiftEnd: "18:30",
  lunchBreakHours: 1,
} as const;

export const FULL_WEEK_CAPACITY =
  WORK_RULES.workDays.length * WORK_RULES.dailyWorkHours - WORK_RULES.weeklyMtgHours;

export function weekCapacityWithHolidays(holidayCount: number): number {
  const workingDays = Math.max(0, WORK_RULES.workDays.length - holidayCount);
  return Math.max(0, workingDays * WORK_RULES.dailyWorkHours - WORK_RULES.weeklyMtgHours);
}
