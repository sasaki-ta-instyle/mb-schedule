"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";

type Member = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
};

export function PasswordPrompt({
  open,
  pending,
  error,
  initialMemberId,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  initialMemberId: number | null;
  onSubmit: (memberId: number, password: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState("");
  const [memberId, setMemberId] = useState<number | null>(initialMemberId);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: members } = useSWR<Member[]>(
    open ? "/api/members" : null,
    fetcher,
  );

  useEffect(() => {
    if (!open) {
      setPw("");
    } else {
      setMemberId(initialMemberId);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialMemberId]);

  if (!open) return null;

  const canSubmit = !pending && !!pw && memberId != null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop"
      // PasswordPrompt は他の Modal より上に立たせ、縦中央寄せ
      style={{ zIndex: 20, alignItems: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        className="glass-panel modal-content modal-content--sm modal-content--scroll"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && memberId != null) onSubmit(memberId, pw);
        }}
      >
        <span className="eyebrow">EDIT MODE</span>
        <h3 className="t-h4" style={{ marginTop: 4, marginBottom: 10 }}>
          編集モードに切替
        </h3>
        <p className="t-small muted" style={{ marginBottom: 14 }}>
          あなたが誰か選んでパスワードを入力してください。
        </p>

        <label className="form-label" style={{ marginBottom: 8 }}>
          あなたは
        </label>
        <div
          role="radiogroup"
          aria-label="メンバー"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 14,
          }}
        >
          {(members ?? [])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((m) => {
              const active = memberId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`timeline-chip ${active ? "is-active" : ""}`}
                  onClick={() => setMemberId(m.id)}
                >
                  <span
                    className="timeline-chip-dot"
                    style={{ background: m.color }}
                    aria-hidden="true"
                  />
                  {m.name}
                </button>
              );
            })}
        </div>

        <label className="form-label">パスワード</label>
        <input
          ref={inputRef}
          type="password"
          className="input"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          aria-label="パスワード"
          placeholder="パスワード"
          style={{ marginBottom: 10 }}
        />
        {error && (
          <p
            className="badge badge-error"
            style={{
              display: "block",
              width: "fit-content",
              marginBottom: 10,
            }}
          >
            {error}
          </p>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={pending}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {pending ? "確認中…" : "ログイン"}
          </button>
        </div>
      </form>
    </div>
  );
}
