#!/bin/bash
# Release completa do staging em um comando, executada NA VPS como force-deploy:
#   ssh plac-vps 'sudo -n -u force-deploy bash -s -- <sha>' < deploy/scripts/staging-release.sh
# Substitui a copia manual de release*.sh com troca de SHA. Nunca toca a producao.
set -u
SHA="${1:?uso: staging-release.sh <sha-completo>}"
case "$SHA" in *[!0-9a-f]*) echo "SHA invalido"; exit 2 ;; esac
cd /opt/force-staging/repo || exit 1
SF_RUN_DB_ROLES=1 deploy/scripts/deploy-staging.sh "$SHA" < /dev/null || { echo "DEPLOY FALHOU"; exit 1; }
deploy/scripts/sf-compose.sh -f /opt/force-staging/config/compose.write-sandbox.yml up -d --no-deps --force-recreate api worker < /dev/null
sleep 20
deploy/scripts/sf-compose.sh -f /opt/force-staging/config/compose.write-live.yml up -d --no-deps --force-recreate worker < /dev/null
sleep 25
curl -s -o /dev/null -w "ready=%{http_code}\n" https://force.sistemasplac.com.br/api/v1/ready
deploy/scripts/deploy-staging.sh --print-deployed-sha
deploy/scripts/sf-compose.sh exec -T worker env < /dev/null | grep -E "^SANKHYA_(ORDER_WRITE|ENVIRONMENT)"
deploy/scripts/sf-compose.sh exec -T worker node dist/cli/consistency-verify.js < /dev/null 2>&1 | grep -E "^totals"
