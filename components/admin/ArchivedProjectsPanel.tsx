"use client";

import useSWR, { mutate } from "swr";
import { useEffect, useState } from "react";
import { del, fetcher, postJson } from "@/lib/api";
import { useEditMode } from "@/hooks/useEditMode";
import type { Company } from "@/lib/companies";
import { CompanyChip } from "@/components/CompanyChip";
import { LinkifiedText } from "@/components/LinkifiedText";

type Project = {
  id: number;
  name: string;
  summary: string;
  company: Company | null;
  dueDate: string | null;
  color: string;
  status: string;
  archivedAt: string | null;
};

const ARCHIVED_KEY = "/api/projects?archived=1";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export function ArchivedProjectsPanel() {
  const { isEdit } = useEditMode();
  const { data: projects } = useSWR<Project[]>(ARCHIVED_KEY, fetcher);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isEdit) setSelectedIds(new Set());
  }, [isEdit]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(new Set((projects ?? []).map((p) => p.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  function revalidateAll() {
    mutate(ARCHIVED_KEY);
    mutate("/api/projects");
    mutate((key) => typeof key === "string" && key.startsWith("/api/tasks"));
    mutate((key) => typeof key === "string" && key.startsWith("/api/workload"));
  }

  async function restoreProject(p: Project) {
    if (!confirm(`「${p.name}」をアクティブに戻します。`)) return;
    await postJson(`/api/projects/${p.id}/unarchive`, {});
    revalidateAll();
  }

  async function deleteProject(p: Project) {
    if (
      !confirm(
        `「${p.name}」を完全に削除します。\n関連するタスクもすべて削除され、復元できません。本当に削除しますか？`,
      )
    )
      return;
    await del(`/api/projects/${p.id}`);
    revalidateAll();
  }

  async function bulkRestore() {
    const targets = (projects ?? []).filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    if (!confirm(`選択中の ${targets.length} 件をアクティブに戻します。`)) return;
    for (const p of targets) {
      try {
        await postJson(`/api/projects/${p.id}/unarchive`, {});
      } catch (e) {
        console.error("unarchive failed", p.id, e);
      }
    }
    clearSelection();
    revalidateAll();
  }
  async function bulkDelete() {
    const targets = (projects ?? []).filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    if (
      !confirm(
        `選択中の ${targets.length} 件を完全に削除します。\n関連するタスクもすべて削除され、復元できません。本当に削除しますか？`,
      )
    )
      return;
    for (const p of targets) {
      try {
        await del(`/api/projects/${p.id}`);
      } catch (e) {
        console.error("delete failed", p.id, e);
      }
    }
    clearSelection();
    revalidateAll();
  }

  return (
    <section className="glass-panel" style={{ padding: 24, marginBottom: 16 }}>
      <header style={{ marginBottom: 12 }}>
        <span className="eyebrow">ARCHIVED PROJECTS</span>
        <h2 className="t-h3" style={{ marginTop: 4 }}>
          アーカイブ済みプロジェクト
        </h2>
        {!isEdit && (
          <p className="t-small muted" style={{ marginTop: 6 }}>
            復元・完全削除はヘッダの「編集」モードに切替えると操作できます。
          </p>
        )}
      </header>

      {isEdit && (projects?.length ?? 0) > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "8px 12px",
            marginBottom: 12,
            background: "rgba(255,255,255,.42)",
            border: "1px solid rgba(255,255,255,.6)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <span className="t-small" style={{ fontWeight: 600 }}>
            {selectedIds.size > 0
              ? `${selectedIds.size} 件選択中`
              : "複数選択して一括操作"}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={
              selectedIds.size === (projects?.length ?? 0)
                ? clearSelection
                : selectAll
            }
            style={{ fontSize: ".75rem" }}
          >
            {selectedIds.size === (projects?.length ?? 0)
              ? "選択解除"
              : "すべて選択"}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={bulkRestore}
            disabled={selectedIds.size === 0}
            style={{ fontSize: ".75rem" }}
          >
            一括復元
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={bulkDelete}
            disabled={selectedIds.size === 0}
            style={{ fontSize: ".75rem", color: "var(--color-error)" }}
          >
            一括削除
          </button>
        </div>
      )}

      {!projects ? (
        <p className="muted">読み込み中…</p>
      ) : projects.length === 0 ? (
        <p className="muted">アーカイブ済みのプロジェクトはありません。</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {projects.map((p) => {
            const selected = selectedIds.has(p.id);
            return (
            <li
              key={p.id}
              className="glass-card"
              style={{
                padding: "10px 14px",
                display: "grid",
                gridTemplateColumns: isEdit
                  ? "auto auto 1fr auto auto auto"
                  : "auto 1fr auto",
                gap: 10,
                alignItems: "center",
                outline: selected ? "2px solid var(--color-info)" : "none",
                outlineOffset: -2,
              }}
            >
              {isEdit && (
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={selected}
                  onChange={() => toggleSelected(p.id)}
                  aria-label={`${p.name} を選択`}
                />
              )}
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: p.color,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong>{p.name}</strong>
                  {p.company && <CompanyChip company={p.company} size="xs" />}
                </div>
                {p.summary && (
                  <div className="t-small muted" style={{ marginTop: 2 }}>
                    <LinkifiedText text={p.summary} />
                  </div>
                )}
              </div>
              <span className="t-small muted">
                アーカイブ {fmtDate(p.archivedAt)}
              </span>
              {isEdit && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => restoreProject(p)}
                    title="アクティブに戻す"
                  >
                    復元
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => deleteProject(p)}
                    title="完全削除（取り消し不可）"
                    style={{ color: "var(--color-error)" }}
                  >
                    削除
                  </button>
                </>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
