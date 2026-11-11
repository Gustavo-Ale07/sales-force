# Central de downloads e atualização do app (etapa B)

Status: implementação local; **nada foi publicado nem implantado**. Os trechos de nginx, Caddy e compose abaixo são **instruções** para o dono aplicar; nenhum arquivo de compose, `compose.env*` ou flag foi alterado.

## Peças

| Peça | Onde | Função |
|---|---|---|
| Página `/downloads` | `apps/web/src/routes/downloads.tsx` | Pública (abre no celular sem login). Lista as versões publicadas, com versão, tamanho, SHA-256 e botão de download. |
| Lista configurável | `<pasta>/downloads.json` | Dirigida por configuração; o código não tem versão nem arquivo fixos. Validada em `apps/web/src/lib/downloads.ts` (nome de arquivo plano `.apk`, SHA-256 em hexadecimal; entrada inválida é descartada). |
| Versão mais nova por canal | `<pasta>/latest-<canal>.json` | Lido pelo app: `versionCode`, `minVersionCode`, `file`, `sha256`, `sizeBytes`. |
| Publicação | `scripts/publish-android.mjs` | Copia o APK, calcula SHA-256 e tamanho, grava os dois JSON de forma atômica. Um `versionCode` publicado é imutável. |
| Menu e login | `nav-items.ts`, `login.tsx` | Item "Aplicativo" (perfis comerciais) e link "Baixar o aplicativo Android" no login. |

## Publicar uma versão (na máquina do dono, depois do build)

```
node scripts/publish-android.mjs --apk <arquivo.apk> --version-name 0.1.0 --version-code 12 --min-version-code 10 --channel staging --out <pasta-servida>
```

`--min-version-code` é a versão mínima aceita: apps abaixo dela são obrigados a atualizar. Teste: `node --test scripts/publish-android.test.mjs`.

## Servir a pasta (instrução, não aplicada)

A pasta publicada deve ser servida em `/downloads-files/` na mesma origem do web (a CSP do web não precisa mudar: tudo é `'self'`). Montar a pasta como volume somente leitura no serviço `web` (no compose de staging, sob decisão do dono) e adicionar ao nginx do web:

```
location /downloads-files/ {
    alias /usr/share/nginx/downloads/;
    types { application/vnd.android.package-archive apk; application/json json; }
    default_type application/octet-stream;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Security-Policy "default-src 'none'; sandbox" always;
    try_files $uri =404;
}
```

Com Caddy na frente, nada muda (ele só repassa ao web). Exemplo de volume (compose, instrução):

```
  web:
    volumes:
      - /opt/force-staging/downloads:/usr/share/nginx/downloads:ro
```

Observação: `/downloads` (sem sufixo) é a rota da SPA; os arquivos ficam em `/downloads-files/` para não colidir.

## Camada 1: atualização de código JavaScript (expo-updates)

Configuração em `apps/mobile/app-variant.js` (só a variante `staging`; `development` fica intacta) e `eas.json`: `runtimeVersion` com política `fingerprint`, plugin `expo-updates`, verificação `ON_LOAD` com `fallbackToCacheTimeout` 0 (nunca bloqueia o início) e cabeçalho de canal `expo-channel-name: staging`; `eas.json` declara `channel` por perfil (`development`, `staging`). Não existe variante `production` (decisão pendente do dono). A URL do servidor de atualizações vem da variável de build `EXPO_UPDATES_URL` (https); **sem ela as atualizações ficam desligadas** (falha fechada) e nada é commitado. `eas build` e `eas update` **não** foram executados.

## Camada 2: atualização do APK dentro do app

Lógica em `apps/mobile/src/update/apk-update.ts` (pura e testada): lê `latest-<canal>.json` da origem da API, compara `versionCode` instalado, exige atualização se abaixo de `minVersionCode`, baixa o APK, confere o SHA-256 e o tamanho **antes** de pedir a instalação e só abre o instalador do Android com o arquivo verificado (divergência apaga o arquivo). SHA-256 incremental em `sha256.ts` (o arquivo nunca fica inteiro na memória). Adaptadores nativos em `apk-update-io.ts` (expo-file-system, expo-intent-launcher, expo-application); textos em `update-messages.ts`. Disparo: botão "Verificar atualização" em Perfil, só em build `staging` com origem https. Permissão `REQUEST_INSTALL_PACKAGES` declarada só na variante `staging`.

**Não validado em aparelho:** os adaptadores nativos (download, leitura em blocos, `contentUri`, abertura do instalador) só podem ser exercitados num APK real; a lógica e a configuração têm testes automáticos. **Fora desta etapa:** bloqueio de uso quando a versão está abaixo de `minVersionCode` (hoje o app informa e baixa ao pedido; a decisão `required` já existe na lógica) e checagem automática na abertura.

## Registro de impacto de segurança

- Download público apenas de arquivos já publicados; nenhuma rota nova lê dados de usuário. A página não recebe custo, margem nem dado comercial.
- Integridade: SHA-256 publicado no JSON e conferido no app antes de instalar; nome de arquivo restrito (`^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$`), sem caminho; URL sempre da mesma origem da API (HTTPS).
- Limite conhecido: o SHA-256 e o APK vêm do mesmo servidor; ele protege contra download corrompido e troca parcial, **não** contra um servidor comprometido. A assinatura do APK pela chave de release (checada pelo Android na atualização) é a defesa contra APK adulterado. Chave de assinatura nunca vai ao repositório.
- `REQUEST_INSTALL_PACKAGES` amplia a superfície do app: só é usada pela atualização, e o Android pede a permissão "instalar apps desconhecidos" ao usuário.
- Pendência de decisão do dono: guardar os artefatos fora do web (bucket) e conta de loja (MOB-3); hoje é distribuição interna.
