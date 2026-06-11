export const COMPANIES = [
  "IG",
  "西村さん",
  "人事",
  "労務",
  "アプリ",
  "メビウス",
  "イルムス",
  "VERITE",
  "おふぃごは",
  "Provision",
  "BIRTHLY",
  "DB",
  "とみ田",
  "be there",
  "Less",
  "XGJ",
  "CHICKEN",
  "Alouette",
  "マルゴット",
  "FEARLESS",
  "LtOVES",
] as const;

export type Company = (typeof COMPANIES)[number];

const COMPANY_SET: Set<string> = new Set(COMPANIES);

export function isKnownCompany(s: unknown): s is Company {
  return typeof s === "string" && COMPANY_SET.has(s);
}
