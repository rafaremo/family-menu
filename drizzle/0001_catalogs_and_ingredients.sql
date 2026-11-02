-- Búsqueda difusa (trigramas) para ingredientes y alias.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('category', 'diet', 'occasion', 'free');--> statement-breakpoint
CREATE TYPE "public"."unit_dimension" AS ENUM('mass', 'volume', 'count', 'other');--> statement-breakpoint
CREATE TABLE "aisle" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"aisle_id" integer,
	"default_store_id" integer,
	"default_unit" text,
	"density_g_per_ml" numeric,
	"grams_per_piece" numeric,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "tag_kind" DEFAULT 'free' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plural" text NOT NULL,
	"dimension" "unit_dimension" NOT NULL,
	"to_base" numeric,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_aisle_id_aisle_id_fk" FOREIGN KEY ("aisle_id") REFERENCES "public"."aisle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_default_store_id_store_id_fk" FOREIGN KEY ("default_store_id") REFERENCES "public"."store"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_default_unit_unit_code_fk" FOREIGN KEY ("default_unit") REFERENCES "public"."unit"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aisle_name_key" ON "aisle" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_name_key_key" ON "ingredient" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_slug_key" ON "ingredient" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ingredient_keys_idx" ON "ingredient" USING gin ("keys");--> statement-breakpoint
CREATE INDEX "ingredient_search_trgm_idx" ON "ingredient" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ingredient_aisle_idx" ON "ingredient" USING btree ("aisle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_name_key" ON "store" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tag_slug_key" ON "tag" USING btree ("slug");