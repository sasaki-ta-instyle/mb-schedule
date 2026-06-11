-- 和田主担当のプロジェクト色を和田色 (#1A73E8) に retroactively 揃える。
-- 0006 でメンバー色を青に変更した時点では projects 側の retroactive UPDATE を
-- やらなかったため、今回まとめて反映する。0008 / 0010 / 0012 と同じパターン。
UPDATE "projects"
SET "color" = '#1A73E8'
WHERE jsonb_array_length("planned_member_ids") > 0
  AND ("planned_member_ids" ->> 0)::int = (
    SELECT "id" FROM "members" WHERE "name" = '和田' LIMIT 1
  );
