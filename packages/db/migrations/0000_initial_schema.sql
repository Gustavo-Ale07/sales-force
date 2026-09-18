-- Migration 0000_initial_schema (expand-only)
--
-- Migration safety note (DATA-2, P-16):
--   * Step: EXPAND. Creates the initial schema on an empty database; nothing is altered, dropped or
--     rewritten, so no application version can be broken by it.
--   * Locking: only new objects are created (no lock on existing data). The runner holds a
--     pg_advisory_lock so two migration runs never execute concurrently, and applies this file
--     in a single transaction (all-or-nothing).
--   * Data volume impact: none (empty tables, indexes created empty).
--   * Extension: pg_trgm is a trusted extension (PostgreSQL 13+); CREATE EXTENSION works for the
--     database owner without superuser. If a managed provider forbids it, this migration fails
--     loudly before anything else is created.
--   * Hand-edited after drizzle-kit generate: this header and CREATE EXTENSION only.
--   * Rollback: none (expand-only); on a disposable database drop the schema and re-run.
--   * Never applied with drizzle-kit push.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "installation_configuration_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_label" text NOT NULL,
	"source_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "installation_configuration_version_source_kind_chk" CHECK ("installation_configuration_version"."source_kind" in ('sankhya', 'bootstrap-file', 'demo'))
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"entity" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"cursor" jsonb,
	"last_full_reconcile_at" timestamp with time zone,
	"row_count" integer,
	"last_error_class" text,
	"last_error_message" text,
	CONSTRAINT "sync_state_status_chk" CHECK ("sync_state"."status" in ('idle', 'running', 'succeeded', 'failed')),
	CONSTRAINT "sync_state_row_count_chk" CHECK ("sync_state"."row_count" is null or "sync_state"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_role_chk" CHECK ("account"."role" in ('admin', 'manager', 'seller')),
	CONSTRAINT "account_status_chk" CHECK ("account"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "account_seller_link" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"seller_code" integer NOT NULL,
	"config_version_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_account_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_customer" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trade_name" text,
	"tax_id" text,
	"person_type" text,
	"email" text,
	"phone" text,
	"city" text,
	"state" text,
	"seller_code" integer,
	"price_table_code" integer,
	"credit_limit" numeric(14, 2),
	"active" boolean NOT NULL,
	"is_customer" boolean NOT NULL,
	"blocked_raw" text,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_customer_person_type_chk" CHECK ("erp_customer"."person_type" is null or "erp_customer"."person_type" in ('F', 'J')),
	CONSTRAINT "erp_customer_credit_limit_chk" CHECK ("erp_customer"."credit_limit" is null or "erp_customer"."credit_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "erp_list_price" (
	"version_id" integer NOT NULL,
	"product_code" integer NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_list_price_pk" PRIMARY KEY("version_id","product_code"),
	CONSTRAINT "erp_list_price_unit_price_chk" CHECK ("erp_list_price"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "erp_price_table" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text,
	"active" boolean NOT NULL,
	"origin_table_code" integer,
	"percent" numeric(12, 6),
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_price_table_version" (
	"version_id" integer PRIMARY KEY NOT NULL,
	"table_code" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_product" (
	"code" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"brand" text,
	"unit" text,
	"group_code" integer,
	"group_name" text,
	"usage_code" text,
	"active" boolean NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_seller" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"type_code" text,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_number" integer GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_draft_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_code" integer NOT NULL,
	"seller_code" integer,
	"created_by_account_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"negotiation_type_code" integer,
	"notes" text,
	"estimated_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"client_request_id" uuid NOT NULL,
	"external_origin_id" text,
	"erp_number" bigint,
	"config_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_status_chk" CHECK ("sales_order"."status" in ('draft', 'cancelled', 'queued', 'sent', 'rejected', 'unknown')),
	CONSTRAINT "sales_order_estimated_total_chk" CHECK ("sales_order"."estimated_total" >= 0),
	CONSTRAINT "sales_order_version_chk" CHECK ("sales_order"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sales_order_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_code" integer NOT NULL,
	"product_description" text NOT NULL,
	"unit" text,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_list_price" numeric(18, 6),
	"price_state" text NOT NULL,
	"price_table_code" integer,
	"price_version_id" integer,
	"estimated_line_total" numeric(14, 2),
	CONSTRAINT "sales_order_item_quantity_chk" CHECK ("sales_order_item"."quantity" > 0),
	CONSTRAINT "sales_order_item_line_no_chk" CHECK ("sales_order_item"."line_no" > 0),
	CONSTRAINT "sales_order_item_price_state_chk" CHECK ("sales_order_item"."price_state" in ('priced', 'zero', 'none')),
	CONSTRAINT "sales_order_item_unit_list_price_chk" CHECK ("sales_order_item"."unit_list_price" is null or "sales_order_item"."unit_list_price" >= 0),
	CONSTRAINT "sales_order_item_price_state_consistency_chk" CHECK (("sales_order_item"."price_state" = 'none' and "sales_order_item"."unit_list_price" is null and "sales_order_item"."estimated_line_total" is null)
        or ("sales_order_item"."price_state" = 'zero' and "sales_order_item"."unit_list_price" is not null and "sales_order_item"."unit_list_price" = 0)
        or ("sales_order_item"."price_state" = 'priced' and "sales_order_item"."unit_list_price" is not null and "sales_order_item"."unit_list_price" > 0 and "sales_order_item"."estimated_line_total" is not null)),
	CONSTRAINT "sales_order_item_estimated_line_total_chk" CHECK ("sales_order_item"."estimated_line_total" is null or "sales_order_item"."estimated_line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"origin_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_class" text,
	"last_error_message" text,
	"erp_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_outbox_status_chk" CHECK ("integration_outbox"."status" in ('pending', 'processing', 'confirmed', 'rejected', 'unknown')),
	CONSTRAINT "integration_outbox_attempt_count_chk" CHECK ("integration_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_seller_link" ADD CONSTRAINT "account_seller_link_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_seller_link" ADD CONSTRAINT "account_seller_link_config_version_id_installation_configuration_version_id_fk" FOREIGN KEY ("config_version_id") REFERENCES "public"."installation_configuration_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_account_id_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_account_id_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_config_version_id_installation_configuration_version_id_fk" FOREIGN KEY ("config_version_id") REFERENCES "public"."installation_configuration_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "installation_configuration_version_one_current_uq" ON "installation_configuration_version" USING btree ("is_current") WHERE "installation_configuration_version"."is_current";--> statement-breakpoint
CREATE INDEX "installation_configuration_version_content_hash_idx" ON "installation_configuration_version" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "account_email_lower_uq" ON "account" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "account_seller_link_seller_code_idx" ON "account_seller_link" USING btree ("seller_code");--> statement-breakpoint
CREATE INDEX "account_seller_link_config_version_id_idx" ON "account_seller_link" USING btree ("config_version_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_at_idx" ON "audit_log" USING btree ("actor_account_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_at_idx" ON "audit_log" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_uq" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_account_id_idx" ON "session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "erp_customer_name_trgm_idx" ON "erp_customer" USING gin ("name" gin_trgm_ops) WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_customer_trade_name_trgm_idx" ON "erp_customer" USING gin ("trade_name" gin_trgm_ops) WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_customer_tax_id_trgm_idx" ON "erp_customer" USING gin ("tax_id" gin_trgm_ops) WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_customer_seller_active_name_idx" ON "erp_customer" USING btree ("seller_code","active","name") WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_customer_active_name_idx" ON "erp_customer" USING btree ("active","name") WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_customer_price_table_code_idx" ON "erp_customer" USING btree ("price_table_code") WHERE "erp_customer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_list_price_product_code_idx" ON "erp_list_price" USING btree ("product_code","version_id") WHERE "erp_list_price"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_price_table_active_name_idx" ON "erp_price_table" USING btree ("active","name") WHERE "erp_price_table"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_price_table_version_table_effective_idx" ON "erp_price_table_version" USING btree ("table_code","effective_from" DESC NULLS LAST) WHERE "erp_price_table_version"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_product_description_trgm_idx" ON "erp_product" USING gin ("description" gin_trgm_ops) WHERE "erp_product"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_product_reference_trgm_idx" ON "erp_product" USING gin ("reference" gin_trgm_ops) WHERE "erp_product"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_product_group_active_description_idx" ON "erp_product" USING btree ("group_code","active","description") WHERE "erp_product"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_product_active_description_idx" ON "erp_product" USING btree ("active","description") WHERE "erp_product"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_product_usage_code_idx" ON "erp_product" USING btree ("usage_code") WHERE "erp_product"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "erp_seller_active_name_idx" ON "erp_seller" USING btree ("active","name") WHERE "erp_seller"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_client_request_id_uq" ON "sales_order" USING btree ("client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_external_origin_id_uq" ON "sales_order" USING btree ("external_origin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_draft_number_uq" ON "sales_order" USING btree ("draft_number");--> statement-breakpoint
CREATE INDEX "sales_order_customer_updated_idx" ON "sales_order" USING btree ("customer_code","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_status_updated_idx" ON "sales_order" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_created_by_updated_idx" ON "sales_order" USING btree ("created_by_account_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_updated_idx" ON "sales_order" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_seller_updated_idx" ON "sales_order" USING btree ("seller_code","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_config_version_id_idx" ON "sales_order" USING btree ("config_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_item_order_line_uq" ON "sales_order_item" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_item_product_code_idx" ON "sales_order_item" USING btree ("product_code");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_origin_id_uq" ON "integration_outbox" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "integration_outbox_due_idx" ON "integration_outbox" USING btree ("next_attempt_at","created_at") WHERE "integration_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "integration_outbox_aggregate_idx" ON "integration_outbox" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "integration_outbox_status_idx" ON "integration_outbox" USING btree ("status","updated_at" DESC NULLS LAST);