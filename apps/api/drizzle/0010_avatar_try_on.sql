ALTER TABLE "try_on_photos" ADD COLUMN "source" text DEFAULT 'uploaded_photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "try_on_photos" ADD COLUMN "avatar_id" uuid;--> statement-breakpoint
ALTER TABLE "try_on_photos" ADD COLUMN "avatar_model_version" text;--> statement-breakpoint
ALTER TABLE "try_on_photos" ADD COLUMN "framing" text;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD COLUMN "avatar_model_version" text;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD COLUMN "person_source" text DEFAULT 'uploaded_photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "try_on_photos" ADD CONSTRAINT "try_on_photos_avatar_id_avatars_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "try_on_photos_avatar_idx" ON "try_on_photos" USING btree ("avatar_id");--> statement-breakpoint
-- Backfill: a result whose photo had already been used by an earlier result reused a saved photo.
UPDATE "try_on_results" AS r SET "person_source" = 'saved_photo'
WHERE EXISTS (SELECT 1 FROM "try_on_results" AS e WHERE e."person_photo_id" = r."person_photo_id" AND e."created_at" < r."created_at");
