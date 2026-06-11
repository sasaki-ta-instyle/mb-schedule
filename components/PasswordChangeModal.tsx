"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

export function PasswordChangeModal({
  open,
  memberName,
  onSubmit,
  onClose,
}: {
  open: boolean;
  memberName: string | null;
  onSubmit: (cur: string, next: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
}) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCur(""); setNext(""); setConfirm("");
      setError(null); setDone(false); setPending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = !pending && cur.length > 0 && next.length >= 4 && next === confirm;

  async function handle() {
    setPending(true);
    setError(null);
    const res = await onSubmit(cur, next);
    setPending(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => onClose(), 900);
    } else {
      setError(res.error);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop"
      style={{ zIndex: 21, alignItems: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        className="glass-panel modal-content modal-content--sm modal-content--scroll"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) handle();
        }}
      >
        <span className="eyebrow">PASSWORD</span>
        <h3 className="t-h4" style={{ marginTop: 4, marginBottom: 10 }}>
          パスワード変更{memberName ? `（${memberName}）` : ""}
        </h3>
        <p className="t-small muted" style={{ marginBottom: 14 }}>
          現在のパスワード（または管理者パスワード）と新しいパスワードを入力してください。新しいパスワードは 4 文字以上。
        </p>

        <label className="form-label">現在のパスワード</label>
        <input
          ref={inputRef}
          type="password"
          className="input"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          autoComplete="current-password"
          style={{ marginBottom: 12 }}
        />

        <label className="form-label">新しいパスワード</label>
        <input
          type="password"
          className="input"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={4}
          style={{ marginBottom: 12 }}
        />

        <label className="form-label">新しいパスワード（確認）</label>
        <input
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={4}
          style={{ marginBottom: 10 }}
        />

        {next.length > 0 && confirm.length > 0 && next !== confirm && (
          <p className="badge badge-warn" style={{ display: "block", width: "fit-content", marginBottom: 10 }}>
            確認用が一致しません
          </p>
        )}
        {error && (
          <p className="badge badge-error" style={{ display: "block", width: "fit-content", marginBottom: 10 }}>
            {error}
          </p>
        )}
        {done && (
          <p className="badge badge-ok" style={{ display: "block", width: "fit-content", marginBottom: 10 }}>
            変更しました
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {pending ? (
              <LoadingSpinner inline size={14} label="更新中" />
            ) : (
              "変更"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
