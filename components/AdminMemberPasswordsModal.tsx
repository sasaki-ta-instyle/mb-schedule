"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/api";

type Member = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  hasPassword: boolean;
  isAdmin: boolean;
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function AdminMemberPasswordsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: members } = useSWR<Member[]>(open ? "/api/members" : null, fetcher);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (!open) return null;

  function reset() {
    setEditingId(null);
    setNewPw("");
    setConfirmPw("");
    setMsg(null);
  }

  async function setPassword(memberId: number) {
    if (newPw.length < 4 || newPw !== confirmPw) return;
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch(`${BASE}/api/members/${memberId}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: newPw }),
        credentials: "same-origin",
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "設定しました" });
        await mutate("/api/members");
        setTimeout(() => reset(), 700);
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg({ kind: "err", text: j?.error ?? `エラー (${res.status})` });
      }
    } catch {
      setMsg({ kind: "err", text: "通信エラー" });
    } finally {
      setPending(false);
    }
  }

  async function clearPassword(memberId: number, name: string) {
    if (!window.confirm(`${name} のパスワードをクリアします（admin パスワードのみでログインできる状態に戻る）よろしいですか？`)) {
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch(`${BASE}/api/members/${memberId}/password`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "クリアしました" });
        await mutate("/api/members");
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg({ kind: "err", text: j?.error ?? `エラー (${res.status})` });
      }
    } catch {
      setMsg({ kind: "err", text: "通信エラー" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop"
      style={{ zIndex: 22, alignItems: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        className="glass-panel modal-content modal-content--md modal-content--scroll"
      >
        <span className="eyebrow">ADMIN</span>
        <h3 className="t-h4" style={{ marginTop: 4, marginBottom: 6 }}>
          メンバーパスワード管理
        </h3>
        <p className="t-small muted" style={{ marginBottom: 16 }}>
          管理者だけがこの画面を開けます。パスワードをクリアすると admin パスワードのみでログイン可能な初期状態に戻ります。
        </p>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {(members ?? []).map((m) => {
            const isEditing = editingId === m.id;
            return (
              <li
                key={m.id}
                className="glass-cell"
                style={{ padding: "10px 12px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 10, height: 10, borderRadius: 999, background: m.color }}
                  />
                  <strong style={{ fontSize: ".875rem" }}>{m.name}</strong>
                  {m.isAdmin && <span className="badge">管理者</span>}
                  {m.hasPassword ? (
                    <span className="badge badge-ok">パスワード設定済</span>
                  ) : (
                    <span className="badge badge-warn">パスワード未設定</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {!isEditing && (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => { reset(); setEditingId(m.id); }}
                        disabled={pending}
                      >
                        パスワード設定
                      </button>
                      {m.hasPassword && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => clearPassword(m.id, m.name)}
                          disabled={pending}
                        >
                          クリア
                        </button>
                      )}
                    </>
                  )}
                </div>

                {isEditing && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      type="password"
                      className="input"
                      placeholder="新しいパスワード（4文字以上）"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      autoComplete="new-password"
                    />
                    <input
                      type="password"
                      className="input"
                      placeholder="確認"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      autoComplete="new-password"
                    />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={reset}
                        disabled={pending}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setPassword(m.id)}
                        disabled={pending || newPw.length < 4 || newPw !== confirmPw}
                      >
                        {pending ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {msg && (
          <p
            className={`badge ${msg.kind === "ok" ? "badge-ok" : "badge-error"}`}
            style={{ display: "block", width: "fit-content", marginTop: 14 }}
          >
            {msg.text}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
