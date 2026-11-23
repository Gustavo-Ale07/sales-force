CREATE TABLE "account_photo" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"size_px" integer NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_photo_content_type_chk" CHECK ("account_photo"."content_type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "account_photo_byte_length_chk" CHECK ("account_photo"."byte_length" > 0),
	CONSTRAINT "account_photo_size_px_chk" CHECK ("account_photo"."size_px" > 0),
	CONSTRAINT "account_photo_content_hash_chk" CHECK ("account_photo"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "account_photo" ADD CONSTRAINT "account_photo_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;