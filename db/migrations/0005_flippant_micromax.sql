-- C-1: schema drift fix. 0000〜0004 の SQL では追加されていないが、
-- schema.ts と meta/0004_snapshot.json には記録済みのカラム群。
-- 既存環境（手動 ALTER 済の本番 Neon 含む）で安全に no-op するため IF NOT EXISTS で当てる。
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visible_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- H-4: numeric(5,2) は 999.99 上限で複数バケット合算時にオーバーフローする。numeric(7,2) に拡張。
ALTER TABLE "recurring_tasks" ALTER COLUMN "estimated_hours" SET DATA TYPE numeric(7, 2);--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "estimated_hours" SET DATA TYPE numeric(7, 2);--> statement-breakpoint
ALTER TABLE "workload" ALTER COLUMN "planned_hours" SET DATA TYPE numeric(7, 2);--> statement-breakpoint
-- M-2: FK / 検索条件で使われるカラムに index を追加（IF NOT EXISTS で本番冪等）
CREATE INDEX IF NOT EXISTS "recurring_tasks_assignee_member_id_idx" ON "recurring_tasks" USING btree ("assignee_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_member_id_idx" ON "tasks" USING btree ("assignee_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_week_iso_idx" ON "tasks" USING btree ("week_iso");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workload_week_iso_idx" ON "workload" USING btree ("week_iso");
