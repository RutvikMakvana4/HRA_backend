CREATE TYPE "public"."application_status" AS ENUM('active', 'rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('referral', 'inbound', 'outbound', 'agency', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('praise', 'constructive');--> statement-breakpoint
CREATE TYPE "public"."feedback_visibility" AS ENUM('private', 'manager_visible');--> statement-breakpoint
CREATE TYPE "public"."goal_category" AS ENUM('objective', 'key_result', 'personal', 'okr');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'on_track', 'at_risk', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('onsite', 'remote');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."interview_type" AS ENUM('screen', 'technical', 'cultural', 'final');--> statement-breakpoint
CREATE TYPE "public"."job_opening_status" AS ENUM('open', 'on_hold', 'closed', 'filled');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."review_cycle_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."review_cycle_type" AS ENUM('quarterly', 'half_yearly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('self', 'manager', 'peer');--> statement-breakpoint
CREATE TYPE "public"."scorecard_recommendation" AS ENUM('strong_hire', 'hire', 'no_hire', 'strong_no_hire');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_employee_id" uuid NOT NULL,
	"to_employee_id" uuid NOT NULL,
	"type" "feedback_type" NOT NULL,
	"visibility" "feedback_visibility" DEFAULT 'private' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle_id" uuid,
	"parent_goal_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" "goal_category" DEFAULT 'personal' NOT NULL,
	"weight" integer,
	"metric_target" text,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"due_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_on_ones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shared_notes" text,
	"private_notes" text,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "review_cycle_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "review_cycle_status" DEFAULT 'draft' NOT NULL,
	"template_id" uuid,
	"includes_self_review" boolean DEFAULT true NOT NULL,
	"includes_peer_review" boolean DEFAULT false NOT NULL,
	"includes_manager_review" boolean DEFAULT true NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"subject_employee_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"type" "review_type" NOT NULL,
	"template_id" uuid,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_rating" integer,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_employee_id_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_to_employee_id_employees_id_fk" FOREIGN KEY ("to_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_goals_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_employees_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "ix_feedback_to" ON "feedback" USING btree ("to_employee_id");--> statement-breakpoint
CREATE INDEX "ix_feedback_from" ON "feedback" USING btree ("from_employee_id");--> statement-breakpoint
CREATE INDEX "ix_goals_employee" ON "goals" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_goals_cycle" ON "goals" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "ix_goals_parent" ON "goals" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "ix_one_on_ones_manager" ON "one_on_ones" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "ix_one_on_ones_employee" ON "one_on_ones" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_review_cycles_status" ON "review_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_reviews_cycle" ON "reviews" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "ix_reviews_subject" ON "reviews" USING btree ("subject_employee_id");--> statement-breakpoint
CREATE INDEX "ix_reviews_reviewer" ON "reviews" USING btree ("reviewer_id","status");--> statement-breakpoint
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