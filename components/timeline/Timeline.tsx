"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  addWeeks,
  currentWeekIso,
  weekIsoMonday,
  weekIsoRange,
} from "@/lib/week";
import { fetcher } from "@/lib/api";
import { useEditMode } from "@/hooks/useEditMode";
import { LinkifiedText } from "@/components/LinkifiedText";

type Project = {
  id: number;
  name: string;
  summary: string;
  notes: string;
  company: string | null;
  color: string;
  status: string;
  dueDate: string | null;
  plannedMemberIds: number[];
};

type Task = {
  id: number;
  projectId: number;
  title: string;
  assigneeMemberId: number | null;
  weekIso: string;
  done: boolean;
  sortOrder: number;
  estimatedHours: string | null;
};

type Member = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
};

const WEEK_COUNT = 12;
const PAST_OFFSET = -2;

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return `rgba(56, 83, 123, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

function weekStartLabel(weekIso: string): string {
  const d = weekIsoMonday(weekIso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function fullDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function Timeline() {
  const { currentMemberId } = useEditMode();
  const [anchor, setAnchor] = useState<string>(() =>
    addWeeks(currentWeekIso(), PAST_OFFSET),
  );
  const [focusId, setFocusId] = useState<number | null>(null);
  const [memberFilter, setMemberFilter] = useState<number | null>(null);

  const weeks = useMemo(() => weekIsoRange(anchor, WEEK_COUNT), [anchor]);
  const weekFrom = weeks[0];
  const weekTo = weeks[WEEK_COUNT - 1];

  const { data: projects } = useSWR<Project[]>("/api/projects", fetcher);
  const { data: tasks } = useSWR<Task[]>(
    `/api/tasks?weekFrom=${weekFrom}&weekTo=${weekTo}`,
    fetcher,
  );
  const { data: members } = useSWR<Member[]>("/api/members", fetcher);

  const membersById = useMemo(() => {
    const m = new Map<number, Member>();
    for (const x of members ?? []) m.set(x.id, x);
    return m;
  }, [members]);

  const projectColor = (p: Project): string => p.color;

  const weekIndex = useMemo(() => {
    const m = new Map<string, number>();
    weeks.forEach((w, i) => m.set(w, i));
    return m;
  }, [weeks]);

  // プロジェクトごとの assignee（plannedMemberIds と window 内タスクの assignee の和集合）
  const projectMembers = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const p of projects ?? []) {
      m.set(p.id, new Set(p.plannedMemberIds));
    }
    for (const t of tasks ?? []) {
      if (t.assigneeMemberId == null) continue;
      const s = m.get(t.projectId);
      if (s) s.add(t.assigneeMemberId);
    }
    return m;
  }, [projects, tasks]);

  const rows = useMemo(() => {
    const base = (projects ?? [])
      .filter((p) => {
        if (memberFilter == null) return true;
        return projectMembers.get(p.id)?.has(memberFilter) ?? false;
      })
      .map((p) => {
        const idxs: number[] = [];
        for (const t of tasks ?? []) {
          if (t.projectId !== p.id) continue;
          if (memberFilter != null && t.assigneeMemberId !== memberFilter) continue;
          const i = weekIndex.get(t.weekIso);
          if (i !== undefined) idxs.push(i);
        }
        const bar =
          idxs.length === 0
            ? null
            : { s: Math.min(...idxs), e: Math.max(...idxs) };
        return { project: p, bar };
      });
    if (memberFilter == null) return base;
    // メンバー絞り時はバーありを上に
    return [...base].sort((a, b) => {
      if (!!a.bar !== !!b.bar) return a.bar ? -1 : 1;
      return 0;
    });
  }, [projects, tasks, weekIndex, memberFilter, projectMembers]);

  const years = useMemo(() => {
    const buckets: { year: number; span: number }[] = [];
    weeks.forEach((w) => {
      const y = weekIsoMonday(w).getUTCFullYear();
      const last = buckets[buckets.length - 1];
      if (last && last.year === y) last.span += 1;
      else buckets.push({ year: y, span: 1 });
    });
    return buckets;
  }, [weeks]);

  const todayWeek = currentWeekIso();
  const todayIdx = weekIndex.get(todayWeek);

  const focusedProject = focusId != null
    ? (projects ?? []).find((p) => p.id === focusId)
    : null;
  const focusedTasks = useMemo(() => {
    if (focusId == null) return [];
    return (tasks ?? [])
      .filter((t) => t.projectId === focusId)
      .filter((t) => memberFilter == null || t.assigneeMemberId === memberFilter)
      .sort((a, b) => {
        if (a.weekIso !== b.weekIso) return a.weekIso < b.weekIso ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });
  }, [tasks, focusId, memberFilter]);

  return (
    <section className="glass-panel" style={{ padding: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="eyebrow">TIMELINE</span>
          <h2 className="t-h3" style={{ marginTop: 4 }}>
            タイムライン
          </h2>
        </div>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchor((a) => addWeeks(a, -WEEK_COUNT))}
          >
            ◀ 前{WEEK_COUNT}週
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchor(addWeeks(currentWeekIso(), PAST_OFFSET))}
          >
            今週
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchor((a) => addWeeks(a, WEEK_COUNT))}
          >
            次{WEEK_COUNT}週 ▶
          </button>
        </div>
      </header>

      <div className="timeline-member-filter" role="group" aria-label="メンバー絞り込み">
        <span className="eyebrow" style={{ marginRight: 8 }}>MEMBER</span>
        <button
          type="button"
          className={`timeline-chip ${memberFilter == null ? "is-active" : ""}`}
          aria-pressed={memberFilter == null}
          onClick={() => setMemberFilter(null)}
        >
          すべて
        </button>
        {(members ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((m) => {
            const active = memberFilter === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className={`timeline-chip ${active ? "is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setMemberFilter(active ? null : m.id)}
              >
                <span
                  className="timeline-chip-dot"
                  style={{ background: m.color }}
                  aria-hidden="true"
                />
                {m.name}
              </button>
            );
          })}
      </div>

      <div className="timeline">
        <div className="timeline-axis-years" aria-hidden="true">
          {years.map((y, i) => (
            <div key={i} style={{ flex: y.span }}>
              {y.year}
            </div>
          ))}
        </div>

        <div className="timeline-axis-months">
          {weeks.map((w, i) => {
            const isToday = i === todayIdx;
            return (
              <div
                key={w}
                className={isToday ? "is-today" : undefined}
                title={w}
                aria-label={isToday ? `今週 (${w})` : undefined}
              >
                {weekStartLabel(w)}
              </div>
            );
          })}
        </div>

        {(projects?.length ?? 0) === 0 && (
          <div
            className="muted"
            style={{ padding: "24px 0", textAlign: "center", fontSize: ".8125rem" }}
          >
            プロジェクトがありません
          </div>
        )}

        {memberFilter != null && rows.length === 0 && (
          <div
            className="muted"
            style={{ padding: "24px 0", textAlign: "center", fontSize: ".8125rem" }}
          >
            このメンバーが担当するプロジェクトはありません
          </div>
        )}

        {rows.map(({ project, bar }) => {
          const active = focusId === project.id;
          const dimmedByFocus = focusId !== null && !active;
          const opacityVal = dimmedByFocus ? 0.32 : 1;
          return (
            <div key={project.id}>
              <div
                className={`timeline-row ${active ? "active" : ""}`}
                onClick={() =>
                  setFocusId((cur) => (cur === project.id ? null : project.id))
                }
              >
                <div className="timeline-row-label">
                  <div className="timeline-row-label-main">{project.name}</div>
                  <div className="timeline-row-label-sub">
                    {project.company ?? "—"}
                    {project.plannedMemberIds.length > 0 && (
                      <> · {project.plannedMemberIds.length}人</>
                    )}
                  </div>
                </div>
                <div className="timeline-row-track">
                  {Array.from({ length: WEEK_COUNT }).map((_, i) => (
                    <div key={i} className="timeline-row-grid" />
                  ))}
                  {bar && (
                    <div
                      className="timeline-row-bar"
                      style={{
                        left: `${(bar.s / WEEK_COUNT) * 100}%`,
                        width: `${((bar.e - bar.s + 1) / WEEK_COUNT) * 100}%`,
                        background: hexToRgba(projectColor(project), 0.78),
                        opacity: opacityVal,
                        boxShadow: active
                          ? "var(--glass-hl-d), 0 0 24px rgba(53, 54, 45, 0.18)"
                          : "var(--glass-hl-d)",
                      }}
                    >
                      <span>
                        {weekStartLabel(weeks[bar.s])} – {weekStartLabel(weeks[bar.e])}
                      </span>
                    </div>
                  )}
                  {!bar && (
                    <div className="timeline-row-empty" aria-hidden="true">
                      この期間にタスクなし
                    </div>
                  )}
                </div>
              </div>

              {active && focusedProject && (
                <div className="timeline-detail" role="region" aria-label={`${focusedProject.name} のタスク`}>
                  <header className="timeline-detail-head">
                    <span
                      className="timeline-detail-swatch"
                      style={{ background: projectColor(focusedProject) }}
                      aria-hidden="true"
                    />
                    <strong>{focusedProject.name}</strong>
                    {focusedProject.company && (
                      <span className="muted"> · {focusedProject.company}</span>
                    )}
                    {focusedProject.dueDate && (
                      <span className="muted"> · 締切 {fullDateLabel(focusedProject.dueDate)}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusId(null);
                      }}
                    >
                      閉じる
                    </button>
                  </header>

                  {(focusedProject.summary || focusedProject.notes) && (
                    <div className="timeline-detail-meta">
                      {focusedProject.summary && (
                        <div className="timeline-detail-block">
                          <div className="timeline-detail-block-label">概要</div>
                          <LinkifiedText
                            text={focusedProject.summary}
                            className="timeline-detail-block-body"
                          />
                        </div>
                      )}
                      {focusedProject.notes && (
                        <div className="timeline-detail-block">
                          <div className="timeline-detail-block-label">メモ</div>
                          <LinkifiedText
                            text={focusedProject.notes}
                            className="timeline-detail-block-body"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {focusedTasks.length === 0 ? (
                    <div className="muted" style={{ padding: "8px 0", fontSize: ".75rem" }}>
                      この期間のタスクはありません
                    </div>
                  ) : (
                    <ul className="timeline-task-list">
                      {focusedTasks.map((t) => {
                        const assignee = t.assigneeMemberId != null
                          ? membersById.get(t.assigneeMemberId)
                          : null;
                        return (
                          <li key={t.id} className="timeline-task">
                            <span className={`timeline-task-check ${t.done ? "is-done" : ""}`} aria-hidden="true">
                              {t.done ? "✓" : ""}
                            </span>
                            <span className="timeline-task-week mono">
                              {weekStartLabel(t.weekIso)}
                            </span>
                            <span className={`timeline-task-title ${t.done ? "is-done" : ""}`}>
                              {t.title}
                            </span>
                            {assignee && (
                              <span
                                className="timeline-task-assignee"
                                style={{
                                  background: hexToRgba(assignee.color, 0.18),
                                  borderColor: hexToRgba(assignee.color, 0.48),
                                  color: hexToRgba(assignee.color, 0.95),
                                }}
                              >
                                <span
                                  className="timeline-chip-dot"
                                  style={{ background: assignee.color }}
                                  aria-hidden="true"
                                />
                                {assignee.name}
                              </span>
                            )}
                            {t.estimatedHours && Number(t.estimatedHours) > 0 && (
                              <span className="muted mono" style={{ fontSize: ".6875rem" }}>
                                {Number(t.estimatedHours)}h
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
