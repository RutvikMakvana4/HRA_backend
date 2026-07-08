CREATE TYPE "public"."feedback_type" AS ENUM('praise', 'constructive');--> statement-breakpoint
CREATE TYPE "public"."feedback_visibility" AS ENUM('private', 'manager_visible');--> statement-breakpoint
CREATE TYPE "public"."goal_category" AS ENUM('objective', 'key_result', 'personal', 'okr');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'on_track', 'at_risk', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."review_cycle_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."review_cycle_type" AS ENUM('quarterly', 'half_yearly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('self', 'manager', 'peer');--> statement-breakpoint
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
CREATE INDEX "ix_reviews_reviewer" ON "reviews" USING btree ("reviewer_id","status");