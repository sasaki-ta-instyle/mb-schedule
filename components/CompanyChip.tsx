import type { Company } from "@/lib/companies";

type Size = "sm" | "xs";

export function CompanyChip({
  company,
  size = "sm",
}: {
  company: Company | null | undefined;
  size?: Size;
}) {
  if (!company) {
    if (size === "xs") return null;
    return (
      <span
        style={{
          fontSize: ".6875rem",
          color: "var(--color-text-light)",
        }}
      >
        —
      </span>
    );
  }
  const isXs = size === "xs";
  return (
    <span
      title={`会社タグ: ${company}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: isXs ? "1px 6px" : "2px 8px",
        fontSize: isXs ? ".625rem" : ".6875rem",
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color: "var(--color-text)",
        background: "rgba(255,255,255,.55)",
        border: "1px solid rgba(255,255,255,.7)",
        borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {company}
    </span>
  );
}
