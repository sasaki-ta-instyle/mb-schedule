CREATE TABLE "recurring_task_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"recurring_task_id" integer NOT NULL,
	"week_iso" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"assignee_member_id" integer,
	"recurrence_type" text DEFAULT 'weekly' NOT NULL,
	"estimated_hours" numeric(5, 2),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_task_completions" ADD CONSTRAINT "recurring_task_completions_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_completion_unique" ON "recurring_task_completions" USING btree ("recurring_task_id","week_iso");
