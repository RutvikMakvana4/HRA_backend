CREATE TYPE "public"."checklist_assignee_role" AS ENUM('hr', 'manager', 'it', 'employee');--> statement-breakpoint
CREATE TYPE "public"."checklist_category" AS ENUM('documentation', 'access_provisioning', 'asset', 'orientation', 'compliance', 'clearance', 'handover');--> statement-breakpoint
CREATE TYPE "public"."checklist_task_status" AS ENUM('pending', 'in_progress', 'done', 'blocked', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_case_status" AS ENUM('not_started', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_type" AS ENUM('onboarding', 'offboarding');--> statement-breakpoint
CREATE TABLE "checklist_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "checklist_category" NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"status" "checklist_task_status" DEFAULT 'pending' NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"linked_document_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "checklist_category" NOT NULL,
	"default_assignee_role" "checklist_assignee_role" DEFAULT 'hr' NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "lifecycle_type" NOT NULL,
	"applies_to" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "lifecycle_type" NOT NULL,
	"template_id" uuid,
	"status" "lifecycle_case_status" DEFAULT 'not_started' NOT NULL,
	"anchor_date" date NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_case_id_lifecycle_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."lifecycle_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_linked_document_id_documents_id_fk" FOREIGN KEY ("linked_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_checklist_tasks_case" ON "checklist_tasks" USING btree ("case_id","sort_order");--> statement-breakpoint
CREATE INDEX "ix_checklist_tasks_assignee" ON "checklist_tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "ix_checklist_tasks_status" ON "checklist_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_checklist_template_items_template" ON "checklist_template_items" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "ix_checklist_templates_type" ON "checklist_templates" USING btree ("type","is_active");--> statement-breakpoint
CREATE INDEX "ix_lifecycle_cases_employee" ON "lifecycle_cases" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_lifecycle_cases_status" ON "lifecycle_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_lifecycle_cases_type" ON "lifecycle_cases" USING btree ("type");