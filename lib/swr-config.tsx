"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";

/**
 * 全画面共通の自動ポーリング間隔（ms）。
 *
 * SWR v2 の mergeObjects は単純 spread（`{ ...parent, ...local }`）のため、
 * 個別 useSWR で `refreshInterval: cond ? 0 : undefined` のように書くと
 * `undefined` が provider 値を上書きしてポーリングが完全停止してしまう。
 * 個別画面で「条件付き停止」を実装したいときは、この定数を明示的に渡すこと:
 *
 *   useSWR(key, fetcher, { refreshInterval: stopFlag ? 0 : SWR_REFRESH_MS })
 */
export const SWR_REFRESH_MS = 30_000;

/**
 * 全ページ共通の SWR 設定。
 *
 * - `refreshInterval: 30000` — 既定の自動ポーリングは 30 秒。以前は各 useSWR が
 *   個別に 5 秒で並走しており、タスク数が増えると毎回の data ref 入れ替えで
 *   Dashboard 全体が再レンダーしていた。30 秒 + フォーカス時 revalidate で
 *   体感の鮮度は維持しつつ、無駄な再フェッチを大幅に削減する。
 * - `revalidateOnFocus: true` — タブに戻った瞬間に最新化。
 * - `revalidateOnReconnect: true` — ネットワーク復帰時にも最新化。
 * - `dedupingInterval: 2000` — mutate 直後に refreshInterval が即時再フェッチを
 *   重ねる二重撃ちを防ぐ。
 * - `keepPreviousData: true` — キー切替（週送り等）の瞬間に画面が空にならない。
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        refreshInterval: SWR_REFRESH_MS,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
