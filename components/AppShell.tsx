"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { useEditMode } from "@/hooks/useEditMode";
import { fetcher } from "@/lib/api";
import { PasswordPrompt } from "./PasswordPrompt";
import { PasswordChangeModal } from "./PasswordChangeModal";
import { AdminMemberPasswordsModal } from "./AdminMemberPasswordsModal";

type Member = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  hasPassword?: boolean;
  isAdmin?: boolean;
};

const NAV: Array<{ href: string; label: string; editOnly?: boolean }> = [
  { href: "/", label: "ダッシュボード" },
  { href: "/projects", label: "プロジェクト" },
  { href: "/recurring", label: "定例タスク" },
  { href: "/timeline", label: "タイムライン" },
  { href: "/archived", label: "アーカイブ", editOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const {
    mode,
    setMode,
    isReadonly,
    isEdit,
    promptOpen,
    pending,
    error,
    currentMemberId,
    closePrompt,
    submitLogin,
    changePassword,
  } = useEditMode();
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [adminPwModalOpen, setAdminPwModalOpen] = useState(false);
  // スマホ時のハンバーガー drawer。リンク遷移で自動的に閉じるので state は最小限。
  const [navOpen, setNavOpen] = useState(false);

  const { data: members } = useSWR<Member[]>(
    isEdit ? "/api/members" : null,
    fetcher,
  );
  const currentMember = currentMemberId != null
    ? members?.find((m) => m.id === currentMemberId)
    : null;

  return (
    <div className={`page-wrap ${isReadonly ? "is-readonly" : ""}`}>
      <header
        className="app-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: "var(--space-5)",
          padding: "var(--space-4) var(--space-8)",
          background: "rgba(237, 233, 224, 0.72)",
          backdropFilter: "saturate(180%) blur(16px)",
          WebkitBackdropFilter: "saturate(180%) blur(16px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.42)",
        }}
      >
        {/* スマホでは「ロゴ + ハンバーガー」が 1 段目で並ぶ。
            display: contents なので PC の grid 配置には影響しない。 */}
        <div className="app-header-top">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "var(--space-1)",
              justifySelf: "start",
            }}
          >
            <img
              src="https://app.instyle.group/_shared/static/logo.svg"
              alt="INSTYLE GROUP"
              style={{ height: 12, width: "auto", display: "block", opacity: 0.85 }}
            />
            <strong
              className="t-h4"
              style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              プロジェクト週次ダッシュボード
            </strong>
          </div>

          <button
            type="button"
            className="hamburger btn btn-ghost"
            aria-expanded={navOpen}
            aria-label={navOpen ? "メニューを閉じる" : "メニューを開く"}
            onClick={() => setNavOpen((o) => !o)}
          >
            <span aria-hidden="true">{navOpen ? "✕" : "☰"}</span>
          </button>
        </div>

        <nav
          className={`tabs ${navOpen ? "is-open" : ""}`}
          onClick={() => setNavOpen(false)}
          style={{ justifySelf: "center" }}
        >
          {NAV.filter((item) => !item.editOnly || isEdit).map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div
          className={`app-header-right ${navOpen ? "is-open" : ""}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-3)",
            justifySelf: "end",
          }}
        >
          {isEdit && currentMember && (
            <>
              {currentMember.isAdmin && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAdminPwModalOpen(true)}
                  title="メンバーのパスワードを設定"
                >
                  メンバー管理
                </button>
              )}
              <button
                type="button"
                className="badge"
                title="自分のパスワードを変更"
                onClick={() => setPwModalOpen(true)}
                style={{
                  background: "rgba(255,255,255,.72)",
                  borderColor: "rgba(255,255,255,.78)",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: currentMember.color,
                    boxShadow: "inset 0 0 0 .5px rgba(255,255,255,.55)",
                  }}
                />
                {currentMember.name}
                {currentMember.isAdmin && (
                  <span className="muted" style={{ fontSize: ".625rem", marginLeft: 4 }}>
                    （管理者）
                  </span>
                )}
              </button>
            </>
          )}
          <div
            className="mode-toggle"
            role="group"
            aria-label="モード切替"
          >
            <button
              type="button"
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              プレビュー
            </button>
            <button
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              編集
            </button>
          </div>
        </div>
      </header>

      <main style={{ padding: "var(--space-2) var(--space-8) 60px" }}>{children}</main>

      <PasswordPrompt
        open={promptOpen}
        pending={pending}
        error={error}
        initialMemberId={currentMemberId}
        onSubmit={submitLogin}
        onCancel={closePrompt}
      />

      <PasswordChangeModal
        open={pwModalOpen}
        memberName={currentMember?.name ?? null}
        onSubmit={changePassword}
        onClose={() => setPwModalOpen(false)}
      />

      <AdminMemberPasswordsModal
        open={adminPwModalOpen}
        onClose={() => setAdminPwModalOpen(false)}
      />
    </div>
  );
}
