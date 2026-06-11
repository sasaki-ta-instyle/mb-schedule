import type { ReactNode } from "react";

/**
 * API エラー時のページ上部 banner。
 * 既存実装は alert / console.error / 行内エラー文字列でバラバラだったので、
 * 「再現可能な失敗」（一覧の取得失敗、保存の失敗）はこの banner で見せる方針に。
 *
 * 致命的でない場合は onDismiss を渡して閉じられるようにする。
 * retry できる操作なら onRetry を渡してボタンを出す。
 */
export function ErrorBanner({
  message,
  detail,
  onRetry,
  onDismiss,
  children,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        marginBottom: "var(--space-4)",
        background: "rgba(220, 38, 38, 0.10)",
        border: "1px solid rgba(220, 38, 38, 0.32)",
        borderRadius: "var(--r-sm)",
        color: "#9C1212",
        fontSize: ".8125rem",
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
        ⚠
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{message}</div>
        {detail && (
          <div
            className="t-small"
            style={{
              marginTop: 2,
              opacity: 0.85,
              wordBreak: "break-word",
            }}
          >
            {detail}
          </div>
        )}
        {children && (
          <div style={{ marginTop: "var(--space-2)" }}>{children}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
        {onRetry && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRetry}
            style={{ color: "inherit" }}
          >
            再試行
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDismiss}
            aria-label="閉じる"
            style={{ color: "inherit" }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
