CREATE TYPE "public"."asset_category_type" AS ENUM('hardware', 'software_license');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('available', 'assigned', 'in_repair', 'retired', 'lost');--> statement-breakpoint
CREATE TABLE "asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"returned_at" timestamp with time zone,
	"returned_condition" text,
	"linked_checklist_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "asset_category_type" DEFAULT 'hardware' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" text NOT NULL,
	"category_id" uuid NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"status" "asset_status" DEFAULT 'available' NOT NULL,
	"purchase_date" date,
	"purchase_cost" bigint,
	"warranty_expiry" date,
	"notes" text,
	"vendor" text,
	"seats_total" integer,
	"seats_used" integer DEFAULT 0 NOT NULL,
	"renewal_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_asset_tag_unique" UNIQUE("asset_tag")
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" text NOT NULL,
	"dimension" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimension_key" text DEFAULT '' NOT NULL,
	"period" text NOT NULL,
	"value" double precision NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_employees_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_linked_checklist_task_id_checklist_tasks_id_fk" FOREIGN KEY ("linked_checklist_task_id") REFERENCES "public"."checklist_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_asset_assignments_asset" ON "asset_assignments" USING btree ("asset_id","returned_at");--> statement-breakpoint
CREATE INDEX "ix_asset_assignments_employee" ON "asset_assignments" USING btree ("employee_id","returned_at");--> statement-breakpoint
CREATE INDEX "ix_asset_categories_type" ON "asset_categories" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ix_assets_status" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_assets_category" ON "assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ix_assets_warranty_expiry" ON "assets" USING btree ("warranty_expiry");--> statement-breakpoint
CREATE INDEX "ix_assets_renewal_date" ON "assets" USING btree ("renewal_date");--> statement-breakpoint
CREATE INDEX "ix_metric_snapshots_key_period" ON "metric_snapshots" USING btree ("metric_key","period");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_metric_snapshot" ON "metric_snapshots" USING btree ("metric_key","dimension_key","period");