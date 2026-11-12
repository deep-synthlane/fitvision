ALTER TABLE "profiles" ALTER COLUMN "birth_year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "sex";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "goal";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "experience";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "workouts_per_week";