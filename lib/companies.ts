// mb-schedule 用「ブランド/部署」タグ。
// ブランド系（simius / TRIPURE / UPTIS / AWAI / STYLE HOMME / 新ブランド / 新規）と
// 部署系（CRM / CS / PR / 商品企画 / 商品開発 / 商品管理）の混在。
// 変数名・DB カラム名は ig-schedule 由来の company を継続使用（互換性のため）。
export const COMPANIES = [
  "simius",
  "TRIPURE",
  "UPTIS",
  "AWAI",
  "STYLE HOMME",
  "新ブランド",
  "新規",
  "CRM",
  "CS",
  "PR",
  "商品企画",
  "商品開発",
  "商品管理",
] as const;

export type Company = (typeof COMPANIES)[number];

const COMPANY_SET: Set<string> = new Set(COMPANIES);

export function isKnownCompany(s: unknown): s is Company {
  return typeof s === "string" && COMPANY_SET.has(s);
}
