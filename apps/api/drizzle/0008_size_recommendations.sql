CREATE TABLE "size_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"measurement_source" text NOT NULL,
	"scan_version" text,
	"recommended_variant_id" uuid,
	"recommended_size_label" text,
	"alternative_size_label" text,
	"fit_type" text,
	"confidence" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"comparison_json" jsonb NOT NULL,
	"warnings_json" jsonb NOT NULL,
	"chart_source" text,
	"product_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "size_recommendations" ADD CONSTRAINT "size_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "size_recommendations" ADD CONSTRAINT "size_recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "size_recommendations" ADD CONSTRAINT "size_recommendations_measurement_id_body_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."body_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "size_recommendations" ADD CONSTRAINT "size_recommendations_recommended_variant_id_product_variants_id_fk" FOREIGN KEY ("recommended_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "size_recommendations_user_product_idx" ON "size_recommendations" USING btree ("user_id","product_id","created_at");