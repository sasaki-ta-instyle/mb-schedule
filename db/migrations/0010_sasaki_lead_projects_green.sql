-- 佐々木が主担当 (planned_member_ids[0]) のプロジェクト色を新しい緑 (#15A03A) に揃える。
-- 0009 でメンバー色を変更しただけでは、既存プロジェクトの color は更新されないため retroactive UPDATE。
-- 0008 (山田) と同じパターン。
UPDATE "projects"
SET "color" = '#15A03A'
WHERE jsonb_array_length("planned_member_ids") > 0
  AND ("planned_member_ids" ->> 0)::int = (
    SELECT "id" FROM "members" WHERE "name" = '佐々木' LIMIT 1
  );
