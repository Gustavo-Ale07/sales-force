-- Least-privilege PostgreSQL roles for staging (owner decision 2026-10-02; DATA-2, STACK-2, P-21).
--
-- Roles (all LOGIN, NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT, no membership in each other):
--   force_migrator  DDL and migrations (`db:migrate`), pg-boss schema install (`queue:install`). OWNS every schema
--                   object. Used by the one-shot jobs only, never by a long-running service.
--   force_api       Runtime of the API process (and the operator account CLI that runs in the api container).
--   force_worker    Runtime of the Worker process (mirror sync, heartbeat, pg-boss) and `sync-once`.
-- No role here is a superuser and no credential is shared between services. The admin who runs this file
-- (CREATEROLE + ability to GRANT on the database) is not one of the three and must not be used by any service.
--
-- USAGE (idempotent: safe to re-run before the first migration, after any migration and after queue:install).
-- Passwords are supplied at run time and are NOT in this file. psql substitutes them as quoted literals:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v migrator_password="$MIGRATOR_PW" -v api_password="$API_PW" -v worker_password="$WORKER_PW" \
--        -f deploy/staging/db-roles.sql
--   (a pre-hashed SCRAM verifier, `SCRAM-SHA-256$...`, is accepted as the value and keeps the clear password out of
--    server statement logs; a missing variable stops the script before anything is changed.)
-- Optional: -v adopt_existing=on  re-owns objects of an already populated database (created earlier by another
--   role, e.g. the compose POSTGRES_USER) to force_migrator. Run it once, deliberately, after a backup; it changes
--   owners only, it drops and rewrites nothing.
--
-- ORDER OF A DEPLOY: 1 this file -> 2 migrate (as force_migrator) -> 3 queue:install (as force_migrator) -> 4 start
--   api and worker (as force_api / force_worker). Re-running step 1 after 2 and 3 is optional (default privileges
--   already cover what the migrator creates in `pgboss`); it is required after a migration that adds a TABLE to
--   `public` (see "New tables" below).
--
-- PRIVILEGE MATRIX, schema `public` (derived from what apps/server does today; S select, I insert, U update, D delete)
--   table                                 force_api   force_worker   evidence
--   account                               S I U       -              iam/account.repository (create, rehash, status), session join, demo-accounts check; account CLI
--   session                               S I U D     -              iam/session.repository
--   account_seller_link                   S I U       -              account.repository (upsert); account CLI
--   auth_throttle                         S I U D     -              iam/throttle.repository (clear on success/unlock, purge)
--   audit_log                             I           -              iam/audit.service. Append-only: no S/U/D (never read by code)
--   installation_configuration_version    S           S              configuration.repository (read); worker mirror-scope. Writers: see UNDETERMINED 1
--   sync_state                            S           S I U          worker: sync-state, heartbeat. API reads (integration summary, /configuration)
--   erp_seller, erp_customer, erp_product,
--   erp_price_table, erp_price_table_version,
--   erp_list_price                        S           S I U          worker mirror-writer upserts + soft delete (no DELETE). API is read-only (mirror.repository)
--                                         + column UPDATE (synced_at) on erp_customer for force_api only: templates.repository takes
--                                           SELECT ... FOR SHARE on the customer row, and PostgreSQL requires an UPDATE privilege for any
--                                           row lock. Smallest grant that satisfies it; no other erp_* column is writable by the API.
--   sales_order                           S I U       -              orders.repository (status moves are UPDATEs)
--   sales_order_item                      S I U D     -              orders.repository (lines are replaced: DELETE + INSERT)
--   customer_order_template               S I U       -              templates.repository
--   customer_order_template_item          S I U D     -              templates.repository (items replaced)
--   integration_outbox                    -           -              no code reads or writes it yet. See UNDETERMINED 2
--   schema_migration                      S           -              packages/db readiness() for /ready. Written only by force_migrator
--   Everything else in `public` (future tables included): force_migrator only (deny by default).
--   Also: force_worker gets TEMPORARY on the database (the mirror writer keeps a session-temporary table of seen keys).
--   Neither api nor worker has CREATE on any schema, ownership of anything, TRUNCATE, REFERENCES or TRIGGER.
--
-- PRIVILEGE MATRIX, schema `pgboss` (pg-boss 12.x; only the worker runs pg-boss, the API has no queue code)
--   force_migrator: owner (queue:install creates the schema, tables, functions and one table per queue)
--   force_worker:   USAGE on the schema; SELECT, INSERT, UPDATE, DELETE on all tables (and, through default
--                   privileges, on every table the migrator creates later: partitions of new queues, schema upgrades);
--                   USAGE, SELECT on sequences; EXECUTE on functions. No CREATE on the schema, no TRUNCATE.
--   force_api:      nothing.
--   See UNDETERMINED 3 for the part of pg-boss maintenance that needs more than DML.
--
-- NEW TABLES: default privileges give api and worker NOTHING on new `public` tables on purpose. A migration that
--   adds a table must add its line to the matrix above and to the GRANT block below in the same change; until then
--   the services cannot touch it (fail closed). Adding columns, indexes, constraints and triggers to an existing
--   table needs no new grant.
--
-- UNDETERMINED (reported to the owner, not guessed):
--   1. Who writes installation_configuration_version in staging. Only the dev `seed` writes it (and it refuses
--      staging/production); the API only reads. Until a staging configuration-import path exists, load the snapshot
--      with force_migrator (or an admin session). If the API or worker is meant to write it, add INSERT, UPDATE here.
--   2. integration_outbox: no code path inserts or claims rows yet (ERP submission is disabled, SNK-4/S0). When the
--      API enqueues on order submit it will need INSERT (+ SELECT) and the worker SELECT, UPDATE for delivery; the
--      integration_outbox_order_gate trigger also reads sales_order as the invoking role (api has SELECT; the
--      worker would need SELECT on sales_order). Add those lines with the change that introduces the code.
--   3. pg-boss 12 maintenance (supervise) may issue DDL (queue_stats partitions, BAM index builds, partition
--      drops). With migrate=false/createSchema=false the worker only needs DML in the tests run so far; verify on
--      the staging pg-boss version after the first long run (apps/server restricted-roles test covers start,
--      work, schedule, heartbeat and graceful stop).
--   4. Backup/restore: ops-backup.sh and the restore check still use whatever DATABASE_URL they are given. A fifth
--      role (e.g. force_backup with pg_read_all_data, no write) is the least-privilege answer; not created here
--      because it was not requested.
--   5. Managed providers (V-04/V-15) may not allow GRANT CREATE ON DATABASE or REVOKE on the public schema from the
--      provided admin; validate this file on the provider before relying on it.

\set ON_ERROR_STOP on

\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-roles.sql: set -v migrator_password=... (a clear password or a SCRAM verifier)'; END $$;
\endif
\if :{?api_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-roles.sql: set -v api_password=... (a clear password or a SCRAM verifier)'; END $$;
\endif
\if :{?worker_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-roles.sql: set -v worker_password=... (a clear password or a SCRAM verifier)'; END $$;
\endif
\if :{?adopt_existing}
\else
  \set adopt_existing off
\endif

SELECT current_database() AS dbname \gset
SELECT set_config('sf.adopt_existing', :'adopt_existing', false) \gset

BEGIN;

-- 1. Roles. Created without a password inside the DO block (psql does not substitute variables inside $$ ...
--    $$); the password is set right after, outside it. Attributes are re-asserted on every run.
DO $roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['force_migrator', 'force_api', 'force_worker'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', r);
  END LOOP;
END
$roles$;

ALTER ROLE force_migrator PASSWORD :'migrator_password';
ALTER ROLE force_api PASSWORD :'api_password';
ALTER ROLE force_worker PASSWORD :'worker_password';

-- 2. Database level: nobody connects by default; only the three roles do. CREATE lets the migrator install
--    pg_trgm (a trusted extension) and the pgboss schema. TEMPORARY only for the worker.
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
REVOKE ALL ON DATABASE :"dbname" FROM force_api, force_worker, force_migrator;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE :"dbname" TO force_migrator;
GRANT CONNECT ON DATABASE :"dbname" TO force_api;
GRANT CONNECT, TEMPORARY ON DATABASE :"dbname" TO force_worker;

-- 3. Schemas. `public`: only USAGE for the runtime roles; the migrator may create. `pgboss` is created here,
--    owned by the migrator, so default privileges can be attached before pg-boss installs into it
--    (pg-boss uses CREATE SCHEMA IF NOT EXISTS).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM force_api, force_worker, force_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO force_migrator;
GRANT USAGE ON SCHEMA public TO force_api, force_worker;

CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION force_migrator;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
REVOKE ALL ON SCHEMA pgboss FROM force_api, force_worker;
GRANT USAGE ON SCHEMA pgboss TO force_worker;

-- 4. Optional adoption of objects created earlier by another role (see header). Owners only.
DO $adopt$
DECLARE o record;
BEGIN
  IF current_setting('sf.adopt_existing', true) IS DISTINCT FROM 'on' THEN
    RETURN;
  END IF;
  FOR o IN
    SELECT format('ALTER %s %s OWNER TO force_migrator',
                  CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
                  c.oid::regclass) AS cmd
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'pgboss') AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
       AND pg_get_userbyid(c.relowner) <> 'force_migrator'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a'))
    UNION ALL
    SELECT format('ALTER %s %s OWNER TO force_migrator', CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.oid::regprocedure)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'pgboss') AND p.prokind IN ('f', 'p')
       AND pg_get_userbyid(p.proowner) <> 'force_migrator'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE o.cmd;
  END LOOP;
END
$adopt$;

-- 5. Reset, then grant exactly the matrix (idempotent). Resetting revokes anything granted by hand since.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM force_api, force_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, force_api, force_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC, force_api, force_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgboss FROM PUBLIC, force_api, force_worker;

-- public: the matrix, as data. A table that does not exist yet (this file run before the first migration) is
-- skipped; re-running the file after the migrations grants it.
DO $grants$
DECLARE g record;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('account',                            'force_api',    'SELECT, INSERT, UPDATE'),
      ('account_seller_link',                'force_api',    'SELECT, INSERT, UPDATE'),
      ('session',                            'force_api',    'SELECT, INSERT, UPDATE, DELETE'),
      ('auth_throttle',                      'force_api',    'SELECT, INSERT, UPDATE, DELETE'),
      ('sales_order_item',                   'force_api',    'SELECT, INSERT, UPDATE, DELETE'),
      ('customer_order_template_item',       'force_api',    'SELECT, INSERT, UPDATE, DELETE'),
      ('sales_order',                        'force_api',    'SELECT, INSERT, UPDATE'),
      ('customer_order_template',            'force_api',    'SELECT, INSERT, UPDATE'),
      ('audit_log',                          'force_api',    'INSERT'),
      ('installation_configuration_version', 'force_api',    'SELECT'),
      ('sync_state',                         'force_api',    'SELECT'),
      ('schema_migration',                   'force_api',    'SELECT'),
      ('erp_seller',                         'force_api',    'SELECT'),
      ('erp_customer',                       'force_api',    'SELECT'),
      ('erp_product',                        'force_api',    'SELECT'),
      ('erp_price_table',                    'force_api',    'SELECT'),
      ('erp_price_table_version',            'force_api',    'SELECT'),
      ('erp_list_price',                     'force_api',    'SELECT'),
      ('installation_configuration_version', 'force_worker', 'SELECT'),
      ('sync_state',                         'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_seller',                         'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_customer',                       'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_product',                        'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_price_table',                    'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_price_table_version',            'force_worker', 'SELECT, INSERT, UPDATE'),
      ('erp_list_price',                     'force_worker', 'SELECT, INSERT, UPDATE')
    ) AS m(tbl, grantee, privs)
  LOOP
    IF to_regclass(format('public.%I', g.tbl)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO %I', g.privs, g.tbl, g.grantee);
    END IF;
  END LOOP;
END
$grants$;

DO $lock$
BEGIN
  IF to_regclass('public.erp_customer') IS NOT NULL THEN
    GRANT UPDATE (synced_at) ON public.erp_customer TO force_api;
  END IF;
END
$lock$;

-- pgboss: force_worker (objects that exist now; later ones by default privileges below)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO force_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO force_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO force_worker;

-- 6. Default privileges for what force_migrator creates later.
--    public: none for api/worker (deny by default, see NEW TABLES); previous defaults are cleared.
ALTER DEFAULT PRIVILEGES FOR ROLE force_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM force_api, force_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE force_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM force_api, force_worker;
--    pgboss: everything the migrator installs there is the worker's to use (DML only).
ALTER DEFAULT PRIVILEGES FOR ROLE force_migrator IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO force_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE force_migrator IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO force_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE force_migrator IN SCHEMA pgboss GRANT EXECUTE ON FUNCTIONS TO force_worker;
--    Functions and types: PostgreSQL's default (EXECUTE/USAGE to PUBLIC) is kept: the trigger and pgboss
--    functions are harmless without table privileges.

COMMIT;
