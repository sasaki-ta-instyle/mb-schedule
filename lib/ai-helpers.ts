import { holidaysInWeek } from "./holidays";

export function weekHolidayList(weekIso: string): { date: string; name: string }[] {
  return holidaysInWeek(weekIso);
}
