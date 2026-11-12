-- Fitness-era profiles lack the new required fields; those users re-run the fashion onboarding.
DELETE FROM "profiles";--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"height_cm" real,
	"chest_cm" real,
	"waist_cm" real,
	"hips_cm" real,
	"shoulder_cm" real,
	"inseam_cm" real,
	"arm_length_cm" real,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "clothing_preference" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "country" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "measurement_unit" text NOT NULL;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_measurements_user_created_idx" ON "body_measurements" USING btree ("user_id","created_at");