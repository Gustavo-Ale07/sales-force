CREATE TABLE "customer_registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tax_id" text NOT NULL,
	"name" text NOT NULL,
	"seller_code" integer,
	"erp_customer_code" integer,
	"rejection_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_registration_status_chk" CHECK ("customer_registration"."status" in ('pending', 'confirmed', 'rejected', 'unknown')),
	CONSTRAINT "customer_registration_tax_id_chk" CHECK ("customer_registration"."tax_id" ~ '^[0-9]{11}$|^[0-9]{14}$'),
	CONSTRAINT "customer_registration_confirmed_chk" CHECK (("customer_registration"."status" = 'confirmed') = ("customer_registration"."erp_customer_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "customer_registration" ADD CONSTRAINT "customer_registration_created_by_account_id_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_registration_account_request_uq" ON "customer_registration" USING btree ("created_by_account_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_registration_origin_key_uq" ON "customer_registration" USING btree ("origin_key");--> statement-breakpoint
CREATE INDEX "customer_registration_tax_id_open_idx" ON "customer_registration" USING btree ("tax_id") WHERE "customer_registration"."status" in ('pending', 'unknown');--> statement-breakpoint
CREATE INDEX "customer_registration_account_created_idx" ON "customer_registration" USING btree ("created_by_account_id","created_at" DESC NULLS LAST);