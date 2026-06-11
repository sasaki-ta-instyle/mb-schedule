"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * ︙アクションメニュー（軽量 popover）。
 *
 * <details><summary> ベースで HTML 標準の開閉挙動を活用するため、
 * keyboard / screen reader / focus 管理が自然に効く。
 * 外側クリック / Esc で閉じる挙動だけ JS で補強する。
 *
 * 用途: ProjectRow の「アーカイブ / 削除 / その他副次的アクション」を 1 つに集約。
 * 「タスク追加」など主役 CTA はメニュー外に置く。
 *
 * 子要素は <button> を並べる想定。destructive な操作には `data-destructive`
 * 属性 or className "menu-item--destructive" を付けて視覚的に区別する。
 */
export function ActionMenu({
  label = "アクション",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onDocClick(e: MouseEvent) {
      if (!el || !el.open) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        el.open = false;
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && el && el.open) {
        el.open = false;
        const summary = el.querySelector("summary");
        if (summary instanceof HTMLElement) summary.focus();
      }
    }
    // open 中は body に class を付与。Dashboard の tooltip など、
    // メニューと重なって読みにくい外部 UI を CSS で隠すための signal。
    function onToggle() {
      if (!el) return;
      if (el.open) document.body.classList.add("action-menu-open");
      else document.body.classList.remove("action-menu-open");
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    el.addEventListener("toggle", onToggle);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      el.removeEventListener("toggle", onToggle);
      // unmount 時に取り残された class を掃除
      document.body.classList.remove("action-menu-open");
    };
  }, []);

  return (
    <details ref={ref} className="action-menu">
      <summary
        className="btn btn-ghost btn-sm action-menu-trigger"
        aria-label={label}
        title={label}
        // toggle イベントは数フレーム遅れるため、ポインタが触れた瞬間に
        // body class を先回りで付与してツールチップ等を即時に隠す。
        onPointerDown={() => {
          if (ref.current && !ref.current.open) {
            document.body.classList.add("action-menu-open");
          }
        }}
      >
        <span aria-hidden="true">︙</span>
      </summary>
      <div role="menu" className="action-menu-list">
        {children}
      </div>
    </details>
  );
}
