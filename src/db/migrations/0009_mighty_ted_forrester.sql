ALTER TABLE "documents" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_documents_candidate" ON "documents" USING btree ("candidate_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_one_owner" CHECK (not ("documents"."employee_id" is not null and "documents"."candidate_id" is not null));