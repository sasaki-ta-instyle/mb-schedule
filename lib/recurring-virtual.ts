import { weekIsoMonday } from "@/lib/week";

export const RECURRENCE_TYPES = ["weekly", "monthly"] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

/**
 * 月次 recurring タスクを「第 n 週」に表示するべき週かを判定する。
 * 定義: その週の **月曜日が当月の (n-1)*7+1 〜 n*7 日にある** = 当月の n 番目の月曜を含む ISO 週。
 *
 * 注意: ISO 週の取り方の都合で、月の頭が金〜日のときは
 * 「1 日を含む週」ではなく「1 日の翌週」が第1週扱いになる。例:
 *   - 2026-01-01 (木) → その週の月曜は 2025-12-29 なので 2026-W01 では非表示、2026-W02 で第1週
 *   - 2026-02-01 (日) → その週の月曜は 2026-01-26 なので 2026-W05 では非表示、2026-W06 で第1週
 *
 * 第5週が当月内に存在しない月（月内月曜が 29 日以降に来ない月）は、
 * day >= 29 の月曜が存在しないため自然に該当週なしとなりスキップされる。
 */
export function isNthWeekOfMonth(weekIso: string, n: number): boolean {
  if (!Number.isInteger(n) || n < 1 || n > 5) return false;
  const day = weekIsoMonday(weekIso).getUTCDate();
  const lo = (n - 1) * 7 + 1;
  const hi = n * 7;
  return day >= lo && day <= hi;
}

/** 互換用エイリアス。新規コードは isNthWeekOfMonth(w, 1) を使うこと。 */
export function isFirstWeekOfMonth(weekIso: string): boolean {
  return isNthWeekOfMonth(weekIso, 1);
}

function shouldShowForRecurrence(
  type: string,
  weekIso: string,
  weekOfMonth: number | null,
): boolean {
  if (type === "weekly") return true;
  if (type === "monthly") {
    const n = weekOfMonth ?? 1;
    return isNthWeekOfMonth(weekIso, n);
  }
  return false;
}

export type RecurringTaskDTO = {
  id: number;
  title: string;
  assigneeMemberId: number | null;
  recurrenceType: string;
  weekOfMonth: number | null;
  estimatedHours: string | null;
  notes: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecurringCompletionDTO = {
  id: number;
  recurringTaskId: number;
  weekIso: string;
  doneAt: string;
};

export type VirtualRecurringTask = {
  kind: "recurring";
  id: string;
  recurringId: number;
  title: string;
  assigneeMemberId: number | null;
  weekIso: string;
  done: boolean;
  estimatedHours: string | null;
  notes: string | null;
  sortOrder: number;
};

export function virtualRecurringId(recurringId: number, weekIso: string): string {
  return `r-${recurringId}-${weekIso}`;
}

export function buildVirtualRecurringTasks(
  recurring: RecurringTaskDTO[],
  completions: RecurringCompletionDTO[],
  weeks: string[],
): VirtualRecurringTask[] {
  const doneKeys = new Set(
    completions.map((c) => `${c.recurringTaskId}::${c.weekIso}`),
  );
  const out: VirtualRecurringTask[] = [];
  for (const r of recurring) {
    if (r.archivedAt) continue;
    for (const w of weeks) {
      if (!shouldShowForRecurrence(r.recurrenceType, w, r.weekOfMonth)) continue;
      out.push({
        kind: "recurring",
        id: virtualRecurringId(r.id, w),
        recurringId: r.id,
        title: r.title,
        assigneeMemberId: r.assigneeMemberId,
        weekIso: w,
        done: doneKeys.has(`${r.id}::${w}`),
        estimatedHours: r.estimatedHours,
        notes: r.notes,
        sortOrder: r.sortOrder,
      });
    }
  }
  return out;
}

/**
 * 人 × 週 ごとの定例工数を集計する。
 * keys は `${memberId}::${weekIso}` 形式。Dashboard 等で workload と合算して使う。
 */
export function recurringHoursByMemberWeek(
  recurring: RecurringTaskDTO[],
  weeks: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of recurring) {
    if (r.archivedAt) continue;
    if (r.assigneeMemberId == null) continue;
    const h = r.estimatedHours == null ? 0 : Number(r.estimatedHours);
    if (!Number.isFinite(h) || h <= 0) continue;
    for (const w of weeks) {
      if (!shouldShowForRecurrence(r.recurrenceType, w, r.weekOfMonth)) continue;
      const k = `${r.assigneeMemberId}::${w}`;
      out[k] = (out[k] ?? 0) + h;
    }
  }
  return out;
}
