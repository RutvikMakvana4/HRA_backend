-- Module 1 — Employee Core + Documents.
-- Replaces the placeholder `employees` table (empty scaffold) with the real schema and adds
-- `departments` + `documents`. `actor_type` and `audit_log` already exist from 0000.
DROP TABLE "employees" CASCADE;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('offer_letter', 'id_proof', 'contract', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('hr_only', 'employee_visible');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'on_notice', 'exited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'contractor', 'intern');--> statement-breakpoint
CREATE TYPE "public"."work_location" AS ENUM('india', 'uk', 'remote');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"head_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"title" text NOT NULL,
	"file_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"visibility" "document_visibility" DEFAULT 'hr_only' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text,
	"personal_email" "citext",
	"work_email" "citext" NOT NULL,
	"phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"date_of_birth" date,
	"gender" text,
	"employment_type" "employment_type" NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"date_of_joining" date NOT NULL,
	"date_of_exit" date,
	"work_location" "work_location" NOT NULL,
	"designation" text,
	"department_id" uuid,
	"manager_id" uuid,
	"statutory_ids" jsonb,
	"salary_structure" jsonb,
	"bank_account" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code"),
	CONSTRAINT "employees_work_email_unique" UNIQUE("work_email")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_departments_head" ON "departments" USING btree ("head_employee_id");--> statement-breakpoint
CREATE INDEX "ix_documents_employee" ON "documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_documents_type" ON "documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ix_employees_department" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ix_employees_manager" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "ix_employees_status" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_employees_employment_type" ON "employees" USING btree ("employment_type");--> statement-breakpoint
CREATE INDEX "ix_employees_work_location" ON "employees" USING btree ("work_location");
