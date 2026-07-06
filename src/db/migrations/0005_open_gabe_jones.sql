CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('INR', 'GBP');--> statement-breakpoint
CREATE TYPE "public"."expense_claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'on_hold', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('client', 'internal');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "project_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_on_project" text,
	"allocation_pct" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"type" "project_type" DEFAULT 'client' NOT NULL,
	"default_billable" boolean DEFAULT true NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"pm_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"task_description" text,
	"category" text,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start_date" date NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"approver_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_timesheet_week" UNIQUE("employee_id","week_start_date")
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"requires_receipt" boolean DEFAULT true NOT NULL,
	"monthly_cap" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"currency" "currency" NOT NULL,
	"total_amount" bigint NOT NULL,
	"status" "expense_claim_status" DEFAULT 'draft' NOT NULL,
	"project_id" uuid,
	"submitted_at" timestamp with time zone,
	"approver_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reimbursed_at" timestamp with time zone,
	"reimbursed_by" uuid,
	"reimbursement_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"description" text,
	"receipt_document_id" uuid,
	"merchant" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_allocations" ADD CONSTRAINT "project_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_allocations" ADD CONSTRAINT "project_allocations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_employee_id_employees_id_fk" FOREIGN KEY ("pm_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_week_id_timesheet_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."timesheet_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_approver_id_employees_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_approver_id_employees_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_claim_id_expense_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."expense_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_receipt_document_id_documents_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_clients_status" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_project_allocations_project" ON "project_allocations" USING btree ("project_id","is_active");--> statement-breakpoint
CREATE INDEX "ix_project_allocations_employee" ON "project_allocations" USING btree ("employee_id","is_active");--> statement-breakpoint
CREATE INDEX "ix_projects_client" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "ix_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_projects_pm" ON "projects" USING btree ("pm_employee_id");--> statement-breakpoint
CREATE INDEX "ix_timesheet_entries_week" ON "timesheet_entries" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "ix_timesheet_entries_employee_date" ON "timesheet_entries" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "ix_timesheet_entries_project" ON "timesheet_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_timesheet_weeks_employee" ON "timesheet_weeks" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_timesheet_weeks_status" ON "timesheet_weeks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_expense_categories_active" ON "expense_categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ix_expense_claims_employee" ON "expense_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_expense_claims_status" ON "expense_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_expense_claims_approver" ON "expense_claims" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "ix_expense_claims_project" ON "expense_claims" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_expense_line_items_claim" ON "expense_line_items" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "ix_expense_line_items_category" ON "expense_line_items" USING btree ("category_id");