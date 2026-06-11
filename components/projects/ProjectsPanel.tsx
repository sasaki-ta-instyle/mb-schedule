"use client";

import useSWR, { mutate } from "swr";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { addWeeks, currentWeekIso, weekIsoLabel, weekIsoRange } from "@/lib/week";
import { fetcher, postJson, del } from "@/lib/api";
import { SWR_REFRESH_MS } from "@/lib/swr-config";
import { useEditMode } from "@/hooks/useEditMode";
import { restoreDraft, useAutosaveDraft } from "@/hooks/useAutosaveDraft";
import { useTaskHistory } from "@/hooks/useTaskHistory";
import { COMPANIES, type Company } from "@/lib/companies";
import { CompanyChip } from "@/components/CompanyChip";
import { LinkifiedText } from "@/components/LinkifiedText";
import { ActionMenu } from "@/components/common/ActionMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { ProjectCreateModal } from "@/components/admin/ProjectCreateModal";
import { ProjectAddTasksModal } from "@/components/admin/ProjectAddTasksModal";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
type Member = { id: number; name: string; color: string };
type Project = {
  id: number;
  name: string;
  summary: string;
  notes: string;
  company: Company | null;
  dueDate: string | null;
  color: string;
  status: string;
  plannedMemberIds: number[];
  isPrivate?: boolean;
};
type Task = {
  id: number;
  projectId: number;
  title: string;
  assigneeMemberId: number | null;
  weekIso: string;
  done: boolean;
  notes: string | null;
  estimatedHours: string | null;
  sortOrder: number;
};

// ──────────────────────────────────────────────
// Constants & storage keys
// ──────────────────────────────────────────────
const RANGE = 12;

// 統合後の新キー。旧 `mb-schedule:project-expanded` (TaskBoard) と
// `mb-schedule:admin-project-expanded` (AdminPanel) の和集合をここに書き、旧キーは削除する。
const EXPANDED_STORAGE_KEY = "mb-schedule:projects-expanded";
const PAGE_SIZE_STORAGE_KEY = "mb-schedule:projects-page-size";

// 旧キー（マイグレーションで吸い上げてから削除する）
const LEGACY_EXPANDED_KEYS = [
  "mb-schedule:project-expanded",
  "mb-schedule:admin-project-expanded",
] as const;
const LEGACY_PAGE_SIZE_KEY = "mb-schedule:admin-projects-page-size";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 10;

const ROW_GRID_TASKBOARD = "20px auto 1fr 110px 110px 64px auto";

// ──────────────────────────────────────────────
// Row styles (TaskBoard から移植)
// ──────────────────────────────────────────────
const baseRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: ROW_GRID_TASKBOARD,
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: "var(--r-sm)",
};

const dragHandleStyle: CSSProperties = {
  padding: "2px 2px",
  fontSize: ".875rem",
  lineHeight: 1,
  color: "var(--color-text-light)",
  cursor: "grab",
  touchAction: "none",
};

const dragHandleStyleDragging: CSSProperties = {
  ...dragHandleStyle,
  cursor: "grabbing",
};

const doneRowStyle: CSSProperties = {
  ...baseRowStyle,
  background: "var(--glass-tinted)",
  opacity: 0.6,
};

const doneRowHandleStyle: CSSProperties = {
  fontSize: ".875rem",
  lineHeight: 1,
  color: "var(--color-text-light)",
  textAlign: "center",
  cursor: "not-allowed",
};

const removeBtnStyle: CSSProperties = { fontSize: ".75rem" };

const taskListStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const dragOverlayCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "var(--space-3) var(--space-4)",
  borderRadius: "var(--r)",
  background: "var(--glass-light)",
  backdropFilter: "var(--glass-blur-sm)",
  WebkitBackdropFilter: "var(--glass-blur-sm)",
  boxShadow: "var(--glass-shadow)",
  border: "1px solid var(--glass-border-l)",
  cursor: "grabbing",
  minWidth: 240,
  maxWidth: 360,
};
const dragOverlayProjectStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: ".6875rem",
  color: "var(--color-text-muted)",
  letterSpacing: ".04em",
  textTransform: "uppercase",
};
const dragOverlayProjectDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};
const dragOverlayTitleStyle: CSSProperties = {
  fontSize: ".875rem",
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1.35,
};
const dragOverlayMetaStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  fontSize: ".75rem",
  color: "var(--color-text-muted)",
};

// ──────────────────────────────────────────────
// localStorage migration helpers
// ──────────────────────────────────────────────
function migrateExpandedKeys(): Set<number> {
  if (typeof window === "undefined") return new Set<number>();
  const union = new Set<number>();
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === "number") union.add(v);
      }
    }
  } catch {
    // 破損は無視
  }
  let migrated = false;
  for (const key of LEGACY_EXPANDED_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === "number") union.add(v);
      }
      localStorage.removeItem(key);
      migrated = true;
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }
  if (migrated) {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...union]));
    } catch {}
  }
  // page-size の旧キーも統合
  try {
    const newSize = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const oldSize = localStorage.getItem(LEGACY_PAGE_SIZE_KEY);
    if (!newSize && oldSize) {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, oldSize);
    }
    if (oldSize) localStorage.removeItem(LEGACY_PAGE_SIZE_KEY);
  } catch {}
  return union;
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────
export function ProjectsPanel() {
  const searchParams = useSearchParams();
  const { isEdit, currentMemberId } = useEditMode();

  const [anchorWeek] = useState<string>(addWeeks(currentWeekIso(), -2));
  const weeks = useMemo(() => weekIsoRange(anchorWeek, RANGE), [anchorWeek]);
  const weekFrom = weeks[0];
  const weekTo = weeks[weeks.length - 1];

  // フィルタ
  const [filterMember, setFilterMember] = useState<
    number | "all" | "unassigned"
  >("all");
  const filterAutoInitRef = useRef(false);
  useEffect(() => {
    if (filterAutoInitRef.current) return;
    if (currentMemberId == null) return;
    filterAutoInitRef.current = true;
    setFilterMember(currentMemberId);
  }, [currentMemberId]);

  const [filterDone, setFilterDone] = useState<"all" | "open" | "done">("all");
  const [keyword, setKeyword] = useState<string>("");

  // 展開（プロジェクトカード）
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandedHydrated, setExpandedHydrated] = useState(false);

  // 完了済みセクション
  const [completedExpanded, setCompletedExpanded] = useState<Set<number>>(
    new Set(),
  );
  const toggleCompletedExpanded = useCallback((projectId: number) => {
    setCompletedExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  // page size / page
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [pageSizeHydrated, setPageSizeHydrated] = useState(false);

  // 一括選択
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!isEdit) setSelectedIds(new Set());
  }, [isEdit]);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [addTasksProjectId, setAddTasksProjectId] = useState<number | null>(
    null,
  );

  // DnD
  const [activeId, setActiveId] = useState<number | null>(null);
  const isDragging = activeId != null;

  // aria-live
  const [liveMessage, setLiveMessage] = useState<string>("");

  // /tasks や /admin からの誘導 notice
  const fromParam = searchParams?.get("from") ?? null;
  const [noticeKind, setNoticeKind] = useState<"tasks" | null>(null);
  useEffect(() => {
    if (fromParam === "tasks") setNoticeKind("tasks");
    // ?from は URL に残しても害は無いが、open 処理側で消費するときに一緒に消える
  }, [fromParam]);

  // ── localStorage マイグレーション + ハイドレーション ──
  useEffect(() => {
    const migrated = migrateExpandedKeys();
    setExpanded(migrated);
    setExpandedHydrated(true);

    try {
      const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      if (raw) {
        const n = Number(raw);
        if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) {
          setPageSize(n as PageSize);
        }
      }
    } catch {}
    setPageSizeHydrated(true);
  }, []);

  useEffect(() => {
    if (!expandedHydrated) return;
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expanded]));
    } catch {}
  }, [expanded, expandedHydrated]);

  useEffect(() => {
    if (!pageSizeHydrated) return;
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
    } catch {}
  }, [pageSize, pageSizeHydrated]);

  // ── データ取得 ──
  const { data: members } = useSWR<Member[]>("/api/members", fetcher);
  const { data: projects } = useSWR<Project[]>("/api/projects", fetcher);
  const tasksKey = `/api/tasks?weekFrom=${weekFrom}&weekTo=${weekTo}`;
  const { data: tasks } = useSWR<Task[]>(tasksKey, fetcher, {
    refreshInterval: isDragging ? 0 : SWR_REFRESH_MS,
    revalidateOnFocus: !isDragging,
  });
  const workloadKey = `/api/workload?weekFrom=${weekFrom}&weekTo=${weekTo}`;

  const memberById = useMemo(() => {
    const m: Record<number, Member> = {};
    for (const x of members ?? []) m[x.id] = x;
    return m;
  }, [members]);
  const projectById = useMemo(() => {
    const m: Record<number, Project> = {};
    for (const p of projects ?? []) m[p.id] = p;
    return m;
  }, [projects]);

  // ── キーワード（タスク + プロジェクト横断）──
  const deferredKeyword = useDeferredValue(keyword);
  const trimmedKeyword = deferredKeyword.trim().toLowerCase();

  // タスク側のキーワード判定（プロジェクト名も拾う）
  const filteredTasks = useMemo(() => {
    return (tasks ?? []).filter((t) => {
      if (filterMember === "unassigned") {
        // タスク側: 未担当 + 「プロジェクト plannedMemberIds が空」のいずれかにマッチ
        if (t.assigneeMemberId != null) return false;
      } else if (filterMember !== "all") {
        // 担当タスク or 「対象メンバーが計画担当のプロジェクトのタスク」
        const proj = projectById[t.projectId];
        const memberInProject =
          proj?.plannedMemberIds.includes(filterMember) ?? false;
        if (t.assigneeMemberId !== filterMember && !memberInProject) {
          return false;
        }
      }
      if (filterDone === "open" && t.done) return false;
      if (filterDone === "done" && !t.done) return false;
      if (trimmedKeyword) {
        const proj = projectById[t.projectId];
        const haystack = [
          t.title,
          t.notes ?? "",
          proj?.name ?? "",
          proj?.summary ?? "",
          proj?.notes ?? "",
          proj?.company ?? "",
        ]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(trimmedKeyword)) return false;
      }
      return true;
    });
  }, [tasks, filterMember, filterDone, trimmedKeyword, projectById]);

  const grouped = useMemo(() => {
    const m: Record<number, Task[]> = {};
    for (const t of filteredTasks) (m[t.projectId] ??= []).push(t);
    return m;
  }, [filteredTasks]);

  type WeekBucket = {
    weekIso: string;
    open: Task[];
    done: Task[];
    openIds: number[];
  };
  const groupedByWeek = useMemo(() => {
    const m: Record<number, WeekBucket[]> = {};
    for (const projectId of Object.keys(grouped).map(Number)) {
      const byWeek = new Map<string, WeekBucket>();
      for (const t of grouped[projectId]) {
        let b = byWeek.get(t.weekIso);
        if (!b) {
          b = { weekIso: t.weekIso, open: [], done: [], openIds: [] };
          byWeek.set(t.weekIso, b);
        }
        if (t.done) {
          b.done.push(t);
        } else {
          b.open.push(t);
          b.openIds.push(t.id);
        }
      }
      const buckets = [...byWeek.values()].sort((a, b) =>
        a.weekIso.localeCompare(b.weekIso),
      );
      m[projectId] = buckets;
    }
    return m;
  }, [grouped]);

  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasks ?? []) m.set(t.id, t);
    return m;
  }, [tasks]);
  const tasksByIdRef = useRef(tasksById);
  useEffect(() => {
    tasksByIdRef.current = tasksById;
  }, [tasksById]);

  // ── プロジェクト側のキーワード/フィルタ判定 ──
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      // 担当フィルタ: 未割当 = plannedMemberIds 空、特定 = 含まれる
      if (filterMember === "unassigned") {
        if (p.plannedMemberIds.length > 0 && (grouped[p.id]?.length ?? 0) === 0) {
          // タスク経由で「未担当タスクを持つプロジェクト」も拾うので、両方0のときだけ除外
          return false;
        }
      } else if (filterMember !== "all") {
        const inPlanned = p.plannedMemberIds.includes(filterMember);
        const hasMatchingTask = (grouped[p.id]?.length ?? 0) > 0;
        if (!inPlanned && !hasMatchingTask) return false;
      }
      if (trimmedKeyword) {
        const hay =
          `${p.name}\n${p.summary ?? ""}\n${p.notes ?? ""}\n${p.company ?? ""}`.toLowerCase();
        const hitProject = hay.includes(trimmedKeyword);
        const hitTask = (grouped[p.id]?.length ?? 0) > 0;
        if (!hitProject && !hitTask) return false;
      }
      if (filterDone !== "all") {
        // 状態フィルタが効いている場合、該当タスクが 0 件のプロジェクトは隠す
        if ((grouped[p.id]?.length ?? 0) === 0) return false;
      }
      return true;
    });
  }, [projects, filterMember, trimmedKeyword, filterDone, grouped]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  // ジャンプ処理（?open=<id>）の中で filter を all にリセットすると、
  // 下の page-reset effect が走って setPage(N) が setPage(1) に上書きされ、
  // target プロジェクトが page 1 にいない場合は DOM に出現せずスクロール
  // できなくなる。ジャンプ中は 1 回だけスキップする。
  const skipNextPageResetRef = useRef(false);
  useEffect(() => {
    if (skipNextPageResetRef.current) {
      skipNextPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [filterMember, filterDone, trimmedKeyword, pageSize]);

  const pagedProjects = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredProjects.slice(start, start + pageSize);
  }, [filteredProjects, safePage, pageSize]);

  const { pushHistory } = useTaskHistory();

  // ── タスクパッチの楽観更新（TaskBoard から移植）──
  const commitTaskPatch = useCallback(
    async (
      id: number,
      patch: Record<string, unknown>,
      apply: (t: Task) => Task,
      opts: { affectsWorkload: boolean },
    ) => {
      await mutate<Task[]>(
        tasksKey,
        async (current) => {
          await postJson(`/api/tasks/${id}`, patch, "PATCH");
          return (current ?? []).map((t) => (t.id === id ? apply(t) : t));
        },
        {
          optimisticData: (current) =>
            (current ?? []).map((t) => (t.id === id ? apply(t) : t)),
          rollbackOnError: true,
          populateCache: true,
          revalidate: false,
        },
      );
      if (opts.affectsWorkload) mutate(workloadKey);
    },
    [tasksKey, workloadKey],
  );

  const toggleDone = useCallback(
    async (t: Task) => {
      const newDone = !t.done;
      const oldDone = t.done;
      try {
        await commitTaskPatch(
          t.id,
          { done: newDone },
          (x) => ({ ...x, done: newDone }),
          { affectsWorkload: false },
        );
      } catch (e) {
        console.error("toggleDone failed", e);
        return;
      }
      pushHistory({
        label: "完了切替",
        do: () =>
          commitTaskPatch(
            t.id,
            { done: newDone },
            (x) => ({ ...x, done: newDone }),
            { affectsWorkload: false },
          ),
        undo: () =>
          commitTaskPatch(
            t.id,
            { done: oldDone },
            (x) => ({ ...x, done: oldDone }),
            { affectsWorkload: false },
          ),
      });
    },
    [commitTaskPatch, pushHistory],
  );

  const updateTaskField = useCallback(
    async (t: Task, patch: Record<string, unknown>) => {
      const oldPatch: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) {
        const v = (t as unknown as Record<string, unknown>)[k];
        if (v !== undefined) oldPatch[k] = v;
      }
      const affectsWorkload =
        "estimatedHours" in patch ||
        "assigneeMemberId" in patch ||
        "weekIso" in patch;
      const applyPatch =
        (p: Record<string, unknown>) =>
        (x: Task): Task =>
          ({ ...x, ...p }) as Task;
      try {
        await commitTaskPatch(t.id, patch, applyPatch(patch), {
          affectsWorkload,
        });
      } catch (e) {
        console.error("updateTaskField failed", e);
        return;
      }
      pushHistory({
        label: "編集",
        do: () =>
          commitTaskPatch(t.id, patch, applyPatch(patch), { affectsWorkload }),
        undo: () =>
          commitTaskPatch(t.id, oldPatch, applyPatch(oldPatch), {
            affectsWorkload,
          }),
      });
    },
    [commitTaskPatch, pushHistory],
  );

  const removeTask = useCallback(
    async (t: Task) => {
      await del(`/api/tasks/${t.id}`);
      mutate(tasksKey);
      mutate(workloadKey);
    },
    [tasksKey, workloadKey],
  );

  function applyOptimisticOrder(map: Map<number, number>) {
    return (prev: Task[] = []) =>
      [...prev]
        .map((t) => (map.has(t.id) ? { ...t, sortOrder: map.get(t.id)! } : t))
        .sort(
          (a, b) =>
            a.weekIso.localeCompare(b.weekIso) ||
            a.sortOrder - b.sortOrder ||
            a.id - b.id,
        );
  }
  async function commitReorderMap(map: Map<number, number>) {
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
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function reorderInWeekGroup(
    projectId: number,
    weekIso: string,
    fromId: number,
    toId: number,
  ) {
    if (fromId === toId) return;
    const bucket = (groupedByWeek[projectId] ?? []).find(
      (b) => b.weekIso === weekIso,
    );
    if (!bucket) return;
    const fromIdx = bucket.open.findIndex((t) => t.id === fromId);
    const toIdx = bucket.open.findIndex((t) => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const nextOpen = arrayMove(bucket.open, fromIdx, toIdx);
    const prevOrderMap = new Map(
      bucket.open.map((t, i) => [t.id, i] as const),
    );
    const nextOrderMap = new Map(nextOpen.map((t, i) => [t.id, i] as const));
    try {
      await commitReorderMap(nextOrderMap);
      pushHistory({
        label: "並び替え",
        do: () => commitReorderMap(nextOrderMap),
        undo: () => commitReorderMap(prevOrderMap),
      });
    } catch (e) {
      console.error("reorder failed", e);
      try {
        await mutate(tasksKey);
      } catch {}
    }
  }

  // ── プロジェクト側の操作（AdminPanel から）──
  function revalidateAll() {
    mutate("/api/projects");
    mutate(
      (key) =>
        typeof key === "string" && key.startsWith("/api/projects?archived"),
    );
    mutate((key) => typeof key === "string" && key.startsWith("/api/tasks"));
    mutate((key) => typeof key === "string" && key.startsWith("/api/workload"));
  }
  async function updateProject(p: Project, patch: Partial<Project>) {
    mutate(
      "/api/projects",
      (prev: Project[] = []) =>
        prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)),
      { revalidate: false },
    );
    await postJson(`/api/projects/${p.id}`, patch, "PATCH");
    mutate("/api/projects");
  }
  async function archiveProject(p: Project) {
    if (
      !confirm(
        `「${p.name}」をアーカイブします。\nダッシュボードからは消えますが、アーカイブページからいつでも復元できます。`,
      )
    )
      return;
    await postJson(`/api/projects/${p.id}/archive`, {});
    revalidateAll();
  }
  async function deleteProject(p: Project) {
    if (
      !confirm(
        `「${p.name}」を完全に削除します。\n関連するタスク・工数もすべて削除され、復元できません。本当に削除しますか？`,
      )
    )
      return;
    await del(`/api/projects/${p.id}`);
    revalidateAll();
  }
  function togglePlannedMember(p: Project, memberId: number) {
    const next = p.plannedMemberIds.includes(memberId)
      ? p.plannedMemberIds.filter((x) => x !== memberId)
      : [...p.plannedMemberIds, memberId];
    return updateProject(p, { plannedMemberIds: next });
  }
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
  async function bulkArchive() {
    const targets = (projects ?? []).filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    if (
      !confirm(
        `選択中の ${targets.length} 件をアーカイブします。\nダッシュボードからは消えますが、アーカイブページから復元できます。`,
      )
    )
      return;
    for (const p of targets) {
      try {
        await postJson(`/api/projects/${p.id}/archive`, {});
      } catch (e) {
        console.error("archive failed", p.id, e);
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
        `選択中の ${targets.length} 件を完全に削除します。\n関連するタスク・工数もすべて削除され、復元できません。本当に削除しますか？`,
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

  function toggleExpanded(projectId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  // ── ?open=<id> ジャンプフロー ──
  const openParam = searchParams?.get("open") ?? null;
  // 「最後に処理した id」を覚えておくと、同じ session で別タスクをクリック
  // して別 id でジャンプし直したいケースに対応できる。boolean フラグだと
  // 1 回限りで、2 回目以降が無反応に見えてしまう。
  const lastJumpedIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!openParam) return;
    if (!projects || projects.length === 0) return;
    if (!expandedHydrated) return;
    const id = Number(openParam);
    if (!Number.isFinite(id)) return;
    if (lastJumpedIdRef.current === id) return;
    const targetProject = projects.find((p) => p.id === id);
    if (!targetProject) return;

    lastJumpedIdRef.current = id;

    // 1. フィルタを all にリセット。
    // 直後に page-reset effect が走るが、ジャンプ専用に 1 回スキップする。
    skipNextPageResetRef.current = true;
    setFilterMember("all");
    setFilterDone("all");
    setKeyword("");
    filterAutoInitRef.current = true; // ログインメンバーの自動上書きを止める

    // 2. 対象を含むページに移動（フィルタ all + projects 順で計算）
    const idx = projects.findIndex((p) => p.id === id);
    if (idx >= 0) setPage(Math.floor(idx / pageSize) + 1);

    // 3. 展開（他は閉じて target だけ開く: 着地点の DOM 位置を安定させる）
    setExpanded(new Set([id]));

    // 4. スクロール + 灯り。
    // iOS Safari は scrollIntoView がレイアウト確定や sticky header と
    // 競合して効かないことがあるため、window.scrollTo で明示的に Y 座標
    // 計算してジャンプする。target 要素が DOM に現れるまで 50ms × 20 回
    // ポーリング。出現後は 0ms / 300ms / 800ms の 3 段スクロールで、
    // タスクリストなどの async 描画後のレイアウトズレも補正する。
    const HEADER_OFFSET = 90; // AppShell sticky header 想定の offset
    const performScroll = (): HTMLElement | null => {
      const el = document.getElementById(`project-${id}`);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const y = Math.max(0, window.scrollY + rect.top - HEADER_OFFSET);
      // globals.css で html { scroll-behavior: smooth } が指定されているため、
      // window.scrollTo({behavior:'auto'}) でも smooth が効いてしまい、
      // 3 段スクロールが互いに割り込み合って中途半端な位置で止まる。
      // 一時的に scroll-behavior を auto に上書きしてから scrollTop 直接代入
      // （CSS をバイパスして必ず instant）で確実にジャンプし、次フレームで
      // smooth に戻す。
      const html = document.documentElement;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, y);
      html.scrollTop = y;
      if (document.body) document.body.scrollTop = y;
      requestAnimationFrame(() => {
        html.style.scrollBehavior = prev;
      });
      return el;
    };

    let scrolled = false;
    let tries = 0;
    const MAX_TRIES = 20; // 20 * 50ms = 最大 1000ms 待つ
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    let recheck1: ReturnType<typeof setTimeout> | null = null;
    let recheck2: ReturnType<typeof setTimeout> | null = null;
    const poll = setInterval(() => {
      const el = performScroll();
      if (el && !scrolled) {
        scrolled = true;
        clearInterval(poll);
        el.dataset.justOpened = "true";
        setLiveMessage(`${targetProject.name} に移動しました`);
        highlightTimer = setTimeout(() => {
          delete el.dataset.justOpened;
        }, 1500);
        (window as unknown as { __projectsArrivalTimer?: number }).__projectsArrivalTimer =
          highlightTimer as unknown as number;
        // 後発レイアウト変化を 2 回追従補正
        recheck1 = setTimeout(performScroll, 300);
        recheck2 = setTimeout(performScroll, 800);
      } else if (++tries >= MAX_TRIES) {
        clearInterval(poll);
      }
    }, 50);

    // 5. URL から ?open / ?from を消費（hash は維持）
    // router.replace は basePath を自動前置するため、すでに basePath を含む
    // window.location.pathname を渡すと二重前置になり 404 する。
    // ここではナビゲートではなく URL バーの掃除だけが目的なので history API を直接使う。
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    url.searchParams.delete("from");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);

    return () => {
      clearInterval(poll);
      if (highlightTimer) clearTimeout(highlightTimer);
      if (recheck1) clearTimeout(recheck1);
      if (recheck2) clearTimeout(recheck2);
    };
  }, [openParam, projects, expandedHydrated, pageSize]);

  // ── DnD active info ──
  const activeTask =
    activeId != null ? tasksById.get(activeId) ?? null : null;
  const activeProject =
    activeTask != null
      ? (projects ?? []).find((p) => p.id === activeTask.projectId) ?? null
      : null;
  const activeAssignee =
    activeTask?.assigneeMemberId != null
      ? memberById[activeTask.assigneeMemberId] ?? null
      : null;

  // ── EmptyState の分岐用 ──
  const projectsLoaded = !!projects;
  const totalProjectCount = projects?.length ?? 0;
  const visibleCount = filteredProjects.length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => {
        const id = Number(e.active.id);
        if (Number.isFinite(id)) setActiveId(id);
      }}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = e;
        if (!over) return;
        const fromId = Number(active.id);
        const toId = Number(over.id);
        if (!Number.isFinite(fromId) || !Number.isFinite(toId)) return;
        if (fromId === toId) return;
        const fromTask = tasksByIdRef.current.get(fromId);
        const overTask = tasksByIdRef.current.get(toId);
        if (!fromTask || !overTask) return;
        if (fromTask.projectId !== overTask.projectId) return;
        if (fromTask.weekIso !== overTask.weekIso) return;
        void reorderInWeekGroup(
          fromTask.projectId,
          fromTask.weekIso,
          fromId,
          toId,
        );
      }}
    >
      <section className="glass-panel" style={{ padding: 24 }}>
        {/* aria-live は visually-hidden に置く */}
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {liveMessage}
        </div>

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="eyebrow">PROJECTS &amp; TASKS</span>
            <h2 className="t-h3" style={{ marginTop: 4 }}>
              プロジェクト
            </h2>
          </div>

          <SearchFilterBar
            searchValue={keyword}
            onSearchChange={setKeyword}
            searchPlaceholder="プロジェクト・タスクを検索"
            searchAriaLabel="プロジェクトとタスクを検索"
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          >
            <select
              className="input"
              value={String(filterMember)}
              onChange={(e) => {
                const v = e.target.value;
                filterAutoInitRef.current = true;
                if (v === "all") setFilterMember("all");
                else if (v === "unassigned") setFilterMember("unassigned");
                else setFilterMember(Number(v));
              }}
              style={{ width: 140 }}
              aria-label="担当でフィルタ"
            >
              <option value="all">担当: すべて</option>
              <option value="unassigned">未割当</option>
              {members?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={filterDone}
              onChange={(e) =>
                setFilterDone(e.target.value as "all" | "open" | "done")
              }
              style={{ width: 130 }}
              aria-label="状態で絞り込み"
            >
              <option value="all">状態: すべて</option>
              <option value="open">未完了のみ</option>
              <option value="done">完了のみ</option>
            </select>
            {isEdit && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm edit-only"
                  onClick={async () => {
                    if (
                      !confirm(
                        "全メンバー×全週の工数を、アクティブなプロジェクトのタスク見積から再計算します。\n手動で入力した工数値は上書きされます。",
                      )
                    )
                      return;
                    await postJson("/api/workload/recalc", {});
                    mutate(
                      (key) =>
                        typeof key === "string" &&
                        key.startsWith("/api/workload"),
                    );
                  }}
                  title="アクティブタスクの見積合計で workload を再計算"
                  style={{ fontSize: ".75rem" }}
                >
                  工数を再計算
                </button>
                <button
                  type="button"
                  className="btn btn-primary edit-only"
                  onClick={() => setShowCreate(true)}
                >
                  ＋ 新規プロジェクト
                </button>
              </>
            )}
          </SearchFilterBar>
        </header>

        {noticeKind === "tasks" && (
          <div
            className="projects-inline-notice"
            role="status"
            onAnimationEnd={() => setNoticeKind(null)}
          >
            タスクボードはプロジェクトに統合されました
          </div>
        )}

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
                ? `${selectedIds.size} 件選択中（全ページ）`
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
                ? `すべて選択（${projects?.length ?? 0} 件）解除`
                : `すべて選択（${projects?.length ?? 0} 件）`}
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={bulkArchive}
              disabled={selectedIds.size === 0}
              style={{ fontSize: ".75rem" }}
            >
              一括アーカイブ
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

        {!projectsLoaded ? (
          <p className="muted">読み込み中…</p>
        ) : totalProjectCount === 0 ? (
          <EmptyState
            title="プロジェクトはまだありません"
            hint="まずプロジェクトを作成してください。タスクはプロジェクトの中に追加できます"
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            title="条件に一致するプロジェクトはありません"
            hint="フィルタを調整するか「担当: すべて」「状態: すべて」に戻してください"
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
            }}
          >
            {pagedProjects.map((p) => {
              const list = grouped[p.id] ?? [];
              const buckets = groupedByWeek[p.id] ?? [];
              const completedTasks = list
                .filter((t) => t.done)
                .sort(
                  (a, b) =>
                    a.weekIso.localeCompare(b.weekIso) ||
                    a.sortOrder - b.sortOrder ||
                    a.id - b.id,
                );
              const hasOpen = buckets.some((b) => b.open.length > 0);
              const isExpanded = expanded.has(p.id);
              const isCompletedExpanded = completedExpanded.has(p.id);
              const panelId = `project-panel-${p.id}`;
              const doneCount = list.filter((t) => t.done).length;
              const selected = selectedIds.has(p.id);

              return (
                <ProjectCard
                  key={p.id}
                  id={`project-${p.id}`}
                  project={p}
                  members={members ?? []}
                  isEdit={isEdit}
                  selected={selected}
                  isExpanded={isExpanded}
                  isCompletedExpanded={isCompletedExpanded}
                  panelId={panelId}
                  doneCount={doneCount}
                  totalCount={list.length}
                  hasOpen={hasOpen}
                  buckets={buckets}
                  completedTasks={completedTasks}
                  weeks={weeks}
                  activeTask={activeTask}
                  onToggleExpanded={() => toggleExpanded(p.id)}
                  onToggleCompletedExpanded={() =>
                    toggleCompletedExpanded(p.id)
                  }
                  onToggleSelected={() => toggleSelected(p.id)}
                  onUpdate={(patch) => updateProject(p, patch)}
                  onToggleMember={(id) => togglePlannedMember(p, id)}
                  onArchive={() => archiveProject(p)}
                  onDelete={() => deleteProject(p)}
                  onAddTasksModal={() => setAddTasksProjectId(p.id)}
                  onInlineTaskCreated={() => mutate(tasksKey)}
                  onToggleDone={toggleDone}
                  onUpdateTask={updateTaskField}
                  onRemoveTask={removeTask}
                />
              );
            })}
            {filteredProjects.length > pageSize && (
              <nav
                aria-label="プロジェクトのページ送り"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                  aria-label="前のページ"
                >
                  ← 前へ
                </button>
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="muted t-small"
                >
                  {safePage} / {totalPages} ページ（
                  {trimmedKeyword || filterMember !== "all" || filterDone !== "all"
                    ? `絞り込み ${visibleCount} / 全 ${totalProjectCount} 件`
                    : `全 ${visibleCount} 件`}
                  ）
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setPage(Math.min(totalPages, safePage + 1))
                  }
                  disabled={safePage >= totalPages}
                  aria-label="次のページ"
                >
                  次へ →
                </button>
              </nav>
            )}
          </div>
        )}

        {showCreate && (
          <ProjectCreateModal
            members={members ?? []}
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              revalidateAll();
            }}
          />
        )}

        {addTasksProjectId != null &&
          (() => {
            const target = (projects ?? []).find(
              (p) => p.id === addTasksProjectId,
            );
            if (!target) return null;
            return (
              <ProjectAddTasksModal
                project={{
                  id: target.id,
                  name: target.name,
                  summary: target.summary,
                  plannedMemberIds: target.plannedMemberIds,
                  dueDate: target.dueDate,
                  company: target.company,
                }}
                members={members ?? []}
                onClose={() => setAddTasksProjectId(null)}
                onAdded={() => {
                  setAddTasksProjectId(null);
                  mutate(
                    (key) =>
                      typeof key === "string" &&
                      (key.startsWith("/api/tasks") ||
                        key.startsWith("/api/workload")),
                  );
                }}
              />
            );
          })()}
      </section>
      <DragOverlay>
        {activeTask ? (
          <div style={dragOverlayCardStyle}>
            {activeProject && (
              <div style={dragOverlayProjectStyle}>
                <span
                  style={{
                    ...dragOverlayProjectDotStyle,
                    background: activeProject.color,
                  }}
                  aria-hidden="true"
                />
                {activeProject.name}
              </div>
            )}
            <div style={dragOverlayTitleStyle}>{activeTask.title}</div>
            <div style={dragOverlayMetaStyle}>
              <span>{activeAssignee ? activeAssignee.name : "未割当"}</span>
              <span>{weekIsoLabel(activeTask.weekIso)}</span>
              {activeTask.estimatedHours != null && (
                <span className="mono">
                  {Number(activeTask.estimatedHours)}h
                </span>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ──────────────────────────────────────────────
// ProjectCard
// ──────────────────────────────────────────────
function ProjectCard({
  id,
  project: p,
  members,
  isEdit,
  selected,
  isExpanded,
  isCompletedExpanded,
  panelId,
  doneCount,
  totalCount,
  hasOpen,
  buckets,
  completedTasks,
  weeks,
  activeTask,
  onToggleExpanded,
  onToggleCompletedExpanded,
  onToggleSelected,
  onUpdate,
  onToggleMember,
  onArchive,
  onDelete,
  onAddTasksModal,
  onInlineTaskCreated,
  onToggleDone,
  onUpdateTask,
  onRemoveTask,
}: {
  id: string;
  project: Project;
  members: Member[];
  isEdit: boolean;
  selected: boolean;
  isExpanded: boolean;
  isCompletedExpanded: boolean;
  panelId: string;
  doneCount: number;
  totalCount: number;
  hasOpen: boolean;
  buckets: {
    weekIso: string;
    open: Task[];
    done: Task[];
    openIds: number[];
  }[];
  completedTasks: Task[];
  weeks: string[];
  activeTask: Task | null;
  onToggleExpanded: () => void;
  onToggleCompletedExpanded: () => void;
  onToggleSelected: () => void;
  onUpdate: (patch: Partial<Project>) => void | Promise<void>;
  onToggleMember: (memberId: number) => void | Promise<void>;
  onArchive: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onAddTasksModal: () => void;
  onInlineTaskCreated: () => void;
  onToggleDone: (t: Task) => void;
  onUpdateTask: (t: Task, patch: Record<string, unknown>) => void;
  onRemoveTask: (t: Task) => void;
}) {
  const memberById: Record<number, Member> = {};
  for (const m of members) memberById[m.id] = m;

  const showMetaSection =
    isEdit ||
    (p.summary && p.summary.trim().length > 0) ||
    (p.notes && p.notes.trim().length > 0);

  return (
    <div
      id={id}
      className="glass-card project-card"
      data-expanded={isExpanded ? "true" : "false"}
      style={{
        padding: "var(--space-2) var(--space-4) var(--space-4)",
        outline: selected ? "2px solid var(--color-info)" : "none",
        outlineOffset: -2,
        scrollMarginTop: 90,
      }}
    >
      {/* ── ヘッダ行（sticky on expand）── */}
      <div
        className="project-card-header"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 4,
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          minHeight: 44,
        }}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="project-header-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            minWidth: 0,
            border: 0,
            borderRadius: "var(--r-sm)",
            background: "transparent",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
            padding: "var(--space-1) var(--space-2) var(--space-1) 0",
          }}
        >
          <span
            className="project-title-group"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              minWidth: 0,
            }}
          >
            {isEdit && (
              <input
                type="checkbox"
                className="checkbox"
                checked={selected}
                onChange={onToggleSelected}
                onClick={(e) => e.stopPropagation()}
                title="一括操作の対象に追加"
                aria-label={`${p.name} を選択`}
                style={{ flexShrink: 0 }}
              />
            )}
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-text-muted)",
                fontSize: "1.5rem",
                lineHeight: 1,
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform var(--ease-out)",
                flexShrink: 0,
              }}
            >
              ▾
            </span>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: p.color,
                flexShrink: 0,
              }}
            />
            {p.isPrivate && (
              <span
                aria-label="非公開プロジェクト"
                title="非公開プロジェクト"
                style={{
                  fontSize: ".875rem",
                  color: "var(--color-text-muted)",
                  flexShrink: 0,
                }}
              >
                🔒
              </span>
            )}
            {isEdit ? (
              <input
                className="input editable-only project-name"
                defaultValue={p.name}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== p.name) onUpdate({ name: v });
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, fontSize: "1rem", fontWeight: 600 }}
              />
            ) : (
              <strong
                className="t-h4 project-name"
                style={{ fontSize: "1rem" }}
              >
                {p.name}
              </strong>
            )}
          </span>
          {p.company && <CompanyChip company={p.company} size="sm" />}
          {isEdit ? (
            <input
              type="date"
              className="input editable-only"
              defaultValue={p.dueDate ?? ""}
              onBlur={(e) => {
                const v = e.currentTarget.value || null;
                if (v !== p.dueDate) onUpdate({ dueDate: v });
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: ".75rem", width: 130 }}
            />
          ) : (
            <span className="t-small muted" style={{ flexShrink: 0 }}>
              期日 {p.dueDate ?? "—"}
            </span>
          )}
          <span className="muted t-small" style={{ flexShrink: 0 }}>
            ({doneCount}/{totalCount})
          </span>
        </button>

        {/* 担当チップ集約（ヘッダ右端） */}
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleExpanded}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleExpanded();
            }
          }}
          style={{
            display: "flex",
            gap: 4,
            flexShrink: 0,
            flexWrap: "wrap",
            maxWidth: 240,
            cursor: "pointer",
          }}
          aria-label="担当メンバー"
        >
          {p.plannedMemberIds
            .map((mid) => memberById[mid])
            .filter(Boolean)
            .map((m) => (
              <span
                key={m.id}
                className="badge"
                title={m.name}
                style={{ paddingLeft: 6 }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: m.color,
                    display: "inline-block",
                    marginRight: 4,
                  }}
                />
                {m.name}
              </span>
            ))}
          {p.plannedMemberIds.length === 0 && (
            <span className="t-small subtle">担当未設定</span>
          )}
        </div>


        {isEdit && (
          <ActionMenu label="その他のアクション">
            <button
              type="button"
              role="menuitem"
              onClick={onArchive}
              title="ダッシュボードから外しアーカイブに移動"
            >
              アーカイブ
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item--destructive"
              onClick={onDelete}
              title="関連タスク・工数ごと完全削除"
            >
              削除
            </button>
          </ActionMenu>
        )}
      </div>

      {/* ── 展開コンテナ ── */}
      <div id={panelId} hidden={!isExpanded}>
        {isExpanded && (
          <div className="project-expanded-panel">
            {/* 左カラム: 概要・メモ + 担当割当（編集モード時） */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
              }}
            >
              {showMetaSection && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                    }}
                  >
                      {(isEdit || (p.summary && p.summary.trim())) && (
                        <div>
                          <label
                            className="form-label"
                            style={{ fontSize: ".6875rem" }}
                          >
                            概要
                          </label>
                          {isEdit ? (
                            <textarea
                              className="input editable-only"
                              defaultValue={p.summary}
                              rows={4}
                              onBlur={(e) => {
                                const v = e.currentTarget.value;
                                if (v !== p.summary) onUpdate({ summary: v });
                              }}
                              placeholder="プロジェクトの目的・主要なフェーズなど"
                            />
                          ) : (
                            <div
                              className="t-small muted"
                              style={{
                                padding: "8px 10px",
                                background: "rgba(255,255,255,.32)",
                                borderRadius: "var(--r-sm)",
                              }}
                            >
                              {p.summary && <LinkifiedText text={p.summary} />}
                            </div>
                          )}
                        </div>
                      )}
                      {(isEdit || (p.notes && p.notes.trim())) && (
                        <div>
                          <label
                            className="form-label"
                            style={{ fontSize: ".6875rem" }}
                          >
                            メモ
                          </label>
                          {isEdit ? (
                            <textarea
                              className="input editable-only"
                              defaultValue={p.notes ?? ""}
                              rows={3}
                              onBlur={(e) => {
                                const v = e.currentTarget.value;
                                if (v !== (p.notes ?? "")) onUpdate({ notes: v });
                              }}
                              placeholder="参考リンク・進捗メモなど（URL は自動でリンクになります）"
                            />
                          ) : (
                            <div
                              className="t-small muted"
                              style={{
                                padding: "8px 10px",
                                background: "rgba(255,255,255,.32)",
                                borderRadius: "var(--r-sm)",
                              }}
                            >
                              {p.notes && <LinkifiedText text={p.notes} />}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                </div>
              )}

              {isEdit && (
                <div>
                  <label
                    className="form-label"
                    style={{ fontSize: ".6875rem" }}
                  >
                    ブランド/部署タグ
                  </label>
                  <select
                    className="input editable-only"
                    value={p.company ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onUpdate({
                        company: v === "" ? null : (v as Company),
                      });
                    }}
                    style={{ fontSize: ".75rem" }}
                    title="ブランド/部署タグ"
                  >
                    <option value="">（未設定）</option>
                    {COMPANIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isEdit && (
                <div>
                  <label
                    className="form-label"
                    style={{ fontSize: ".6875rem" }}
                  >
                    担当の割り当て
                  </label>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {members.map((m) => {
                      const active = p.plannedMemberIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className="badge"
                          onClick={() => onToggleMember(m.id)}
                          style={{
                            cursor: "pointer",
                            opacity: active ? 1 : 0.4,
                            background: active
                              ? "rgba(255,255,255,.78)"
                              : "rgba(255,255,255,.32)",
                            border: active
                              ? "1px solid rgba(255,255,255,.78)"
                              : "1px solid rgba(53,54,45,.18)",
                            paddingLeft: 8,
                          }}
                          aria-pressed={active}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: m.color,
                              display: "inline-block",
                              marginRight: 4,
                            }}
                          />
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 右カラム: タスク + インライン追加 */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              {isEdit && (
                <NewTaskInline
                  projectId={p.id}
                  members={members}
                  weeks={weeks}
                  onCreated={onInlineTaskCreated}
                  onOpenDetailModal={onAddTasksModal}
                />
              )}

              {totalCount === 0 ? (
                <p className="muted t-small">該当タスクなし</p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {!hasOpen && (
                    <p
                      className="muted t-small"
                      style={{ padding: "2px 8px" }}
                    >
                      未完了タスクはありません
                    </p>
                  )}
                  {buckets
                    .filter((b) => b.open.length > 0)
                    .map((bucket) => {
                      const dragActiveInThisWeek =
                        activeTask != null &&
                        activeTask.projectId === p.id &&
                        activeTask.weekIso === bucket.weekIso;
                      return (
                        <div key={bucket.weekIso}>
                          <div
                            style={{
                              fontSize: ".6875rem",
                              color: "var(--color-text-light)",
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              padding: "2px 8px 4px",
                            }}
                          >
                            {weekIsoLabel(bucket.weekIso)}
                          </div>
                          <SortableContext
                            items={bucket.openIds}
                            strategy={verticalListSortingStrategy}
                          >
                            <ul
                              className="task-list"
                              style={taskListStyle}
                              data-drag-active={
                                activeTask != null ? "true" : "false"
                              }
                            >
                              {bucket.open.map((t) => {
                                const eligible =
                                  activeTask == null ||
                                  (activeTask.projectId === p.id &&
                                    activeTask.weekIso === bucket.weekIso);
                                return (
                                  <SortableTaskRow
                                    key={t.id}
                                    task={t}
                                    isEdit={isEdit}
                                    members={members}
                                    weeks={weeks}
                                    eligible={eligible || dragActiveInThisWeek}
                                    onToggleDone={onToggleDone}
                                    onUpdate={onUpdateTask}
                                    onRemove={onRemoveTask}
                                  />
                                );
                              })}
                            </ul>
                          </SortableContext>
                        </div>
                      );
                    })}
                  {completedTasks.length > 0 && (
                    <div style={{ marginTop: "var(--space-2)" }}>
                      <button
                        type="button"
                        onClick={onToggleCompletedExpanded}
                        aria-expanded={isCompletedExpanded}
                        className="project-header-btn"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          width: "100%",
                          padding: "var(--space-1) var(--space-2)",
                          border: 0,
                          borderRadius: "var(--r-sm)",
                          background: "transparent",
                          color: "var(--color-text-light)",
                          textAlign: "left",
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: ".6875rem",
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-flex",
                            width: 16,
                            height: 16,
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: ".875rem",
                            lineHeight: 1,
                            transform: isCompletedExpanded
                              ? "rotate(0deg)"
                              : "rotate(-90deg)",
                            transition: "transform var(--ease-out)",
                          }}
                        >
                          ▾
                        </span>
                        完了済み（{completedTasks.length}）
                      </button>
                      {isCompletedExpanded && (
                        <ul
                          className="task-list completed-list"
                          style={taskListStyle}
                        >
                          {completedTasks.map((t) => (
                            <DoneTaskRow
                              key={t.id}
                              task={t}
                              isEdit={isEdit}
                              members={members}
                              weeks={weeks}
                              onToggleDone={onToggleDone}
                              onUpdate={onUpdateTask}
                              onRemove={onRemoveTask}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Task rows (TaskBoard から移植 + eligible 対応)
// ──────────────────────────────────────────────
const TaskRowCells = memo(function TaskRowCells({
  task,
  isEdit,
  members,
  weeks,
  onToggleDone,
  onUpdate,
  onRemove,
  dimmed,
}: {
  task: Task;
  isEdit: boolean;
  members: Member[];
  weeks: string[];
  onToggleDone: (t: Task) => void;
  onUpdate: (t: Task, patch: Record<string, unknown>) => void;
  onRemove: (t: Task) => void;
  dimmed?: boolean;
}) {
  return (
    <>
      <input
        type="checkbox"
        className="checkbox"
        checked={task.done}
        onChange={() => onToggleDone(task)}
        disabled={!isEdit}
      />
      {isEdit ? (
        <input
          className="input editable-only"
          defaultValue={task.title}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== task.title) onUpdate(task, { title: v });
          }}
          style={{ fontSize: ".8125rem", opacity: dimmed ? 0.55 : 1 }}
        />
      ) : (
        <span
          style={{
            textDecoration: task.done ? "line-through" : "none",
            color: task.done ? "var(--color-text-light)" : undefined,
            fontSize: ".8125rem",
            opacity: dimmed ? 0.6 : 1,
          }}
        >
          {task.title}
        </span>
      )}
      <select
        className="input editable-only"
        value={task.assigneeMemberId ?? ""}
        onChange={(e) =>
          onUpdate(task, {
            assigneeMemberId: e.target.value ? Number(e.target.value) : null,
          })
        }
        disabled={!isEdit}
        style={{
          fontSize: ".75rem",
          padding: "4px 8px",
          opacity: dimmed ? 0.6 : 1,
        }}
      >
        <option value="">未割当</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <WeekPicker
        weekIso={task.weekIso}
        weeks={weeks}
        isEdit={isEdit}
        onChange={(w) => onUpdate(task, { weekIso: w })}
      />
      <HoursCell
        value={task.estimatedHours}
        isEdit={isEdit}
        onChange={(h) => onUpdate(task, { estimatedHours: h })}
      />
      {isEdit && (
        <button
          type="button"
          className="btn btn-ghost btn-sm edit-only"
          onClick={() => {
            if (confirm(`「${task.title}」を削除しますか？`)) onRemove(task);
          }}
          title="削除"
          style={removeBtnStyle}
        >
          ×
        </button>
      )}
    </>
  );
});

const SortableTaskRow = memo(function SortableTaskRow({
  task,
  isEdit,
  members,
  weeks,
  eligible,
  onToggleDone,
  onUpdate,
  onRemove,
}: {
  task: Task;
  isEdit: boolean;
  members: Member[];
  weeks: string[];
  eligible: boolean;
  onToggleDone: (t: Task) => void;
  onUpdate: (t: Task, patch: Record<string, unknown>) => void;
  onRemove: (t: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = useMemo<CSSProperties>(
    () => ({
      ...baseRowStyle,
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.6 : 1,
      background: isDragging ? "rgba(255,255,255,.42)" : undefined,
      position: "relative",
      zIndex: isDragging ? 2 : "auto",
    }),
    [transform, transition, isDragging],
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-row="taskboard"
      data-drag-eligible={eligible ? "true" : "false"}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="この行を並び替え"
        title="ドラッグで並び替え"
        className="btn btn-ghost btn-sm drag-handle"
        style={isDragging ? dragHandleStyleDragging : dragHandleStyle}
      >
        ⋮⋮
      </button>
      <TaskRowCells
        task={task}
        isEdit={isEdit}
        members={members}
        weeks={weeks}
        onToggleDone={onToggleDone}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    </li>
  );
});

const DoneTaskRow = memo(function DoneTaskRow({
  task,
  isEdit,
  members,
  weeks,
  onToggleDone,
  onUpdate,
  onRemove,
}: {
  task: Task;
  isEdit: boolean;
  members: Member[];
  weeks: string[];
  onToggleDone: (t: Task) => void;
  onUpdate: (t: Task, patch: Record<string, unknown>) => void;
  onRemove: (t: Task) => void;
}) {
  return (
    <li style={doneRowStyle} data-row="taskboard">
      <span
        aria-hidden="true"
        title="完了タスクは並び替えできません"
        style={doneRowHandleStyle}
      >
        ⋮⋮
      </span>
      <TaskRowCells
        task={task}
        isEdit={isEdit}
        members={members}
        weeks={weeks}
        onToggleDone={onToggleDone}
        onUpdate={onUpdate}
        onRemove={onRemove}
        dimmed
      />
    </li>
  );
});

function HoursCell({
  value,
  isEdit,
  onChange,
}: {
  value: string | null;
  isEdit: boolean;
  onChange: (h: number | null) => void;
}) {
  const initial = value == null ? "" : String(Number(value));
  const [draft, setDraft] = useState<string>(initial);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  if (!isEdit) {
    return (
      <span
        className="t-small mono muted"
        style={{ textAlign: "right", paddingRight: 4 }}
      >
        {value == null || Number(value) === 0 ? "—" : `${Number(value)}h`}
      </span>
    );
  }
  return (
    <input
      className="input editable-only"
      type="number"
      min={0}
      max={40}
      step={0.5}
      value={draft}
      placeholder="h"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === "") {
          if (value != null) onChange(null);
          return;
        }
        const n = Number(draft);
        if (Number.isFinite(n) && n !== Number(value ?? 0)) onChange(n);
      }}
      style={{ fontSize: ".75rem", padding: "4px 6px", textAlign: "right" }}
    />
  );
}

function WeekPicker({
  weekIso,
  weeks,
  isEdit,
  onChange,
}: {
  weekIso: string;
  weeks: string[];
  isEdit: boolean;
  onChange: (w: string) => void;
}) {
  const all = useMemo(() => {
    return weeks.includes(weekIso) ? weeks : [weekIso, ...weeks].sort();
  }, [weeks, weekIso]);
  if (!isEdit) {
    return (
      <span className="t-small mono muted" title={weekIso}>
        {weekIsoLabel(weekIso)}
      </span>
    );
  }
  return (
    <select
      className="input editable-only"
      value={weekIso}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: ".75rem", padding: "4px 8px" }}
      title={weekIso}
    >
      {all.map((w) => (
        <option key={w} value={w}>
          {weekIsoLabel(w)}
        </option>
      ))}
    </select>
  );
}

// ──────────────────────────────────────────────
// インラインタスク追加 (詳細入力 → モーダル昇格つき)
// ──────────────────────────────────────────────
type NewTaskDraft = {
  title: string;
  weekIso: string;
  assigneeId: number | "";
  hours: string;
};
const NEW_TASK_DRAFT_VERSION = 1;
const newTaskDraftKey = (projectId: number) =>
  `mb-schedule:draft:new-task:${projectId}`;

function NewTaskInline({
  projectId,
  members,
  weeks,
  onCreated,
  onOpenDetailModal,
}: {
  projectId: number;
  members: Member[];
  weeks: string[];
  onCreated: () => void;
  onOpenDetailModal: () => void;
}) {
  const draftKey = newTaskDraftKey(projectId);
  const [initial] = useState<NewTaskDraft | null>(() =>
    restoreDraft<NewTaskDraft>(draftKey, NEW_TASK_DRAFT_VERSION),
  );
  const [open, setOpen] = useState<boolean>(
    !!initial && !!initial.title?.trim(),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [weekIso, setWeekIso] = useState(
    initial?.weekIso ?? weeks[2] ?? weeks[0],
  );
  const [assigneeId, setAssigneeId] = useState<number | "">(
    initial?.assigneeId ?? "",
  );
  const [hours, setHours] = useState<string>(initial?.hours ?? "");

  const snapshot = useMemo<NewTaskDraft>(
    () => ({ title, weekIso, assigneeId, hours }),
    [title, weekIso, assigneeId, hours],
  );
  const { clear: clearStoredDraft } = useAutosaveDraft(
    draftKey,
    NEW_TASK_DRAFT_VERSION,
    snapshot,
  );

  if (!open) {
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm edit-only"
          onClick={() => setOpen(true)}
          style={{ fontSize: ".75rem" }}
        >
          ＋ タスクを追加
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm edit-only"
          onClick={onOpenDetailModal}
          style={{
            fontSize: ".75rem",
            color: "var(--color-text-muted)",
          }}
          title="AI でたたき台を生成、または複数タスクを一括追加"
        >
          詳細入力 →
        </button>
      </div>
    );
  }

  return (
    <form
      className="edit-only"
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const h = hours === "" ? null : Number(hours);
        await postJson("/api/tasks", {
          projectId,
          title: title.trim(),
          weekIso,
          assigneeMemberId: assigneeId === "" ? null : assigneeId,
          estimatedHours: h != null && Number.isFinite(h) ? h : null,
        });
        setTitle("");
        setHours("");
        clearStoredDraft();
        onCreated();
      }}
    >
      <input
        className="input"
        placeholder="＋ タスクを追加"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        style={{ flex: 1, minWidth: 160, fontSize: ".8125rem" }}
      />
      <select
        className="input"
        value={assigneeId}
        onChange={(e) =>
          setAssigneeId(e.target.value === "" ? "" : Number(e.target.value))
        }
        style={{ width: 110, fontSize: ".75rem" }}
      >
        <option value="">未割当</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={weekIso}
        onChange={(e) => setWeekIso(e.target.value)}
        style={{ width: 110, fontSize: ".75rem" }}
        title={weekIso}
      >
        {weeks.map((w) => (
          <option key={w} value={w}>
            {weekIsoLabel(w)}
          </option>
        ))}
      </select>
      <input
        className="input"
        type="number"
        min={0}
        max={40}
        step={0.5}
        placeholder="h"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        style={{ width: 56, fontSize: ".75rem", textAlign: "right" }}
      />
      <button type="submit" className="btn btn-secondary btn-sm">
        追加
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setOpen(false);
          setTitle("");
          setHours("");
          clearStoredDraft();
        }}
        style={{ fontSize: ".75rem" }}
      >
        キャンセル
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onOpenDetailModal}
        style={{ fontSize: ".75rem", color: "var(--color-text-muted)" }}
        title="AI でたたき台を生成、または複数タスクを一括追加"
      >
        詳細入力 →
      </button>
    </form>
  );
}

