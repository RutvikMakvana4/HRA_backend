CREATE TYPE "public"."application_status" AS ENUM('active', 'rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('referral', 'inbound', 'outbound', 'agency', 'other');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('onsite', 'remote');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."interview_type" AS ENUM('screen', 'technical', 'cultural', 'final');--> statement-breakpoint
CREATE TYPE "public"."job_opening_status" AS ENUM('open', 'on_hold', 'closed', 'filled');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."scorecard_recommendation" AS ENUM('strong_hire', 'hire', 'no_hire', 'strong_no_hire');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_opening_id" uuid NOT NULL,
	"current_stage_id" uuid,
	"status" "application_status" DEFAULT 'active' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_reason" text,
	"hired_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"resume_document_id" uuid,
	"source" "candidate_source" DEFAULT 'inbound' NOT NULL,
	"referred_by_employee_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"interviewer_id" uuid NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"recommendation" "scorecard_recommendation" NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"type" "interview_type" NOT NULL,
	"interviewer_id" uuid,
	"scheduled_at" timestamp with time zone,
	"mode" "interview_mode" DEFAULT 'remote' NOT NULL,
	"status" "interview_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"employment_type" "employment_type" NOT NULL,
	"hiring_manager_id" uuid,
	"location" "work_location" NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"description" text,
	"status" "job_opening_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"offer_document_id" uuid,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_opening_id_job_openings_id_fk" FOREIGN KEY ("job_opening_id") REFERENCES "public"."job_openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_current_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_hired_employee_id_employees_id_fk" FOREIGN KEY ("hired_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_resume_document_id_documents_id_fk" FOREIGN KEY ("resume_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_referred_by_employee_id_employees_id_fk" FOREIGN KEY ("referred_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interviewer_id_employees_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_employees_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_hiring_manager_id_employees_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_offer_document_id_documents_id_fk" FOREIGN KEY ("offer_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_applications_candidate" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "ix_applications_opening" ON "applications" USING btree ("job_opening_id","status");--> statement-breakpoint
CREATE INDEX "ix_applications_stage" ON "applications" USING btree ("current_stage_id");--> statement-breakpoint
CREATE INDEX "ix_candidates_email" ON "candidates" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_candidates_referrer" ON "candidates" USING btree ("referred_by_employee_id");--> statement-breakpoint
CREATE INDEX "ix_interview_scorecards_interview" ON "interview_scorecards" USING btree ("interview_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_interview_scorecards_interview_interviewer" ON "interview_scorecards" USING btree ("interview_id","interviewer_id");--> statement-breakpoint
CREATE INDEX "ix_interviews_application" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "ix_interviews_interviewer" ON "interviews" USING btree ("interviewer_id","status");--> statement-breakpoint
CREATE INDEX "ix_job_openings_status" ON "job_openings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_job_openings_department" ON "job_openings" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ix_job_openings_hiring_manager" ON "job_openings" USING btree ("hiring_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_offers_application" ON "offers" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "ix_pipeline_stages_sort" ON "pipeline_stages" USING btree ("sort_order");