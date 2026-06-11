"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 履歴エントリ。
 * - `do`: redo（Cmd+Shift+Z）時のみ呼ばれる「再適用」関数。初回実行は呼び出し側が
 *   別途行う（pushHistory は実行後に呼ぶ規約）。将来 do を初回実行にも兼用する場合は
 *   二重 PATCH に注意。
 * - `undo`: undo（Cmd+Z）時に呼ばれる「逆操作」関数。
 */
export type HistoryEntry = {
  label: string;
  do: () => Promise<void> | void;
  undo: () => Promise<void> | void;
};

type StoredEntry = HistoryEntry & {
  /** push されたときの timestamp(ms)。M-8: SWR refresh で世代がズレた古い undo を実行しないための鮮度判定に使う。 */
  pushedAt: number;
};

const MAX_HISTORY = 50;
/**
 * これより古いエントリは undo/redo を拒否する（M-8）。SWR refreshInterval が 5s なので、
 * その数倍を待つと「他端末が別更新を入れた」確率が無視できない。30s で十分新しいと判断する。
 */
const STALE_AFTER_MS = 30_000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function pruneStale(stack: StoredEntry[]): StoredEntry[] {
  const now = Date.now();
  while (stack.length && now - stack[0].pushedAt > STALE_AFTER_MS) {
    stack.shift();
  }
  return stack;
}

export function useTaskHistory() {
  const undoStackRef = useRef<StoredEntry[]>([]);
  const redoStackRef = useRef<StoredEntry[]>([]);
  const isApplyingRef = useRef(false);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    if (isApplyingRef.current) return;
    const stack = undoStackRef.current;
    stack.push({ ...entry, pushedAt: Date.now() });
    if (stack.length > MAX_HISTORY) stack.shift();
    redoStackRef.current = [];
  }, []);

  /**
   * 履歴を全クリアする。週切替・フィルタ大幅変更・edit mode 抜けなど
   * 「世界観が変わった」タイミングで呼ぶ想定。
   */
  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      // N-1: 物理キー位置 e.code === "KeyZ" を最優先。e.key 系のフォールバックは
      // e.code が空文字（一部の IME / 仮想キーボード）のときだけ受け付ける。
      // こうしないと Dvorak Programmer などで `Z` が物理的に別キーに割り当たっている環境で誤発火する。
      const isZByCode = e.code === "KeyZ";
      const isZByKeyFallback =
        e.code === "" && (e.key === "z" || e.key === "Z");
      if (!isZByCode && !isZByKeyFallback) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (isEditableTarget(e.target)) return;
      if (isApplyingRef.current) {
        e.preventDefault();
        return;
      }

      const isRedo = e.shiftKey;
      e.preventDefault();

      if (isRedo) {
        const stack = pruneStale(redoStackRef.current);
        const entry = stack.pop();
        if (!entry) return;
        isApplyingRef.current = true;
        Promise.resolve()
          .then(() => entry.do())
          .then(() => {
            undoStackRef.current.push({ ...entry, pushedAt: Date.now() });
          })
          .catch((err) => {
            console.error("[history] redo failed", err);
            redoStackRef.current.push(entry);
          })
          .finally(() => {
            isApplyingRef.current = false;
          });
      } else {
        const stack = pruneStale(undoStackRef.current);
        const entry = stack.pop();
        if (!entry) return;
        isApplyingRef.current = true;
        Promise.resolve()
          .then(() => entry.undo())
          .then(() => {
            redoStackRef.current.push({ ...entry, pushedAt: Date.now() });
          })
          .catch((err) => {
            console.error("[history] undo failed", err);
            undoStackRef.current.push(entry);
          })
          .finally(() => {
            isApplyingRef.current = false;
          });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return { pushHistory, clearHistory };
}
