import type { ReactNode } from "react";

/**
 * 検索 + フィルタ + ページサイズ の共通ヘッダー。
 * Admin / TaskBoard / RecurringList で重複していた実装を統合する。
 *
 * 中央エリアの個別フィルタ（プロジェクト / 状態 / アーカイブ表示など）は
 * 画面ごとに違うので children として差し込む形にした。検索とページサイズだけ
 * 共通化することで「左に検索、右にページサイズ、間に画面固有 select」という
 * レイアウトの一貫性は保てる。
 *
 * URL 連動は現状どの画面でも使っていない（state only）。将来 URL 連動を
 * 入れるときは onSearchChange / onPageSizeChange の延長で URL 同期する設計。
 */
export function SearchFilterBar<TSize extends number>({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  pageSize,
  onPageSizeChange,
  pageSizeOptions,
  children,
}: {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  pageSize: TSize;
  onPageSizeChange: (v: TSize) => void;
  pageSizeOptions: readonly TSize[];
  children?: ReactNode;
}) {
  return (
    <div
      className="search-filter-bar"
      style={{
        display: "flex",
        gap: "var(--space-2)",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        className="input"
        type="search"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchAriaLabel}
        style={{ width: 240 }}
      />
      {children}
      <select
        className="input"
        value={String(pageSize)}
        onChange={(e) => {
          // 外部から DOM を書き換えられた場合の NaN ガード。
          // localStorage 永続化されると次回起動で詰むため、想定外値は無視する。
          const n = Number(e.target.value) as TSize;
          if (pageSizeOptions.includes(n)) onPageSizeChange(n);
        }}
        aria-label="1ページあたりの件数"
        style={{ width: 130 }}
      >
        {pageSizeOptions.map((n) => (
          <option key={n} value={n}>
            {n} 件 / ページ
          </option>
        ))}
      </select>
    </div>
  );
}
