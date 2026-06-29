ALTER TABLE "recurring_tasks" ADD COLUMN "week_of_month" integer;
--> statement-breakpoint
UPDATE "recurring_tasks" SET "week_of_month" = 1 WHERE "recurrence_type" = 'monthly' AND "week_of_month" IS NULL;