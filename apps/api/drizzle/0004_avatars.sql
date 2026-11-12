CREATE TABLE "avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"body_scan_id" uuid,
	"measurement_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"avatar_type" text NOT NULL,
	"body_parameters_json" jsonb,
	"asset_path" text,
	"preview_image_path" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_body_scan_id_body_scans_id_fk" FOREIGN KEY ("body_scan_id") REFERENCES "public"."body_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_measurement_id_body_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."body_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatars_user_created_idx" ON "avatars" USING btree ("user_id","created_at");