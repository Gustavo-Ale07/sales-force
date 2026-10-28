-- Read-only trace of the SUP login attempt on STAGING (owner-run on the VPS; no writes).
-- Works on the release currently deployed (8cfb3b1): uses only audit_log, account, account_seller_link.
-- Output: timestamps, reason codes, role/status, booleans/counts. Never emails, hashes, tokens, external ids or passwords.
--   docker compose exec -T postgres psql -U <owner_role> -d <db> -v ON_ERROR_STOP=1 -f staging-sup-login-trace.sql

\echo '== A. Last 15 login audit rows (success, failure with internal reason, link mismatch, notices) =='
select at, action, detail->>'reason' as reason, detail->>'method' as method, (actor_account_id is not null) as has_account
from audit_log
where action like 'auth.login%' or action like 'auth.session%'
order by at desc limit 15;

\echo '== B. Failures by internal reason, last 24 h =='
select detail->>'reason' as reason, count(*) as n, max(at) as last_at
from audit_log where action = 'auth.login.failure' and at > now() - interval '24 hours'
group by 1 order by last_at desc;

\echo '== C. SUP account shape (no ids): role/status/external link/local hash/seller links =='
select a.role, a.status, (a.external_user_id is not null) as has_external_link,
       (a.password_hash is not null) as has_local_password,
       (select count(*) from account_seller_link l where l.account_id = a.id) as seller_links
from account a
where a.external_user_id is not null or a.role in ('manager', 'admin')
order by a.role;
