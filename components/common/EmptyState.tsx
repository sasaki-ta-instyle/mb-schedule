import type { ReactNode, CSSProperties } from "react";

/**
 * 空状態の共通表示。各画面で個別に書いていた `<p className="muted">...</p>` を統一する。
 *
 * 用途:
 * - 読み込み中ではないが、条件に合致するデータが 0 件のとき
 * - 検索ヒット 0 件のとき（hint に検索語を埋めると親切）
 *
 * 行動を促すボタンを置きたい場合は children に。
 */
export function EmptyState({
  title,
  hint,
  icon,
  children,
  compact = false,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  children?: ReactNode;
  /** 行内の薄い空状態に使う場合は true（padding を小さく） */
  compact?: boolean;
}) {
  const style: CSSProperties = compact
    ? { padding: "var(--space-4) 0", textAlign: "center" }
    : {
        padding: "var(--space-6) var(--space-4)",
        textAlign: "center",
        maxWidth: 420,
        margin: "0 auto",
      };

  return (
    <div style={style}>
      {icon && (
        <div
          aria-hidden="true"
          style={{
            fontSize: compact ? "1.25rem" : "1.75rem",
            color: "var(--color-text-light)",
            marginBottom: "var(--space-2)",
          }}
        >
          {icon}
        </div>
      )}
      <p
        className={compact ? "t-small muted" : "muted"}
        style={{ margin: 0, lineHeight: 1.5 }}
      >
        {title}
      </p>
      {hint && (
        <p
          className="t-small muted"
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            color: "var(--color-text-light)",
          }}
        >
          {hint}
        </p>
      )}
      {children && (
        <div style={{ marginTop: "var(--space-3)" }}>{children}</div>
      )}
    </div>
  );
}
