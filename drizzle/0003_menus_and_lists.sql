CREATE TYPE "public"."list_item_source" AS ENUM('generated', 'manual');--> statement-breakpoint
CREATE TYPE "public"."list_status" AS ENUM('abierta', 'completada');--> statement-breakpoint
CREATE TYPE "public"."meal_kind" AS ENUM('desayuno', 'comida', 'cena', 'colacion');--> statement-breakpoint
CREATE TABLE "menu" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"week_start" date NOT NULL,
	"default_servings" integer DEFAULT 4 NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"menu_id" integer NOT NULL,
	"date" date NOT NULL,
	"meal" "meal_kind" NOT NULL,
	"recipe_id" integer NOT NULL,
	"servings" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "shopping_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"menu_id" integer,
	"name" text NOT NULL,
	"status" "list_status" DEFAULT 'abierta' NOT NULL,
	"include_optional" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"ingredient_id" integer,
	"label" text NOT NULL,
	"quantity" numeric,
	"unit_code" text,
	"aisle_id" integer,
	"store_id" integer,
	"checked" boolean DEFAULT false NOT NULL,
	"source" "list_item_source" DEFAULT 'manual' NOT NULL,
	"merge_key" text,
	"source_recipes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu" ADD CONSTRAINT "menu_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_list_id_shopping_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_unit_code_unit_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."unit"("code") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_aisle_id_aisle_id_fk" FOREIGN KEY ("aisle_id") REFERENCES "public"."aisle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_week_idx" ON "menu" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "menu_item_menu_idx" ON "menu_item" USING btree ("menu_id","date");--> statement-breakpoint
CREATE INDEX "menu_item_recipe_idx" ON "menu_item" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "shopping_list_menu_idx" ON "shopping_list" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "shopping_list_item_list_idx" ON "shopping_list_item" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "shopping_list_item_ingredient_idx" ON "shopping_list_item" USING btree ("ingredient_id");