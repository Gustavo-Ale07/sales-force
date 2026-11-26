CREATE TABLE "erp_postal_code" (
	"cep" integer PRIMARY KEY NOT NULL,
	"city_code" integer NOT NULL,
	"neighborhood_code" integer NOT NULL,
	"street_code" integer NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
