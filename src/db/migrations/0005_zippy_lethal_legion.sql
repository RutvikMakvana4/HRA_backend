ALTER TABLE "leave_balances" ALTER COLUMN "accrued" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "used" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "pending" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "leave_balances" ALTER COLUMN "carried_forward" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "leave_requests" ALTER COLUMN "days_count" SET DATA TYPE real;