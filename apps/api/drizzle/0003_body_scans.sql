CREATE TABLE "body_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"front_image_path" text NOT NULL,
	"side_image_path" text NOT NULL,
	"back_image_path" text,
	"processing_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD COLUMN "scan_estimates" jsonb;--> statement-breakpoint
ALTER TABLE "body_scans" ADD CONSTRAINT "body_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_scans_user_created_idx" ON "body_scans" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_scan_id_body_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."body_scans"("id") ON DELETE set null ON UPDATE no action;