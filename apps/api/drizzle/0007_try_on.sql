CREATE TABLE "saved_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"try_on_result_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "try_on_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"image_path" text NOT NULL,
	"thumbnail_path" text NOT NULL,
	"suitability_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "try_on_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_image_id" uuid,
	"person_photo_id" uuid NOT NULL,
	"avatar_id" uuid,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"provider_job_id" text,
	"result_image_path" text,
	"error_code" text,
	"error_message" text,
	"diagnostic" text,
	"idempotency_key" uuid NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "saved_looks" ADD CONSTRAINT "saved_looks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_looks" ADD CONSTRAINT "saved_looks_try_on_result_id_try_on_results_id_fk" FOREIGN KEY ("try_on_result_id") REFERENCES "public"."try_on_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_looks" ADD CONSTRAINT "saved_looks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_photos" ADD CONSTRAINT "try_on_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD CONSTRAINT "try_on_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD CONSTRAINT "try_on_results_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD CONSTRAINT "try_on_results_product_image_id_product_images_id_fk" FOREIGN KEY ("product_image_id") REFERENCES "public"."product_images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD CONSTRAINT "try_on_results_person_photo_id_try_on_photos_id_fk" FOREIGN KEY ("person_photo_id") REFERENCES "public"."try_on_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_results" ADD CONSTRAINT "try_on_results_avatar_id_avatars_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_looks_result_idx" ON "saved_looks" USING btree ("try_on_result_id");--> statement-breakpoint
CREATE INDEX "saved_looks_user_idx" ON "saved_looks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "try_on_photos_user_idx" ON "try_on_photos" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "try_on_results_user_created_idx" ON "try_on_results" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "try_on_results_idempotency_idx" ON "try_on_results" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "try_on_results_one_active_pair" ON "try_on_results" USING btree ("user_id","person_photo_id","product_image_id") WHERE "try_on_results"."status" in ('pending', 'processing');