# Checkpoint 2026-11-04 — comporta de escrita por ambiente de implantação (I1/I2)

Fato (staging, 13:50 BRT): com o dry-run ligado pelo override, a API recusou subir em laço: "ERP_ORDER_ENQUEUE_ENABLED: is refused when NODE_ENV=production". O staging roda `NODE_ENV=production` por desenho; a comporta estava na variável errada.

## I1
- Nova variável `SF_DEPLOY_ENVIRONMENT=staging|production`, obrigatória na partida (API e worker) quando `NODE_ENV=production`; vazia ou desconhecida = recusa. Em desenvolvimento/testes, ausente mantém o comportamento anterior.
- API (`apps/server/src/config/api-env.ts`): `ERP_ORDER_ENQUEUE_ENABLED=true` só com `staging`; com `production` recusa, qualquer que seja o `NODE_ENV`.
- Worker (`packages/sankhya/src/write/order-write-config.ts`): qualquer modo ligado exige `staging`; SOMA-SE às comportas do modo live (host do Sandbox, `SANKHYA_ENVIRONMENT=sandbox`, `GATES_CLOSED=1`, campo de origem). A recusa antiga de live por `NODE_ENV=production` virou recusa por `SF_DEPLOY_ENVIRONMENT=production` (senão o live seria impossível no staging). Nada afrouxado.
- `deploy/docker-compose.staging.yml` passa `SF_DEPLOY_ENVIRONMENT: staging` à API e ao worker. O compose de produção (quando existir) passa `production`.

## I2
- `docs/implementation/snk-7-dry-run.md` §5.1 e `deploy/README-staging.md`: conteúdo exato do override `/opt/force-staging/config/compose.write-sandbox.yml` (bloco dry_run e bloco live), comando `sf-compose.sh -f ... up -d --no-deps --force-recreate api worker`, e aviso de que deploy/rollback/sf-compose sem `-f` desliga tudo.

## Só o dono roda
1. Criar `/opt/force-staging/config/compose.write-sandbox.yml` no servidor (bloco dry_run do §5.1).
2. Deploy da nova versão (sem o override o dry-run fica desligado).
3. Recriar api e worker com `-f` conforme §5.1.
