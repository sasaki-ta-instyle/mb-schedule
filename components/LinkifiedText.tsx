import type { CSSProperties } from "react";

// URL を自動でリンク化（http/https のみ）。XSS 防止のためテキストノードとして扱う。
const URL_RE = /(https?:\/\/[^\s<>"'`)）\]】｝]+[^\s.,;:!?<>"'`)）\]】｝])/g;

export function LinkifiedText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  if (!text) return null;
  const parts: Array<string | { url: string }> = [];
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > lastIndex) parts.push(text.slice(lastIndex, i));
    parts.push({ url: m[0] });
    lastIndex = i + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-info)", textDecoration: "underline" }}
          >
            {p.url}
          </a>
        ),
      )}
    </span>
  );
}
