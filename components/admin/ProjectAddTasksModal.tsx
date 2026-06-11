"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { fetcher, postJson } from "@/lib/api";
import { addWeeks, currentWeekIso, weekIsoRange } from "@/lib/week";
import type { Company } from "@/lib/companies";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  DRAFT_ROW_GRID,
  SortableDraftRow,
  stripLocalId,
  withLocalId,
  type DraftRow,
  type DraftTask,
  type Member,
} from "./ProjectCreateModal";

// 既存プロジェクトに対する「タスクを追加」モーダル。
//
// ProjectCreateModal とは別物として持つ。新規作成の動線（projectメタ編集 +
// タスク一括生成 + 工数加算 + aiSeed 保存）を壊さないために、共通化はせず
// `SortableDraftRow` / 型 / withLocalId だけを share している。
//
// 流れ:
//   1. モーダルを開くと既存タスクを 1 度だけ fetch（重複防止用コンテキスト）
//   2. 「AI でたたき台を生成」で `/api/ai/generate-tasks` を叩く。
//      ・name/summary/plannedMemberIds は project から渡す（read-only）
//      ・既存タスクは existingTasks としてサーバに渡し、AI 側で重複禁止
//   3. 提案を編集（行追加 / 削除 / 並べ替え / 担当・週・見積変更）
//   4. 「このプロジェクトに追加」で `/api/projects/:id/tasks-batch` を叩く

type Project = {
  id: number;
  name: string;
  summary: string;
  plannedMemberIds: number[];
  dueDate: string | null;
  company: Company | null;
};

type ExistingTask = {
  id: number;
  projectId: number;
  title: string;
  weekIso: string;
  assigneeMemberId: number | null;
  done: boolean;
};

type GenerateResponse = {
  tasks: DraftTask[];
  rationale: string;
  meta: { startWeek: string; endWeek: string; model: string };
};

export function ProjectAddTasksModal({
  project,
  members,
  onClose,
  onAdded,
}: {
  project: Project;
  members: Member[];
  onClose: () => void;
  onAdded: () => void;
}) {
  // 既存タスクは AI のコンテキストに渡すのと、ユーザー確認用の表示にも使う。
  // モーダル open 中だけ取得し、SWR の同一キーがあれば共有される。
  const { data: existingTasks } = useSWR<ExistingTask[]>(
    `/api/tasks?projectIds=${project.id}`,
    fetcher,
  );

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [rationale, setRationale] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (generating) {
      setElapsedSec(0);
      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [generating]);

  // 既存タスクの週も選択肢に含める。新規作成側より少し広めに 30 週分。
  const weekOptions = useMemo(() => {
    const start = addWeeks(currentWeekIso(), -2);
    const base = weekIsoRange(start, 30);
    const extras = [
      ...drafts.map((d) => d.weekIso),
      ...(existingTasks ?? []).map((t) => t.weekIso),
    ].filter((w): w is string => Boolean(w) && !base.includes(w));
    return [...new Set([...base, ...extras])].sort();
  }, [drafts, existingTasks]);

  async function generate() {
    if (project.plannedMemberIds.length === 0) {
      setError(
        "このプロジェクトに想定担当メンバーが設定されていません。プロジェクト編集側で先に設定してください。",
      );
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const ctx = (existingTasks ?? []).map((t) => ({
        title: t.title,
        weekIso: t.weekIso,
        assigneeMemberId: t.assigneeMemberId,
      }));
      const res = await postJson<GenerateResponse>("/api/ai/generate-tasks", {
        name: project.name,
        summary: project.summary || project.name,
        dueDate: project.dueDate ?? null,
        plannedMemberIds: project.plannedMemberIds,
        existingTasks: ctx,
      });
      // 既存ドラフトを残したい場合もあるが、UX 上は「再生成すると入れ替わる」が素直。
      setDrafts(res.tasks.map(withLocalId));
      setRationale(res.rationale);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("504")) {
        setError(
          "AI の応答が時間内に返りませんでした。プロジェクトの概要を整理してから再度お試しください。",
        );
      } else if (msg.startsWith("502")) {
        setError(
          `AI 呼び出しでエラーが発生しました。少し待って再実行してください。(${msg.slice(0, 120)})`,
        );
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    const valid = drafts.filter(
      (d) => d.title.trim().length > 0 && /^\d{4}-W\d{2}$/.test(d.weekIso),
    );
    if (valid.length === 0) {
      setError("追加できるタスクがありません。タイトルと週を入力してください。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await postJson(`/api/projects/${project.id}/tasks-batch`, {
        tasks: valid.map(stripLocalId),
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  function updateDraft(idx: number, patch: Partial<DraftTask>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function deleteDraft(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }
  function addEmptyDraft() {
    const lastWeek = drafts[drafts.length - 1]?.weekIso ?? currentWeekIso();
    setDrafts((prev) => [
      ...prev,
      withLocalId({
        title: "",
        weekIso: lastWeek,
        assigneeMemberId: project.plannedMemberIds[0] ?? null,
        notes: null,
        estimatedHours: null,
      }),
    ]);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDrafts((prev) => {
      const from = prev.findIndex((d) => d._localId === active.id);
      const to = prev.findIndex((d) => d._localId === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  }

  const validCount = drafts.filter(
    (d) => d.title.trim().length > 0 && /^\d{4}-W\d{2}$/.test(d.weekIso),
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-panel modal-content modal-content--scroll">
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <div>
            <span className="eyebrow">ADD TASKS</span>
            <h2 className="t-h3" style={{ marginTop: 4 }}>
              {project.name} にタスクを追加
            </h2>
            <p
              className="t-small muted"
              style={{ marginTop: 4, maxWidth: 560 }}
            >
              既存タスクは保持されます。下のリストは「追加するタスク」だけです。
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            ×
          </button>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 220px",
            gap: 16,
            padding: 12,
            background: "rgba(255,255,255,.28)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <div>
            <div className="form-label">概要（プロジェクト編集側で変更）</div>
            <p
              className="t-small"
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                color: project.summary
                  ? "var(--color-text)"
                  : "var(--color-text-light)",
              }}
            >
              {project.summary || "(概要が未入力です。AI 生成の精度を上げるためにプロジェクト編集側で概要を入れてください)"}
            </p>
          </div>
          <div>
            <div className="form-label">想定担当メンバー</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {project.plannedMemberIds.length === 0 && (
                <span className="t-small muted">未設定</span>
              )}
              {members
                .filter((m) => project.plannedMemberIds.includes(m.id))
                .map((m) => (
                  <span
                    key={m.id}
                    className="t-small"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: m.color,
                      }}
                    />
                    {m.name}
                  </span>
                ))}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generate}
            disabled={generating || project.plannedMemberIds.length === 0}
          >
            {generating
              ? `AI が分析中… ${elapsedSec}s`
              : drafts.length > 0
                ? "AI で再生成（編集中の内容は置き換わります）"
                : "AI でたたき台を生成"}
          </button>
          {generating && (
            <span className="t-small muted">
              最大 2〜3 分かかることがあります
            </span>
          )}
          {!generating && drafts.length > 0 && (
            <span className="t-small muted">
              {drafts.length} 件の提案（{validCount} 件が追加対象）
            </span>
          )}
          {!generating && existingTasks && existingTasks.length > 0 && (
            <span className="t-small muted">
              既存 {existingTasks.length} 件は AI に伝えて重複を避けます
            </span>
          )}
          {error && (
            <span className="badge badge-error">{error}</span>
          )}
        </div>

        {rationale && (
          <p
            className="t-small muted"
            style={{
              marginTop: 8,
              padding: 10,
              background: "rgba(255,255,255,.32)",
              borderRadius: "var(--r-sm)",
            }}
          >
            {rationale}
          </p>
        )}

        {drafts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={drafts.map((d) => d._localId)}
                strategy={verticalListSortingStrategy}
              >
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: DRAFT_ROW_GRID,
                      gap: 8,
                      padding: "2px 8px",
                      fontSize: ".6875rem",
                      color: "var(--color-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    <span aria-hidden="true" />
                    <span>タスク</span>
                    <span>週</span>
                    <span>担当</span>
                    <span>見積</span>
                    <span></span>
                  </li>
                  {drafts.map((d, i) => (
                    <SortableDraftRow
                      key={d._localId}
                      id={d._localId}
                      draft={d}
                      index={i}
                      members={members}
                      plannedMemberIds={project.plannedMemberIds}
                      weekOptions={weekOptions}
                      onChange={updateDraft}
                      onDelete={deleteDraft}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addEmptyDraft}
              style={{ marginTop: 6 }}
            >
              ＋ 行を追加
            </button>
          </div>
        )}

        {drafts.length === 0 && !generating && (
          <div
            style={{
              marginTop: 14,
              padding: 18,
              background: "rgba(255,255,255,.22)",
              borderRadius: "var(--r-sm)",
              textAlign: "center",
            }}
          >
            <p className="t-small muted" style={{ margin: 0 }}>
              「AI でたたき台を生成」を押すと、既存タスクと工数を踏まえて
              新しいタスクを提案します。手動で 1 件ずつ追加することもできます。
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addEmptyDraft}
              style={{ marginTop: 10 }}
            >
              ＋ 手動で 1 件追加
            </button>
          </div>
        )}

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,.45)",
          }}
        >
          <button className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || validCount === 0}
          >
            {saving
              ? "追加中…"
              : validCount > 0
                ? `${validCount} 件を追加`
                : "タスクを追加"}
          </button>
        </footer>
      </div>
    </div>
  );
}
