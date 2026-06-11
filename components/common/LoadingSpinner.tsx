import type { CSSProperties } from "react";

/**
 * Liquid Glass トーンに馴染む軽いスピナー。
 * 読み込み中の text-only 表示 (例: "確認中…") を補強するために使う。
 *
 * `inline` true: 文字と並べてアイコンサイズで表示
 * `inline` false: ブロック要素として中央に
 */
export function LoadingSpinner({
  size = 16,
  inline = true,
  label,
}: {
  size?: number;
  inline?: boolean;
  /** スクリーンリーダー向けに状況を伝える */
  label?: string;
}) {
  const ring: CSSProperties = {
    width: size,
    height: size,
    border: `${Math.max(2, Math.floor(size / 8))}px solid rgba(196,193,176,.35)`,
    borderTopColor: "var(--color-text-muted)",
    borderRadius: 999,
    animation: "ig-spinner 0.8s linear infinite",
    display: "inline-block",
    verticalAlign: "middle",
  };

  if (inline) {
    return (
      <span
        role={label ? "status" : undefined}
        aria-label={label}
        aria-live={label ? "polite" : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span aria-hidden="true" style={ring} />
        {label && <span className="t-small muted">{label}</span>}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-label={label ?? "読み込み中"}
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "var(--space-6) 0",
      }}
    >
      <span aria-hidden="true" style={ring} />
      {label && <span className="t-small muted">{label}</span>}
    </div>
  );
}
