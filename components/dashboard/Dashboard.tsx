"use client";

import useSWR, { mutate } from "swr";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  addWeeks,
  currentWeekIso,
  weekIsoLabel,
  weekIsoRange,
} from "@/lib/week";
import { weeklyCapacityHours } from "@/lib/capacity";
import { holidaysInWeek } from "@/lib/holidays";
import { WORK_RULES } from "@/lib/work-rules";
import { fetcher, postJson } from "@/lib/api";
import { SWR_REFRESH_MS } from "@/lib/swr-config";
import Link from "next/link";
import { ActionMenu } from "@/components/common/ActionMenu";
import { useEditMode } from "@/hooks/useEditMode";
import { useTaskHistory } from "@/hooks/useTaskHistory";
import type { Company } from "@/lib/companies";
import { CompanyChip } from "@/components/CompanyChip";
import {
  buildVirtualRecurringTasks,
  recurringHoursByMemberWeek,
  type RecurringTaskDTO,
  type RecurringCompletionDTO,
  type VirtualRecurringTask,
} from "@/lib/recurring-virtual";

type Member = {
  id: number;
  name: string;
  color: string;
  role: string | null;
  sortOrder: number;
};
type Task = {
  id: number;
  projectId: number;
  title: string;
  assigneeMemberId: number | null;
  weekIso: string;
  done: boolean;
  sortOrder: number;
  notes: string | null;
  estimatedHours: string | null;
};
type Workload = {
  id: number;
  memberId: number;
  weekIso: string;
  plannedHours: string;
  note: string | null;
};
type Project = {
  id: number;
  name: string;
  color: string;
  status: string;
  company: Company | null;
};

const WEEK_COUNT = 6;

export function Dashboard({ archived = false }: { archived?: boolean } = {}) {
  const { isEdit: editToggled, currentMemberId: currentMemberIdInDash } = useEditMode();
  // アーカイブビューでは閲覧専用に固定する
  const isEdit = editToggled && !archived;
  const [anchorWeek, setAnchorWeek] = useState<string>(currentWeekIso());
  const weeks = useMemo(() => weekIsoRange(anchorWeek, WEEK_COUNT), [anchorWeek]);
  const weekFrom = weeks[0];
  const weekTo = weeks[weeks.length - 1];

  // ポーリング設定はグローバルな SWRProvider 側（lib/swr-config.tsx）で集約済み。
  // アーカイブビューの workload だけは更新頻度が無意味なので個別に止める。
  const { data: members } = useSWR<Member[]>("/api/members", fetcher);
  const projectsKey = archived ? "/api/projects?archived=1" : "/api/projects";
  const { data: projects } = useSWR<Project[]>(projectsKey, fetcher);
  const tasksKey = `/api/tasks?weekFrom=${weekFrom}&weekTo=${weekTo}`;
  const { data: tasks } = useSWR<Task[]>(tasksKey, fetcher);
  const workloadKey = `/api/workload?weekFrom=${weekFrom}&weekTo=${weekTo}`;
  // SWR v2 の mergeObjects は単純 spread のため `undefined` を渡すと provider 値を
  // 踏み潰す。明示的に SWR_REFRESH_MS を入れて provider 値と同期させる。
  const { data: workload } = useSWR<Workload[]>(workloadKey, fetcher, {
    refreshInterval: archived ? 0 : SWR_REFRESH_MS,
  });
  const { pushHistory } = useTaskHistory();

  // 行ホバーでプロジェクト名を出すツールチップ。TaskRow ごとに state を持つと
  // セルあたり数百個になりうるので、Dashboard 上位で 1 つだけ保持する。
  const [tooltip, setTooltip] = useState<
    { x: number; y: number; label: string } | null
  >(null);
  const TOOLTIP_MAX_W = 320;
  const showTooltip = useCallback((rect: DOMRect, label: string) => {
    if (!label) return;
    // ActionMenu (︙) が開いている間は tooltip を出さない。
    // 両者とも行の周辺に表示されるため、重なって読みにくくなるのを防ぐ。
    if (
      typeof document !== "undefined" &&
      document.querySelector(".action-menu[open]")
    ) {
      return;
    }
    const margin = 8;
    const x = Math.min(
      rect.left,
      window.innerWidth - TOOLTIP_MAX_W - margin,
    );
    setTooltip({ x: Math.max(margin, x), y: rect.bottom + 4, label });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  // スクロール中に mouseleave が取りこぼされた場合に備えて閉じる
  useEffect(() => {
    if (!tooltip) return;
    const onScroll = () => setTooltip(null);
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true });
  }, [tooltip]);
  const recurringKey = archived ? null : "/api/recurring-tasks";
  const { data: recurring } = useSWR<RecurringTaskDTO[]>(recurringKey, fetcher);
  const recurringCompletionsKey = archived
    ? null
    : `/api/recurring-tasks/completions?weekFrom=${weekFrom}&weekTo=${weekTo}`;
  const { data: recurringCompletions } = useSWR<RecurringCompletionDTO[]>(
    recurringCompletionsKey,
    fetcher,
  );

  const projectsById = useMemo(() => {
    const m: Record<number, Project> = {};
    for (const p of projects ?? []) m[p.id] = p;
    return m;
  }, [projects]);

  // タスクは projectsById に含まれるプロジェクトのものだけを使う
  // （アーカイブビューならアーカイブ済みプロジェクトのタスクだけ、
  //   通常ビューならアクティブプロジェクトのタスクだけが残る）
  const visibleTasks = useMemo(
    () => (tasks ?? []).filter((t) => projectsById[t.projectId]),
    [tasks, projectsById],
  );

  // workload: 通常はテーブル値。アーカイブビューでは表示中タスクから合計を算出
  const workloadByKey = useMemo(() => {
    const m: Record<string, Workload> = {};
    if (archived) {
      const sums = new Map<string, number>();
      for (const t of visibleTasks) {
        if (t.assigneeMemberId == null || t.estimatedHours == null) continue;
        const h = Number(t.estimatedHours);
        if (!Number.isFinite(h) || h <= 0) continue;
        const key = `${t.assigneeMemberId}::${t.weekIso}`;
        sums.set(key, (sums.get(key) ?? 0) + h);
      }
      let synthId = -1;
      for (const [key, hours] of sums) {
        const [mid, wk] = key.split("::");
        m[key] = {
          id: synthId--,
          memberId: Number(mid),
          weekIso: wk,
          plannedHours: hours.toString(),
          note: null,
        } as Workload;
      }
    } else {
      for (const w of workload ?? []) m[`${w.memberId}::${w.weekIso}`] = w;
    }
    return m;
  }, [workload, archived, visibleTasks]);

  const tasksByKey = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of visibleTasks) {
      if (t.assigneeMemberId == null) continue;
      const key = `${t.assigneeMemberId}::${t.weekIso}`;
      (m[key] ??= []).push(t);
    }
    return m;
  }, [visibleTasks]);

  // useCallback 化したハンドラから「最新の cellTasks」を参照するための ref。
  // 依存配列に tasksByKey を入れるとハンドラ参照が毎レンダー変わって行 memo が
  // 破れてしまうので、参照のみ ref で持ち、依存を空にして安定化させる。
  const tasksByKeyRef = useRef(tasksByKey);
  useEffect(() => {
    tasksByKeyRef.current = tasksByKey;
  }, [tasksByKey]);

  const virtualRecurring = useMemo(
    () =>
      archived
        ? []
        : buildVirtualRecurringTasks(
            recurring ?? [],
            recurringCompletions ?? [],
            weeks,
          ),
    [archived, recurring, recurringCompletions, weeks],
  );

  const recurringByKey = useMemo(() => {
    const m: Record<string, VirtualRecurringTask[]> = {};
    for (const v of virtualRecurring) {
      if (v.assigneeMemberId == null) continue;
      const key = `${v.assigneeMemberId}::${v.weekIso}`;
      (m[key] ??= []).push(v);
    }
    return m;
  }, [virtualRecurring]);

  const recurringHoursByKey = useMemo(
    () => (archived ? {} : recurringHoursByMemberWeek(recurring ?? [], weeks)),
    [archived, recurring, weeks],
  );

  const setHours = useCallback(
    async (memberId: number, weekIso: string, hours: number) => {
      const next = Math.max(0, Math.min(168, hours));
      await postJson(
        `/api/workload`,
        { memberId, weekIso, plannedHours: next },
        "PUT",
      );
      mutate(workloadKey);
    },
    [workloadKey],
  );

  const toggleDone = useCallback(
    async (task: Task) => {
      await postJson(`/api/tasks/${task.id}`, { done: !task.done }, "PATCH");
      mutate(tasksKey);
    },
    [tasksKey],
  );

  const toggleRecurringDone = useCallback(
    async (v: VirtualRecurringTask) => {
      if (!recurringCompletionsKey) return;
      await postJson(
        `/api/recurring-tasks/${v.recurringId}/completions`,
        { weekIso: v.weekIso, done: !v.done },
      );
      mutate(recurringCompletionsKey);
    },
    [recurringCompletionsKey],
  );

  function applyWorkloadDelta(
    prev: Workload[],
    moves: Array<{
      memberId: number;
      fromWeek: string;
      toWeek: string;
      hours: number;
    }>,
  ): Workload[] {
    const map = new Map<string, Workload>();
    for (const w of prev) map.set(`${w.memberId}::${w.weekIso}`, { ...w });
    for (const mv of moves) {
      if (mv.hours <= 0) continue;
      const fromKey = `${mv.memberId}::${mv.fromWeek}`;
      const f = map.get(fromKey);
      if (f) {
        map.set(fromKey, {
          ...f,
          plannedHours: String(Math.max(0, Number(f.plannedHours) - mv.hours)),
        });
      }
      const toKey = `${mv.memberId}::${mv.toWeek}`;
      const t = map.get(toKey);
      if (t) {
        map.set(toKey, {
          ...t,
          plannedHours: String(Number(t.plannedHours) + mv.hours),
        });
      } else {
        map.set(toKey, {
          id: -Date.now() - Math.floor(Math.random() * 1000),
          memberId: mv.memberId,
          weekIso: mv.toWeek,
          plannedHours: String(mv.hours),
          note: null,
        } as Workload);
      }
    }
    return Array.from(map.values());
  }

  // taskId の weekIso を fromWeek → toWeek へ変えるコアコミット。
  // do / undo どちらでも同じ実装で動かすため fromWeek を引数で受ける。
  const commitWeekChange = useCallback(async (
    taskId: number,
    fromWeek: string,
    toWeek: string,
    memberId: number | null,
    hours: number,
  ) => {
    await mutate(
      tasksKey,
      async () => {
        await postJson(`/api/tasks/${taskId}`, { weekIso: toWeek }, "PATCH");
        return undefined;
      },
      {
        optimisticData: (prev: Task[] | undefined) =>
          (prev ?? []).map((t) =>
            t.id === taskId ? { ...t, weekIso: toWeek } : t,
          ),
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      },
    );
    const movesWorkload = memberId != null && hours > 0;
    if (movesWorkload) {
      mutate(
        workloadKey,
        async () => undefined,
        {
          optimisticData: (prev: Workload[] | undefined) =>
            applyWorkloadDelta(prev ?? [], [
              { memberId, fromWeek, toWeek, hours },
            ]),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
    } else {
      mutate(workloadKey);
    }
  }, [tasksKey, workloadKey]);

  const shiftWeek = useCallback(async (task: Task, delta: -1 | 1) => {
    const fromWeek = task.weekIso;
    const toWeek = addWeeks(fromWeek, delta);
    const hours = task.estimatedHours ? Number(task.estimatedHours) : 0;
    const memberId = task.assigneeMemberId;
    try {
      await commitWeekChange(task.id, fromWeek, toWeek, memberId, hours);
    } catch (e) {
      console.error("shift failed", e);
      return;
    }
    pushHistory({
      label: "週移動",
      do: () => commitWeekChange(task.id, fromWeek, toWeek, memberId, hours),
      undo: () => commitWeekChange(task.id, toWeek, fromWeek, memberId, hours),
    });
  }, [commitWeekChange, pushHistory]);

  const shiftAllUnfinishedToNextWeek = useCallback(async (cellKey: string) => {
    const cellTasks = tasksByKeyRef.current[cellKey] ?? [];
    const undone = cellTasks.filter((t) => !t.done);
    if (undone.length === 0) return;
    if (
      !confirm(
        `未完了の ${undone.length} 件を翌週へ移動します。よろしいですか？`,
      )
    )
      return;
    const idMap = new Map(
      undone.map((t) => [t.id, addWeeks(t.weekIso, 1)] as const),
    );
    mutate(
      tasksKey,
      (prev: Task[] = []) =>
        prev.map((t) =>
          idMap.has(t.id) ? { ...t, weekIso: idMap.get(t.id)! } : t,
        ),
      { revalidate: false },
    );
    const moves = undone
      .map((t) => {
        const h = t.estimatedHours ? Number(t.estimatedHours) : 0;
        if (!t.assigneeMemberId || h <= 0) return null;
        return {
          memberId: t.assigneeMemberId,
          fromWeek: t.weekIso,
          toWeek: addWeeks(t.weekIso, 1),
          hours: h,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (moves.length > 0) {
      mutate(
        workloadKey,
        (prev: Workload[] = []) => applyWorkloadDelta(prev, moves),
        { revalidate: false },
      );
    }
    try {
      // 1リクエストで原子的に更新（途中失敗で部分反映を防ぐ）
      await postJson("/api/tasks/batch", {
        ops: undone.map((t) => ({
          id: t.id,
          patch: { weekIso: addWeeks(t.weekIso, 1) },
        })),
      });
    } catch (e) {
      console.error("bulk shift failed", e);
    }
    mutate(tasksKey);
    mutate(workloadKey);
  }, [tasksKey, workloadKey]);

  function applyOptimisticOrder(map: Map<number, number>) {
    return (prev: Task[] = []) =>
      [...prev]
        .map((t) =>
          map.has(t.id) ? { ...t, sortOrder: map.get(t.id)! } : t,
        )
        .sort(
          (a, b) =>
            a.weekIso.localeCompare(b.weekIso) ||
            a.sortOrder - b.sortOrder ||
            a.id - b.id,
        );
  }

  const commitReorderMap = useCallback(async (map: Map<number, number>) => {
    await mutate<Task[]>(
      tasksKey,
      async (current) => {
        await postJson("/api/tasks/batch", {
          ops: [...map.entries()].map(([id, sortOrder]) => ({
            id,
            patch: { sortOrder },
          })),
        });
        return applyOptimisticOrder(map)(current);
      },
      {
        optimisticData: applyOptimisticOrder(map),
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      },
    );
  }, [tasksKey]);

  const reorderInCell = useCallback(async (
    task: Task,
    delta: -1 | 1,
  ) => {
    if (task.assigneeMemberId == null) return;
    const cellKey = `${task.assigneeMemberId}::${task.weekIso}`;
    const cellTasks = tasksByKeyRef.current[cellKey] ?? [];
    const index = cellTasks.findIndex((t) => t.id === task.id);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= cellTasks.length) return;
    const next = [...cellTasks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);

    // prev / next とも cellTasks の表示順を 0-indexed に正規化（対称性確保）。
    const prevOrderMap = new Map(cellTasks.map((t, i) => [t.id, i] as const));
    const nextOrderMap = new Map(next.map((t, i) => [t.id, i] as const));

    try {
      await commitReorderMap(nextOrderMap);
    } catch (e) {
      console.error("reorder failed", e);
      try {
        await mutate(tasksKey);
      } catch {
        // 二重失敗は無視
      }
      return;
    }
    pushHistory({
      label: "順序移動",
      do: () => commitReorderMap(nextOrderMap),
      undo: () => commitReorderMap(prevOrderMap),
    });
  }, [commitReorderMap, pushHistory, tasksKey]);

  // 行コンポーネントに渡すハンドラは task を受け取る単一シグネチャに揃える。
  // 親側で useCallback により参照を固定し、行は React.memo + 安定 props で
  // 該当 task が変わらない限り再レンダーされない構造にしている。
  const moveUp = useCallback((t: Task) => reorderInCell(t, -1), [reorderInCell]);
  const moveDown = useCallback((t: Task) => reorderInCell(t, 1), [reorderInCell]);
  const shiftPrev = useCallback((t: Task) => shiftWeek(t, -1), [shiftWeek]);
  const shiftNext = useCallback((t: Task) => shiftWeek(t, 1), [shiftWeek]);

  return (
    <section
      className="glass-panel allow-sticky"
      style={{ padding: 24 }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="eyebrow">
            {archived ? "ARCHIVED" : "DASHBOARD"}
          </span>
          <h2 className="t-h3" style={{ marginTop: 4 }}>
            {archived ? "アーカイブ（メンバー × 週）" : "メンバー × 週"}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchorWeek(addWeeks(anchorWeek, -WEEK_COUNT))}
          >
            ◀ 前
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchorWeek(currentWeekIso())}
          >
            今週
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchorWeek(addWeeks(anchorWeek, WEEK_COUNT))}
          >
            次 ▶
          </button>
        </div>
      </header>

      {!members ? (
        <p className="muted">読み込み中…</p>
      ) : members.length === 0 ? (
        <p className="muted">
          メンバーが未登録です。<code>pnpm seed</code> を実行してください。
        </p>
      ) : (
        <div>
          {/* スマホで縦カードになるとメンバー間移動が長くなるため、上部に
              アンカーリンクの pill 群を出す。PC では CSS で非表示。 */}
          <nav
            className="dashboard-member-anchors"
            aria-label="メンバーへ移動"
          >
            {members.map((m) => (
              <a
                key={m.id}
                href={`#dashboard-member-${m.id}`}
                className={
                  m.id === currentMemberIdInDash ? "is-self" : undefined
                }
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: m.color,
                    display: "inline-block",
                  }}
                />
                {m.name}
              </a>
            ))}
          </nav>
          <table
            className="dashboard-table"
            style={{ borderCollapse: "separate", borderSpacing: 6, width: "100%" }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    top: "var(--header-h)",
                    background: "rgba(237, 233, 224, 0.86)",
                    backdropFilter: "saturate(180%) blur(16px)",
                    WebkitBackdropFilter: "saturate(180%) blur(16px)",
                    width: 110,
                    padding: "6px 10px",
                    border: "none",
                    zIndex: 4,
                    textAlign: "left",
                    color: "var(--color-text)",
                    fontWeight: 600,
                    fontSize: ".8125rem",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {weeks[0]?.slice(0, 4) ?? ""}
                </th>
                {weeks.map((w) => {
                  const hol = holidaysInWeek(w);
                  return (
                    <th
                      key={w}
                      style={{
                        position: "sticky",
                        top: "var(--header-h)",
                        background: "rgba(237, 233, 224, 0.86)",
                        backdropFilter: "saturate(180%) blur(16px)",
                        WebkitBackdropFilter: "saturate(180%) blur(16px)",
                        minWidth: 160,
                        padding: "6px 8px",
                        textAlign: "left",
                        zIndex: 3,
                        borderRadius: "var(--r-sm)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: ".8125rem",
                            fontWeight: 600,
                            color: "var(--color-text)",
                          }}
                          title={w}
                        >
                          {weekIsoLabel(w)}
                        </span>
                        {hol.length > 0 && (
                          <span
                            className="t-small"
                            style={{ color: "var(--color-warning)" }}
                          >
                            {hol.map((h) => h.name).join(" / ")}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} id={`dashboard-member-${m.id}`}>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      background: "rgba(243,241,238,.78)",
                      backdropFilter: "blur(12px)",
                      padding: "10px",
                      textAlign: "left",
                      borderRadius: "var(--r-sm)",
                      zIndex: 1,
                      verticalAlign: "top",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: m.color,
                          display: "inline-block",
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                  </th>
                  {weeks.map((w) => {
                    const cellKey = `${m.id}::${w}`;
                    const wl = workloadByKey[cellKey];
                    const planned = wl ? Number(wl.plannedHours) : 0;
                    const extraRecurring = recurringHoursByKey[cellKey] ?? 0;
                    const totalPlanned = planned + extraRecurring;
                    const capacity = weeklyCapacityHours(w);
                    const over = totalPlanned > capacity;
                    const cellTasks = tasksByKey[cellKey] ?? [];
                    const cellRecurring = recurringByKey[cellKey] ?? [];
                    return (
                      <td
                        key={w}
                        className={`glass-cell${
                          m.id === currentMemberIdInDash ? " dashboard-row-self" : ""
                        }`}
                        // スマホで table を縦カード化したとき、各セルに週ラベルを
                        // ::before で出すための data 属性。PC では未使用。
                        data-week-label={weekIsoLabel(w)}
                        // a11y: モバイルで thead を display:none にするため、各セルが
                        // どのメンバー・どの週か screen reader に直接読ませる
                        aria-label={`${m.name} ${weekIsoLabel(w)}`}
                        style={{ verticalAlign: "top", minWidth: 160 }}
                      >
                        <HoursBadge
                          memberId={m.id}
                          weekIso={w}
                          planned={planned}
                          extraRecurring={extraRecurring}
                          capacity={capacity}
                          over={over}
                          isEdit={isEdit}
                          onChange={(h) => setHours(m.id, w, h)}
                        />
                        <ul
                          className="cell-task-list"
                          style={{
                            listStyle: "none",
                            margin: "8px 0 0",
                            padding: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 0,
                          }}
                        >
                          {cellTasks.map((t, idx) => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              project={projectsById[t.projectId]}
                              isEdit={isEdit}
                              canMoveUp={idx > 0}
                              canMoveDown={idx < cellTasks.length - 1}
                              onToggle={toggleDone}
                              onMoveUp={moveUp}
                              onMoveDown={moveDown}
                              onShiftPrev={shiftPrev}
                              onShiftNext={shiftNext}
                              onShowTooltip={showTooltip}
                              onHideTooltip={hideTooltip}
                            />
                          ))}
                          {cellRecurring.map((v) => (
                            <RecurringRow
                              key={v.id}
                              v={v}
                              isEdit={isEdit}
                              onToggle={toggleRecurringDone}
                            />
                          ))}
                        </ul>
                        {isEdit &&
                          cellTasks.some((t) => !t.done) &&
                          cellTasks.length > 0 && (
                            <button
                              type="button"
                              className="edit-only"
                              onClick={() =>
                                shiftAllUnfinishedToNextWeek(cellKey)
                              }
                              style={{
                                marginTop: 6,
                                fontSize: ".6875rem",
                                color: "var(--color-text-muted)",
                                background: "rgba(255,255,255,.42)",
                                border: "1px dashed rgba(255,255,255,.62)",
                                borderRadius: 6,
                                padding: "3px 8px",
                                cursor: "pointer",
                                width: "100%",
                                textAlign: "left",
                              }}
                              title="このセルの未完了タスクをすべて翌週に移す"
                            >
                              未完了を翌週へ →
                            </button>
                          )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,.45)",
        }}
        className="t-small muted"
      >
        <span>
          基準容量: 通常週 {WORK_RULES.workDays.length * WORK_RULES.dailyWorkHours - WORK_RULES.weeklyMtgHours}h
          ・実働 {WORK_RULES.dailyWorkHours}h/日 ・MTG 控除 {WORK_RULES.weeklyMtgHours}h/週
        </span>
        <span>残業上限: 月 {WORK_RULES.monthlyOvertimeLimitHours}h まで</span>
      </footer>
      {tooltip &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y,
              zIndex: 9999,
              pointerEvents: "none",
              padding: "4px 8px",
              borderRadius: "var(--r-sm)",
              background: "rgba(255,255,255,.78)",
              backdropFilter: "blur(14px) saturate(1.3)",
              WebkitBackdropFilter: "blur(14px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,.55)",
              boxShadow: "0 6px 18px rgba(53,54,45,.10)",
              color: "var(--color-text)",
              fontSize: ".6875rem",
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              maxWidth: TOOLTIP_MAX_W,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tooltip.label}
          </div>,
          document.body,
        )}
    </section>
  );
}

const HoursBadge = memo(function HoursBadge({
  planned,
  extraRecurring = 0,
  capacity,
  over,
  isEdit,
  onChange,
}: {
  memberId: number;
  weekIso: string;
  planned: number;
  extraRecurring?: number;
  capacity: number;
  over: boolean;
  isEdit: boolean;
  onChange: (h: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(planned));
  useEffect(() => {
    setDraft(String(planned));
  }, [planned]);
  const total = planned + extraRecurring;
  const tipTitle =
    extraRecurring > 0
      ? `計画 ${planned}h + 定例 ${extraRecurring}h = ${total}h`
      : undefined;
  if (!isEdit) {
    // 超過は「色だけ」に依存せず、テキスト「超過」+ 警告アイコン (△) を併記する。
    // 警告レベルは error (赤) から warn (橙) に下げる — 容量超過は致命ではなく注意喚起。
    return (
      <div
        className={`badge ${over ? "badge-warn" : total === 0 ? "" : "badge-ok"}`}
        style={{ width: "fit-content" }}
        title={tipTitle}
      >
        {over && (
          <span aria-hidden="true" style={{ marginRight: 2 }}>
            △
          </span>
        )}
        <strong className="mono">{total || "—"}</strong>
        <span className="muted">/ {capacity}h</span>
        {over && <span className="muted">超過</span>}
        {extraRecurring > 0 && (
          <span
            className="muted"
            style={{ marginLeft: 4, fontSize: ".625rem" }}
          >
            （+定例{extraRecurring}h）
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, width: "fit-content" }}
      className="editable-only"
      title={tipTitle}
    >
      <input
        className="input"
        type="number"
        min={0}
        max={168}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next) && next !== planned) onChange(next);
        }}
        style={{
          // 3 桁工数 (例: 168h) も読めるよう、固定幅 → 内容に応じて伸びる幅に。
          // minWidth で「縮みすぎ」を、maxWidth で「広がりすぎ」を防ぐ。
          minWidth: 64,
          maxWidth: 88,
          width: "5.5ch",
          padding: "var(--space-1) var(--space-2)",
          fontSize: ".75rem",
        }}
      />
      <span className="t-small muted">/ {capacity}h</span>
      {extraRecurring > 0 && (
        <span className="muted" style={{ fontSize: ".625rem" }}>
          +定例{extraRecurring}h
        </span>
      )}
      {over && (
        <span
          className="badge badge-warn"
          style={{ fontSize: ".625rem" }}
        >
          <span aria-hidden="true" style={{ marginRight: 2 }}>
            △
          </span>
          超過
        </span>
      )}
    </div>
  );
});

const recurringRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: ".75rem",
  lineHeight: 1.4,
};

const recurringBadgeStyle: CSSProperties = {
  fontSize: ".5625rem",
  padding: "1px 5px",
  marginRight: 5,
  background: "rgba(120, 120, 100, 0.15)",
  color: "var(--color-text-muted)",
  verticalAlign: "middle",
};

const RecurringRow = memo(function RecurringRow({
  v,
  isEdit,
  onToggle,
}: {
  v: VirtualRecurringTask;
  isEdit: boolean;
  onToggle: (v: VirtualRecurringTask) => void;
}) {
  const handleToggle = useCallback(() => onToggle(v), [onToggle, v]);
  const hours = v.estimatedHours == null ? 0 : Number(v.estimatedHours);
  return (
    <li style={recurringRowStyle}>
      <input
        type="checkbox"
        className="checkbox"
        checked={v.done}
        onChange={handleToggle}
        disabled={!isEdit}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          className="badge"
          style={recurringBadgeStyle}
          title="定例タスク（/recurring で編集）"
        >
          定例
        </span>
        <span
          style={{
            textDecoration: v.done ? "line-through" : "none",
            color: v.done ? "var(--color-text-light)" : "var(--color-text)",
          }}
        >
          {v.title}
        </span>
        {hours > 0 && (
          <span
            className="t-small mono muted"
            style={{ marginLeft: 6, fontSize: ".625rem" }}
          >
            {hours}h
          </span>
        )}
      </div>
    </li>
  );
});

const taskRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: ".75rem",
  lineHeight: 1.4,
};

const taskRowDotStyle: CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: 999,
  marginRight: 5,
  verticalAlign: "middle",
};

const TaskRow = memo(function TaskRow({
  task,
  project,
  isEdit,
  onToggle,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onShiftPrev,
  onShiftNext,
  onShowTooltip,
  onHideTooltip,
}: {
  task: Task;
  project: Project | undefined;
  isEdit: boolean;
  onToggle: (t: Task) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: (t: Task) => void;
  onMoveDown?: (t: Task) => void;
  onShiftPrev?: (t: Task) => void;
  onShiftNext?: (t: Task) => void;
  onShowTooltip: (rect: DOMRect, label: string) => void;
  onHideTooltip: () => void;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const projectLabel = project?.name ?? "";
  const showTip = useCallback(() => {
    if (!projectLabel) return;
    const r = liRef.current?.getBoundingClientRect();
    if (r) onShowTooltip(r, projectLabel);
  }, [projectLabel, onShowTooltip]);
  const hideTip = useCallback(() => onHideTooltip(), [onHideTooltip]);
  const handleToggle = useCallback(() => onToggle(task), [onToggle, task]);
  const handleMoveUp = useCallback(() => onMoveUp?.(task), [onMoveUp, task]);
  const handleMoveDown = useCallback(() => onMoveDown?.(task), [onMoveDown, task]);
  const handleShiftPrev = useCallback(
    () => onShiftPrev?.(task),
    [onShiftPrev, task],
  );
  const handleShiftNext = useCallback(
    () => onShiftNext?.(task),
    [onShiftNext, task],
  );

  return (
    <li
      ref={liRef}
      tabIndex={projectLabel ? 0 : undefined}
      aria-label={
        projectLabel ? `${task.title}（プロジェクト：${projectLabel}）` : undefined
      }
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
      onFocus={showTip}
      onBlur={hideTip}
      style={taskRowStyle}
    >
      <input
        type="checkbox"
        className="checkbox"
        checked={task.done}
        onChange={handleToggle}
        disabled={!isEdit}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {project?.company && (
          <span style={{ marginRight: 5, verticalAlign: "middle" }}>
            <CompanyChip company={project.company} size="xs" />
          </span>
        )}
        {project && (
          <span
            style={{ ...taskRowDotStyle, background: project.color }}
          />
        )}
        {!isEdit && project ? (
          // プレビューモードではタスクタイトルから /projects へジャンプ。
          // 編集モードでは既存の input 編集を維持するため Link 化しない。
          <Link
            href={`/projects?open=${project.id}`}
            scroll={false}
            className="dashboard-task-link"
            style={{
              textDecoration: task.done ? "line-through" : "none",
              color: task.done ? "var(--color-text-light)" : "var(--color-text)",
            }}
          >
            {task.title}
          </Link>
        ) : (
          <span
            style={{
              textDecoration: task.done ? "line-through" : "none",
              color: task.done ? "var(--color-text-light)" : "var(--color-text)",
            }}
          >
            {task.title}
          </span>
        )}
      </div>
      {isEdit && (onMoveUp || onMoveDown || onShiftPrev || onShiftNext) && (
        <div className="edit-only" style={{ flexShrink: 0 }}>
          <ActionMenu label="このタスクのアクション">
            {onMoveUp && (
              <button
                type="button"
                role="menuitem"
                onClick={handleMoveUp}
                disabled={!canMoveUp}
              >
                ↑ 上へ
              </button>
            )}
            {onMoveDown && (
              <button
                type="button"
                role="menuitem"
                onClick={handleMoveDown}
                disabled={!canMoveDown}
              >
                ↓ 下へ
              </button>
            )}
            {onShiftPrev && (
              <button
                type="button"
                role="menuitem"
                onClick={handleShiftPrev}
              >
                ← 前週へ戻す
              </button>
            )}
            {onShiftNext && (
              <button
                type="button"
                role="menuitem"
                onClick={handleShiftNext}
              >
                → 翌週へ移動
              </button>
            )}
          </ActionMenu>
        </div>
      )}
    </li>
  );
});

