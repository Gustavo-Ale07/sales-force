# Central de downloads e atualização do app (etapa B)

Status: implementação local; **nada foi implantado nem publicado em servidor**. O volume e o `location` do nginx estão no repositório (entram em vigor no próximo deploy); a pasta do host e a cópia dos arquivos são passos manuais do dono.

## Peças

| Peça | Onde | Função |
|---|---|---|
| Página `/downloads` | `apps/web/src/routes/downloads.tsx` | Pública (abre no celular sem login). Lista as versões publicadas, com versão, tamanho, SHA-256 e botão de download. |
| Lista configurável | `<pasta>/downloads.json` | Dirigida por configuração; o código não tem versão nem arquivo fixos. Validada em `apps/web/src/lib/downloads.ts` (nome de arquivo plano `.apk`, SHA-256 em hexadecimal; entrada inválida é descartada). |
| Versão mais nova por canal | `<pasta>/latest-<canal>.json` | Lido pelo app: `versionCode`, `minVersionCode`, `file`, `sha256`, `sizeBytes`. |
| Publicação | `scripts/publish-android.mjs` | Copia o APK, calcula SHA-256 e tamanho, grava os dois JSON de forma atômica. Um `versionCode` publicado é imutável. |
| Menu e login | `nav-items.ts`, `login.tsx` | Item "Aplicativo" (perfis comerciais) e link "Baixar o aplicativo Android" no login. |

## Fluxo de publicação ponta a ponta

Endereço do ambiente: `https://force.sistemasplac.com.br`. Os arquivos ficam em `https://force.sistemasplac.com.br/downloads-files/` e a página para o usuário é `https://force.sistemasplac.com.br/downloads`.

1. **Baixar o APK do EAS** no PC do dono (painel do EAS, build do perfil `staging`). Anotar `versionName` e `versionCode` do build.
2. **Gerar os arquivos de publicação** no PC do dono, na raiz do repositório:
   ```
   node scripts/publish-android.mjs --apk <arquivo.apk> --version-name 0.1.0 --version-code 12 --min-version-code 10 --channel staging --out <pasta-local>
   ```
   Grava na `<pasta-local>`: `force-staging-12.apk`, `downloads.json` e `latest-staging.json` (SHA-256 e tamanho reais). `--min-version-code` é a versão mínima aceita (apps abaixo dela são obrigados a atualizar). **O script recusa `--min-version-code` maior que `--version-code`** (nunca bloqueia todos os aparelhos) e não escreve nada nesse caso. Um `versionCode` já publicado com conteúdo diferente também é recusado.
3. **Copiar para a VPS** (duas etapas: a conta de login não escreve em `/opt`):
   ```
   ssh <usuario>@<vps> "mkdir -p ~/force-downloads"
   scp <pasta-local>/* <usuario>@<vps>:force-downloads/
   ssh <usuario>@<vps>
   sudo cp ~/force-downloads/force-staging-12.apk /opt/force-staging/downloads/
   sudo cp ~/force-downloads/downloads.json ~/force-downloads/latest-staging.json /opt/force-staging/downloads/
   sudo chmod 644 /opt/force-staging/downloads/*
   rm -r ~/force-downloads
   ```
   Copie o APK **antes** dos dois JSON, para o manifesto nunca apontar para um arquivo ainda ausente.
4. **Testar** (lista abaixo).

Só a **primeira vez** (quando o volume e o `location` do nginx entram no deploy) é preciso recriar o `web` depois do deploy: `deploy/scripts/sf-compose.sh up -d --no-deps --force-recreate web`. Novas versões de APK/JSON **não** exigem reinício: é só copiar os arquivos.

### Preparar a pasta na VPS (uma vez)

```
sudo mkdir -p /opt/force-staging/downloads
sudo chmod 755 /opt/force-staging /opt/force-staging/downloads
```

Pasta e arquivos precisam ser legíveis por todos (755/644): o nginx do `web` roda sem privilégios.

## O que está no repositório

- **Volume** em `deploy/docker-compose.staging.yml` (o compose que `deploy/scripts/lib-deploy.sh` e `sf-compose.sh` usam; o `external-edge` só sobrepõe a borda), serviço `web`:
  ```
  volumes:
    - /opt/force-staging/downloads:/usr/share/nginx/downloads-files:ro
  ```
  É um bind mount fora da imagem: sobrevive a todo deploy e a `--force-recreate`. A pasta precisa existir no host antes do `up`.
- **nginx** em `deploy/nginx/default.conf`: `location = /downloads-files/` devolve 404 (a pasta em si), e `location /downloads-files/` usa `root /usr/share/nginx;` (não `alias`), sem `try_files`, `autoindex off`, `disable_symlinks on`, `limit_except GET HEAD { deny all; }` (outros métodos: 403), tipos `apk` e `json`, `Cache-Control: public, max-age=60`, `nosniff` e os cabeçalhos de segurança do servidor repetidos (o `add_header` de um `location` apaga os herdados): CSP `default-src 'none'; sandbox; frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`.
- O Caddy (`deploy/staging/Caddyfile`) só repassa ao `web`; nada muda nele.

## Sem colisão e CSP

- `/downloads` é a rota da SPA (cai no `location /`); `/downloads-files/...` exige o prefixo completo com a barra e cai no `location` próprio. O prefixo `/downloads-files/` não casa com `/downloads`, e `/downloads` não casa com o prefixo.
- A página usa `fetch` à mesma origem (`/downloads-files/downloads.json`), coberto por `connect-src 'self'`; o botão do APK é uma navegação/download de link, que a CSP não restringe. O app lê `latest-staging.json` pela origem da API, que é a mesma do web. A CSP do web não mudou.
- `apps/web/src/csp.test.ts` continua verde (a CSP dos arquivos de download não declara `script-src`, então não entra no teste de política da aplicação).

## Testes com curl (após o deploy e a cópia dos arquivos)

```
H=https://force.sistemasplac.com.br
curl -sI $H/downloads-files/downloads.json       # esperado: 200, content-type: application/json
curl -sI $H/downloads-files/latest-staging.json  # esperado: 200, content-type: application/json
curl -sI $H/downloads-files/force-staging-12.apk # esperado: 200, content-type: application/vnd.android.package-archive
curl -sI $H/downloads-files/                      # esperado: 404 (a pasta nunca é listada)
curl -sI -X POST $H/downloads-files/downloads.json # esperado: 403
curl -sI $H/downloads-files/nao-existe.apk        # esperado: 404
curl -sI $H/downloads                             # esperado: 200, content-type: text/html (SPA)
```

Conferir também, em `-I` de qualquer um dos três arquivos, `cache-control: public, max-age=60` e `x-content-type-options: nosniff`.

## Desfazer

1. Retirar uma versão: apagar o APK da pasta e republicar `downloads.json`/`latest-<canal>.json` anteriores (ou restaurar a cópia). Ajustar `minVersionCode` para baixo se uma versão obrigatória estiver errada.
2. Desligar o recurso: reverter o commit do volume e do `location` e recriar o `web`; a pasta do host pode ficar (não é usada).

## Camada 1: atualização de código JavaScript (expo-updates)

Configuração em `apps/mobile/app-variant.js` (só a variante `staging`; `development` fica intacta) e `eas.json`: `runtimeVersion` com política `fingerprint`, plugin `expo-updates`, verificação `ON_LOAD` com `fallbackToCacheTimeout` 0 (nunca bloqueia o início) e cabeçalho de canal `expo-channel-name: staging`; `eas.json` declara `channel` por perfil (`development`, `staging`). Não existe variante `production` (decisão pendente do dono). A URL do servidor de atualizações vem da variável de build `EXPO_UPDATES_URL` (https); **sem ela as atualizações ficam desligadas** (falha fechada) e nada é commitado. `eas build` e `eas update` **não** foram executados.

## Camada 2: atualização do APK dentro do app

Lógica em `apps/mobile/src/update/apk-update.ts` (pura e testada): lê `latest-<canal>.json` da origem da API, compara `versionCode` instalado, exige atualização se abaixo de `minVersionCode`, baixa o APK, confere o SHA-256 e o tamanho **antes** de pedir a instalação e só abre o instalador do Android com o arquivo verificado (divergência apaga o arquivo). SHA-256 incremental em `sha256.ts` (o arquivo nunca fica inteiro na memória). Adaptadores nativos em `apk-update-io.ts` (expo-file-system, expo-intent-launcher, expo-application); textos em `update-messages.ts`. Disparo: botão "Verificar atualização" em Perfil, só em build `staging` com origem https. Permissão `REQUEST_INSTALL_PACKAGES` declarada só na variante `staging`.

**Não validado em aparelho:** os adaptadores nativos (download, leitura em blocos, `contentUri`, abertura do instalador) só podem ser exercitados num APK real; a lógica e a configuração têm testes automáticos. **Checagem na abertura (B2):** `UpdateGate` (em `App.tsx`) mostra o app de imediato e consulta `latest-<canal>.json` em segundo plano, com limite de 8 s (`startup-check.ts`). Sem rede, tempo esgotado, JSON inválido ou qualquer erro: o app segue normal (offline continua funcionando). Só um manifesto válido com `versionCode` instalado abaixo de `minVersionCode` troca o app pela tela bloqueante "Atualização obrigatória" (`required-update-screen.tsx`), com o botão "Baixar e instalar"; a tela só some depois de instalar a nova versão. Limite: se o aparelho estiver offline na abertura, a obrigatoriedade não é aplicada naquela abertura.

## Registro de impacto de segurança

- Download público apenas de arquivos já publicados; nenhuma rota nova lê dados de usuário. A página não recebe custo, margem nem dado comercial.
- Integridade: SHA-256 publicado no JSON e conferido no app antes de instalar; nome de arquivo restrito (`^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$`), sem caminho; URL sempre da mesma origem da API (HTTPS).
- Limite conhecido: o SHA-256 e o APK vêm do mesmo servidor; ele protege contra download corrompido e troca parcial, **não** contra um servidor comprometido. A assinatura do APK pela chave de release (checada pelo Android na atualização) é a defesa contra APK adulterado. Chave de assinatura nunca vai ao repositório.
- `REQUEST_INSTALL_PACKAGES` amplia a superfície do app: só é usada pela atualização, e o Android pede a permissão "instalar apps desconhecidos" ao usuário.
- Pendência de decisão do dono: guardar os artefatos fora do web (bucket) e conta de loja (MOB-3); hoje é distribuição interna.
