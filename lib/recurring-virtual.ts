import { weekIsoMonday } from "@/lib/week";

export const RECURRENCE_TYPES = ["weekly", "monthly"] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

/**
 * 月次 recurring タスクを表示するべき週かを判定する。
 * 定義: その週の **月曜日が当月の 1〜7 日にある** = 当月の最初の月曜を含む ISO 週。
 *
 * 注意 (M-5): ISO 週の取り方の都合で、月の頭が金〜日のときは
 * 「1 日を含む週」ではなく「1 日の翌週」に月次タスクが出る。例:
 *   - 2026-01-01 (木) → その週の月曜は 2025-12-29 なので 2026-W01 では非表示、2026-W02 で初出
 *   - 2026-02-01 (日) → その週の月曜は 2026-01-26 なので 2026-W05 では非表示、2026-W06 で初出
 * 「1 日を含む週で出してほしい」UX 要件が出たら、判定式を
 * 「その週の月〜金のいずれかが当月 1 日と同月」へ変更する。
 */
export function isFirstWeekOfMonth(weekIso: string): boolean {
  const day = weekIsoMonday(weekIso).getUTCDate();
  return day >= 1 && day <= 7;
}

function shouldShowForRecurrence(type: string, weekIso: string): boolean {
  if (type === "weekly") return true;
  if (type === "monthly") return isFirstWeekOfMonth(weekIso);
  return false;
}

export type RecurringTaskDTO = {
  id: number;
  title: string;
  assigneeMemberId: number | null;
  recurrenceType: string;
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
      if (!shouldShowForRecurrence(r.recurrenceType, w)) continue;
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
      if (!shouldShowForRecurrence(r.recurrenceType, w)) continue;
      const k = `${r.assigneeMemberId}::${w}`;
      out[k] = (out[k] ?? 0) + h;
    }
  }
  return out;
}
