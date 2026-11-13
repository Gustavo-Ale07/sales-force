CREATE TABLE "customer_registration_refusal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_registration_refusal_reason_chk" CHECK ("customer_registration_refusal"."reason" in ('document_already_registered'))
);
--> statement-breakpoint
ALTER TABLE "customer_registration_refusal" ADD CONSTRAINT "customer_registration_refusal_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_registration_refusal_account_created_idx" ON "customer_registration_refusal" USING btree ("account_id","created_at" DESC NULLS LAST);