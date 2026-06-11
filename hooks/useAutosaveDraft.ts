"use client";

import { useCallback, useEffect, useRef } from "react";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage";

type Options = {
  debounceMs?: number;
  /** true の間は保存しない（例: submit 直後・初期化中） */
  skip?: boolean;
};

/**
 * `state` の変化を debounce して localStorage へ書き戻す。
 * 初期値の復元は呼び出し側で `loadDraft` を useState の lazy initializer に渡して行う。
 * 戻り値の `clear()` を submit 成功側で呼ぶと、保存済み draft が消える。
 */
export function useAutosaveDraft<T>(
  key: string,
  version: number,
  state: T,
  options: Options = {},
): { clear: () => void } {
  const { debounceMs = 300, skip = false } = options;

  // 初回マウントでは保存しない（loadDraft で復元した値を即書き戻すのは無意味）
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (skip) return;
    const id = window.setTimeout(() => {
      saveDraft(key, version, state);
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [key, version, state, debounceMs, skip]);

  const clear = useCallback(() => clearDraft(key), [key]);
  return { clear };
}

/**
 * 復元用ヘルパ。SSR 安全。useState の lazy initializer から呼ぶことを想定。
 */
export function restoreDraft<T>(key: string, version: number): T | null {
  return loadDraft<T>(key, version);
}
