CREATE TABLE "server_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by_account_id" uuid,
	CONSTRAINT "server_code_hash_chk" CHECK ("server_code"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "server_code" ADD CONSTRAINT "server_code_rotated_by_account_id_account_id_fk" FOREIGN KEY ("rotated_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_code_single_uidx" ON "server_code" USING btree ((true));