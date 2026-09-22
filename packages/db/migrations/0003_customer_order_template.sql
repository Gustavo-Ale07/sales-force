CREATE TABLE "customer_order_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_code" integer NOT NULL,
	"name" text NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customer_order_template_name_chk" CHECK ("customer_order_template"."name" ~ '[^[:space:]]' and char_length("customer_order_template"."name") <= 80),
	CONSTRAINT "customer_order_template_version_chk" CHECK ("customer_order_template"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "customer_order_template_item" (
	"template_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_code" integer NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	CONSTRAINT "customer_order_template_item_pk" PRIMARY KEY("template_id","line_no"),
	CONSTRAINT "customer_order_template_item_line_no_chk" CHECK ("customer_order_template_item"."line_no" between 1 and 500),
	CONSTRAINT "customer_order_template_item_quantity_chk" CHECK ("customer_order_template_item"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_order_template" ADD CONSTRAINT "customer_order_template_created_by_account_id_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order_template_item" ADD CONSTRAINT "customer_order_template_item_template_id_customer_order_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."customer_order_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_order_template_customer_name_uq" ON "customer_order_template" USING btree ("customer_code",lower("name")) WHERE "customer_order_template"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_order_template_account_request_uq" ON "customer_order_template" USING btree ("created_by_account_id","client_request_id");