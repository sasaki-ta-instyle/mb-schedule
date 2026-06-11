-- 山田が主担当 (planned_member_ids[0]) のプロジェクトの色を山田色 (#7C3AED) に揃える。
-- 既存実装 (commit f538b6d) は「プロジェクト編集時」に主担当の色へ自動連動するが、
-- メンバー色が変わったときの retroactive な再同期はしないため、ここで一括反映する。
-- 山田の id をハードコードせず、name から引いて使う。
UPDATE "projects"
SET "color" = '#7C3AED'
WHERE jsonb_array_length("planned_member_ids") > 0
  AND ("planned_member_ids" ->> 0)::int = (
    SELECT "id" FROM "members" WHERE "name" = '山田' LIMIT 1
  );
