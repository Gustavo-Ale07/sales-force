-- Read-only diagnosis of refused Sankhya logins on STAGING (owner-run; no writes, no secrets, no PII).
-- Run on the staging host, for example:
--   docker compose exec -T postgres psql -U <owner_role> -d <db> -v ON_ERROR_STOP=1 -f staging-login-diagnosis.sql
-- Sections 2, 5 and 6 need the release with migration 0011; on the current staging use \set ON_ERROR_STOP 0 or run only 1, 3 and 4.
-- Output: only timestamps, audit actions and reason codes. It never selects emails, handles, hashes or tokens.

\echo '== 1. Login failures by reason (last 7 days) =='
select detail->>'reason' as reason, count(*) as n, min(at) as first_at, max(at) as last_at
from audit_log
where action = 'auth.login.failure' and at > now() - interval '7 days'
group by 1 order by n desc;

\echo '== 2. Directory (automatic link) refusals / revocations, last 7 days =='
select at, action, detail->>'reason' as reason, detail->>'userCode' as user_code, detail->>'sellerCode' as seller_code
from audit_log
where action in ('auth.directory.link_refused', 'auth.directory.link_revoked') and at > now() - interval '7 days'
order by at desc limit 50;

\echo '== 3. Most recent 20 failures (time and reason only) =='
select at, detail->>'reason' as reason
from audit_log where action = 'auth.login.failure' order by at desc limit 20;

\echo '== 4. Accounts tied to the directory (counts only) =='
select role, status, count(*) filter (where external_user_id is not null) as external, count(*) as total from account group by 1, 2 order by 1, 2;

\echo '== 5. Seller links by source =='
select source, count(*) from account_seller_link group by 1;

\echo '== 6. Mirror of the user -> seller relation =='
select (select count(*) from erp_directory_user where deleted_at is null) as users_mirrored,
       (select count(*) from erp_directory_user where deleted_at is null and seller_code is not null) as with_seller,
       (select last_success_at from sync_state where entity = 'directoryUsers') as last_success_at;
