"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { postJson } from "@/lib/api";
import {
  addWeeks,
  currentWeekIso,
  weekIsoLabel,
  weekIsoRange,
} from "@/lib/week";
import { restoreDraft, useAutosaveDraft } from "@/hooks/useAutosaveDraft";
import { COMPANIES, type Company } from "@/lib/companies";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ProjectAddTasksModal も同じ DraftTask / SortableDraftRow を使うため export する。
export type Member = { id: number; name: string; color: string };

export type DraftTask = {
  title: string;
  weekIso: string;
  assigneeMemberId: number | null;
  notes: string | null;
  estimatedHours: number | null;
};

export type DraftRow = DraftTask & { _localId: string };

export const DRAFT_ROW_GRID = "24px 1fr 120px 120px 70px 24px";
const ROW_GRID = DRAFT_ROW_GRID;

export function withLocalId(t: DraftTask): DraftRow {
  return { ...t, _localId: crypto.randomUUID() };
}

export function stripLocalId({ _localId: _omit, ...rest }: DraftRow): DraftTask {
  return rest;
}

type StoredProjectDraft = {
  name: string;
  summary: string;
  notes: string;
  company: Company | "";
  dueDate: string;
  plannedMemberIds: number[];
  isPrivate: boolean;
  visibleMemberIds: number[];
  drafts: DraftTask[];
  rationale: string;
};

const DRAFT_KEY = "mb-schedule:draft:project-create";
const DRAFT_VERSION = 1;

type GenerateResponse = {
  tasks: DraftTask[];
  rationale: string;
  meta: { startWeek: string; endWeek: string; model: string };
};

export function ProjectCreateModal({
  members,
  onClose,
  onCreated,
}: {
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [initial] = useState<StoredProjectDraft | null>(() =>
    restoreDraft<StoredProjectDraft>(DRAFT_KEY, DRAFT_VERSION),
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [company, setCompany] = useState<Company | "">(initial?.company ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [plannedMemberIds, setPlannedMemberIds] = useState<number[]>(
    initial?.plannedMemberIds ?? [],
  );
  const [isPrivate, setIsPrivate] = useState<boolean>(initial?.isPrivate ?? false);
  const [visibleMemberIds, setVisibleMemberIds] = useState<number[]>(
    initial?.visibleMemberIds ?? [],
  );
  const [drafts, setDrafts] = useState<DraftRow[]>(() =>
    (initial?.drafts ?? []).map(withLocalId),
  );
  const [rationale, setRationale] = useState<string>(initial?.rationale ?? "");
  const [generating, setGenerating] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [saving, setSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
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

  const draftSnapshot = useMemo<StoredProjectDraft>(
    () => ({
      name,
      summary,
      notes,
      company,
      dueDate,
      plannedMemberIds,
      isPrivate,
      visibleMemberIds,
      drafts: drafts.map(stripLocalId),
      rationale,
    }),
    [name, summary, notes, company, dueDate, plannedMemberIds, isPrivate, visibleMemberIds, drafts, rationale],
  );
  const { clear: clearStoredDraft } = useAutosaveDraft(
    DRAFT_KEY,
    DRAFT_VERSION,
    draftSnapshot,
    { skip: saving },
  );

  const weekOptions = useMemo(() => {
    const start = addWeeks(currentWeekIso(), -2);
    const base = weekIsoRange(start, 26);
    const extras = drafts
      .map((d) => d.weekIso)
      .filter((w): w is string => Boolean(w) && !base.includes(w));
    return [...new Set([...base, ...extras])].sort();
  }, [drafts]);

  function togglePlannedMember(id: number) {
    setPlannedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function generate() {
    if (!name.trim() || !summary.trim() || plannedMemberIds.length === 0) {
      setAiError("プロジェクト名・概要・担当メンバー(1名以上)を入力してください。");
      return;
    }
    setAiError(null);
    setGenerating(true);
    try {
      const res = await postJson<GenerateResponse>(
        "/api/ai/generate-tasks",
        {
          name: name.trim(),
          summary: summary.trim(),
          dueDate: dueDate || null,
          plannedMemberIds,
        },
      );
      setDrafts(res.tasks.map(withLocalId));
      setRationale(res.rationale);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("504")) {
        setAiError(
          "AI の応答が時間内に返りませんでした。プロジェクト概要を短くして、もう一度お試しください。",
        );
      } else if (msg.startsWith("502")) {
        setAiError(
          `AI 呼び出しでエラーが発生しました。少し待って再実行してください。(${msg.slice(0, 120)})`,
        );
      } else {
        setAiError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setAiError("プロジェクト名を入力してください。");
      return;
    }
    setSaving(true);
    try {
      await postJson("/api/projects", {
        name: name.trim(),
        summary: summary.trim(),
        notes: notes.trim(),
        company: company || null,
        dueDate: dueDate || null,
        plannedMemberIds,
        isPrivate,
        visibleMemberIds: isPrivate ? visibleMemberIds : [],
        tasks: drafts.map(stripLocalId),
        aiSeed: drafts.length
          ? { summary: summary.trim(), dueDate: dueDate || undefined, plannedMemberIds }
          : null,
      });
      clearStoredDraft();
      onCreated();
    } catch (e) {
      setAiError((e as Error).message);
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
    const lastWeek = drafts[drafts.length - 1]?.weekIso;
    setDrafts((prev) => [
      ...prev,
      withLocalId({
        title: "",
        weekIso: lastWeek ?? "",
        assigneeMemberId: plannedMemberIds[0] ?? null,
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
            <span className="eyebrow">NEW PROJECT</span>
            <h2 className="t-h3" style={{ marginTop: 4 }}>
              プロジェクト新規作成
            </h2>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            ×
          </button>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 240px",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="form-label">プロジェクト名 *</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: LP リニューアル Q2"
              />
            </div>
            <div>
              <label className="form-label">概要 *</label>
              <textarea
                className="input"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="目的・ゴール・主要なフェーズ・前提などを箇条書きで。AI がここからタスクを洗い出します。"
                rows={6}
              />
            </div>
            <div>
              <label className="form-label">メモ</label>
              <textarea
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="参考リンク・連絡事項・進行中のメモなど（URL は自動でリンクになります）"
                rows={4}
              />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">会社タグ</label>
                <select
                  className="input"
                  value={company}
                  onChange={(e) =>
                    setCompany(e.target.value as Company | "")
                  }
                >
                  <option value="">（未設定）</option>
                  {COMPANIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">期日</label>
                <input
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="form-label">想定担当メンバー *</label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 10,
                background: "rgba(255,255,255,.32)",
                borderRadius: "var(--r-sm)",
                border: "1px solid rgba(255,255,255,.55)",
              }}
            >
              {members.map((m) => (
                <label
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: ".8125rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={plannedMemberIds.includes(m.id)}
                    onChange={() => togglePlannedMember(m.id)}
                  />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: m.color,
                    }}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: ".8125rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              className="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            <span>
              <strong>非公開</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: ".75rem" }}>
                担当メンバー＋下で選んだメンバーだけに見えます
              </span>
            </span>
          </label>

          {isPrivate && (
            <div style={{ marginTop: 10, paddingLeft: 24 }}>
              <div className="form-label" style={{ marginBottom: 6 }}>
                追加で閲覧できるメンバー
                <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                  （担当に加えて見せる人）
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {members
                  .filter((m) => !plannedMemberIds.includes(m.id))
                  .map((m) => {
                    const active = visibleMemberIds.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: ".8125rem",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={active}
                          onChange={() =>
                            setVisibleMemberIds((prev) =>
                              prev.includes(m.id)
                                ? prev.filter((x) => x !== m.id)
                                : [...prev, m.id],
                            )
                          }
                        />
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: m.color,
                          }}
                          aria-hidden="true"
                        />
                        {m.name}
                      </label>
                    );
                  })}
                {members.filter((m) => !plannedMemberIds.includes(m.id)).length === 0 && (
                  <span className="t-small muted">担当メンバー以外がいません</span>
                )}
              </div>
            </div>
          )}
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
            disabled={generating || !name.trim() || !summary.trim() || plannedMemberIds.length === 0}
          >
            {generating
              ? `AI が分析中… ${elapsedSec}s`
              : "タスクを AI で洗い出す"}
          </button>
          {generating && (
            <span className="t-small muted">
              最大 2〜3 分かかることがあります
            </span>
          )}
          {!generating && drafts.length > 0 && (
            <span className="t-small muted">
              {drafts.length} 件のタスク提案
            </span>
          )}
          {aiError && (
            <span className="badge badge-error">{aiError}</span>
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
                      gridTemplateColumns: ROW_GRID,
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
                      plannedMemberIds={plannedMemberIds}
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
            disabled={saving || !name.trim()}
          >
            {saving ? "保存中…" : "プロジェクトを作成"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SortableDraftRow({
  id,
  draft,
  index,
  members,
  plannedMemberIds,
  weekOptions,
  onChange,
  onDelete,
}: {
  id: string;
  draft: DraftRow;
  index: number;
  members: Member[];
  plannedMemberIds: number[];
  weekOptions: string[];
  onChange: (idx: number, patch: Partial<DraftTask>) => void;
  onDelete: (idx: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    display: "grid",
    gridTemplateColumns: ROW_GRID,
    gap: 8,
    alignItems: "center",
    padding: 8,
    background: "rgba(255,255,255,.32)",
    borderRadius: "var(--r-sm)",
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 2 : "auto",
    position: "relative",
  };

  return (
    <li ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="この行を並び替え"
        className="btn btn-ghost btn-sm"
        style={{
          padding: "2px 4px",
          fontSize: ".875rem",
          lineHeight: 1,
          color: "var(--color-text-muted)",
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        ⋮⋮
      </button>
      <input
        className="input"
        value={draft.title}
        onChange={(e) => onChange(index, { title: e.target.value })}
        style={{ fontSize: ".8125rem" }}
      />
      <select
        className="input"
        value={draft.weekIso}
        onChange={(e) => onChange(index, { weekIso: e.target.value })}
        title={draft.weekIso}
        style={{ fontSize: ".75rem" }}
      >
        {!draft.weekIso && <option value="">週を選択</option>}
        {weekOptions.map((w) => (
          <option key={w} value={w}>
            {weekIsoLabel(w)}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={draft.assigneeMemberId ?? ""}
        onChange={(e) =>
          onChange(index, {
            assigneeMemberId: e.target.value ? Number(e.target.value) : null,
          })
        }
        style={{ fontSize: ".75rem" }}
      >
        <option value="">未割当</option>
        {members
          .filter((m) => plannedMemberIds.includes(m.id))
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
      <input
        className="input"
        type="number"
        min={0}
        max={40}
        step={0.5}
        value={draft.estimatedHours ?? ""}
        onChange={(e) =>
          onChange(index, {
            estimatedHours: e.target.value === "" ? null : Number(e.target.value),
          })
        }
        placeholder="h"
        style={{ fontSize: ".75rem", padding: "4px 8px" }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onDelete(index)}
        style={{ padding: "2px 6px" }}
      >
        ×
      </button>
    </li>
  );
}
