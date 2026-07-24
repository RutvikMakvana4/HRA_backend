-- v2 data backfill (must run BEFORE task_id goes NOT NULL): give every task-less
-- entry a home so the column can be made mandatory. Idempotent.
-- 1. org-wide "General" internal project (home for future non-project tasks).
INSERT INTO "projects" ("name","code","type","default_billable","status")
VALUES ('General','GEN','internal',false,'active')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- 2. one "General" task per project that has task-less entries (preserves project attribution).
INSERT INTO "project_tasks" ("project_id","title","description","created_by")
SELECT DISTINCT te."project_id", 'General', 'Catch-all for pre-v2 logged time.',
       COALESCE(p."pm_employee_id", (SELECT "id" FROM "employees" LIMIT 1))
FROM "timesheet_entries" te
JOIN "projects" p ON p."id" = te."project_id"
WHERE te."task_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "project_tasks" pt
    WHERE pt."project_id" = te."project_id" AND pt."title" = 'General'
  );--> statement-breakpoint
-- 3. repoint the task-less entries onto their project's General task.
UPDATE "timesheet_entries" te
SET "task_id" = pt."id"
FROM "project_tasks" pt
WHERE pt."project_id" = te."project_id" AND pt."title" = 'General' AND te."task_id" IS NULL;--> statement-breakpoint
ALTER TABLE "timesheet_entries" DROP CONSTRAINT "uq_timesheet_entry_cell";--> statement-breakpoint
ALTER TABLE "timesheet_entries" DROP CONSTRAINT "timesheet_entries_task_id_project_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "timesheet_entries" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "uq_timesheet_entry_task_day" UNIQUE("week_id","task_id","work_date");
