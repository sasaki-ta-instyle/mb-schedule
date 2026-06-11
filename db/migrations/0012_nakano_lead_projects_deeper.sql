-- 中野主担当のプロジェクト色を新色 (#E0A100) に揃える。0008 / 0010 と同じ retroactive UPDATE パターン。
UPDATE "projects"
SET "color" = '#E0A100'
WHERE jsonb_array_length("planned_member_ids") > 0
  AND ("planned_member_ids" ->> 0)::int = (
    SELECT "id" FROM "members" WHERE "name" = '中野' LIMIT 1
  );
