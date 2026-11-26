CREATE TABLE "cnpj_lookup_cache" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cnpj_lookup_cache_cnpj_chk" CHECK ("cnpj_lookup_cache"."cnpj" ~ '^[0-9]{14}$'),
	CONSTRAINT "cnpj_lookup_cache_source_chk" CHECK ("cnpj_lookup_cache"."source" in ('brasilapi', 'cnpjws'))
);
