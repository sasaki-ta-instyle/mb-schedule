"use client";

import { useEffect, useState } from "react";

const KEY = "mb-schedule:edit-mode";
const MEMBER_KEY = "mb-schedule:current-member-id";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Mode = "preview" | "edit";

const bus: EventTarget | null =
  typeof window !== "undefined" ? new EventTarget() : null;

function broadcast(next: Mode) {
  bus?.dispatchEvent(new CustomEvent<Mode>("change", { detail: next }));
}

export function useEditMode() {
  const [mode, setMode] = useState<Mode>("preview");
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored === "edit" || stored === "preview") setMode(stored);
      const storedMember = window.localStorage.getItem(MEMBER_KEY);
      if (storedMember) {
        const n = Number(storedMember);
        if (Number.isInteger(n) && n > 0) setCurrentMemberId(n);
      }
    } catch {}

    // サーバ側の真のセッション状態を確認し、ローカルと同期
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/edit-check`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (res.ok) {
          const data = (await res.json()) as { memberId?: number | null };
          if (typeof data.memberId === "number") {
            setCurrentMemberId(data.memberId);
            try {
              window.localStorage.setItem(MEMBER_KEY, String(data.memberId));
            } catch {}
          }
        } else {
          // セッション失効 → メンバーもクリア
          setCurrentMemberId(null);
          try {
            window.localStorage.removeItem(MEMBER_KEY);
          } catch {}
        }
      } catch {}
    })();

    const onBusChange = (e: Event) => {
      const detail = (e as CustomEvent<Mode>).detail;
      if (detail === "edit" || detail === "preview") setMode(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        if (e.newValue === "edit" || e.newValue === "preview") setMode(e.newValue);
      }
      if (e.key === MEMBER_KEY) {
        const n = e.newValue ? Number(e.newValue) : NaN;
        setCurrentMemberId(Number.isInteger(n) && n > 0 ? n : null);
      }
    };
    bus?.addEventListener("change", onBusChange);
    window.addEventListener("storage", onStorage);
    return () => {
      bus?.removeEventListener("change", onBusChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function persist(next: Mode) {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {}
    broadcast(next);
  }

  function persistMember(id: number | null) {
    setCurrentMemberId(id);
    try {
      if (id == null) window.localStorage.removeItem(MEMBER_KEY);
      else window.localStorage.setItem(MEMBER_KEY, String(id));
    } catch {}
  }

  async function tryEnterEdit() {
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/edit-check`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as { memberId?: number | null };
        // 認証 OK でも誰としてログインしているか不明なら必ず選び直してもらう
        if (typeof data.memberId === "number") {
          persistMember(data.memberId);
          persist("edit");
          return;
        }
      }
    } catch {}
    setPromptOpen(true);
  }

  async function submitLogin(memberId: number, password: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/edit-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, password }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as { memberId?: number | null };
        persistMember(typeof data.memberId === "number" ? data.memberId : memberId);
        persist("edit");
        setPromptOpen(false);
      } else if (res.status === 401) {
        setError("パスワードが違います");
      } else if (res.status === 400) {
        setError("メンバーを選択してください");
      } else {
        setError(`エラー (${res.status})`);
      }
    } catch {
      setError("通信エラー");
    } finally {
      setPending(false);
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${BASE}/api/auth/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.ok) return { ok: true };
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j?.error ?? `エラー (${res.status})` };
    } catch {
      return { ok: false, error: "通信エラー" };
    }
  }

  async function exitEdit() {
    // UI モードを preview に戻すだけ。サーバ側セッション（Cookie）は破棄しないので、
    // 再度「編集」に切り替えたときは tryEnterEdit() の GET で再ログイン不要となる。
    // 明示ログアウトが必要になったら DELETE /api/auth/edit-check を別 UI で呼ぶ。
    persist("preview");
  }

  async function update(next: "preview" | "edit") {
    if (next === "edit") {
      await tryEnterEdit();
    } else {
      await exitEdit();
    }
  }

  return {
    mode,
    isEdit: mode === "edit",
    isReadonly: mode === "preview",
    promptOpen,
    pending,
    error,
    currentMemberId,
    closePrompt: () => {
      setPromptOpen(false);
      setError(null);
    },
    submitLogin,
    changePassword,
    setMode: update,
    toggle: () => update(mode === "edit" ? "preview" : "edit"),
  };
}
