# Sankhya Spike — Findings and Open Questions

**Responsibility of this file:** the record of what is **validated** about the company's Sankhya environment, which project decisions constrain the integration, and what still **needs validation**.

**Last updated:** 2026-09-18 (S3 controlled Sandbox order session recorded: F-44–F-52, §9.38–§9.40)

---

## 0. Rules for this document

1. Nothing about Sankhya behavior is assumed. A fact is recorded as VALIDATED only with evidence (documentation link, recorded sanitized response, or dated observation in the company's environment).
2. Documentation-level evidence is weaker than environment evidence. Such facts are marked "VALIDATED (docs)" and must be confirmed in the company's environment.
3. Table names are candidates, not API behavior. A table name alone never defines how the integration works.
4. TOP, company code, price rules, service names, mandatory fields, goal/commission sources are **never** invented. Unknown items stay NEEDS VALIDATION and block the features that depend on them.
5. Raw captures containing real data go to `.sankhya-raw/` (git-ignored) and are never committed. Only sanitized fixtures are committed (§6).

### Status values

| Status | Meaning |
|---|---|
| VALIDATED (env) | Observed in the company's Sankhya environment, with evidence |
| VALIDATED (docs) | Stated in official Sankhya documentation; confirm in the environment |
| NEEDS VALIDATION | Not yet validated — never presented as fact |
| HYPOTHESIS | An unproven explanation for a validated observation; never implemented as a rule |
| ARCHITECTURAL DECISION INPUT | A recommendation derived from validated observations, offered to the owner/architect; not itself an approved decision until recorded in `decisions.md` |

Project decisions about the integration are not Sankhya facts; their status (APPROVED / PROPOSED / UNDECIDED) comes from `decisions.md`.

---

## 1. Project decisions that constrain the spike

| Ref | Status | Topic | Detail |
|---|---|---|---|
| P-03 | APPROVED | Boundary | Web and mobile never communicate with Sankhya; Sankhya-specific implementation isolated behind `packages/sankhya` / `SankhyaGateway` |
| SNK-3 | APPROVED | Staging and development environment | Homologation if it exists; otherwise staging and local development use the fake gateway with sanitized fixtures (CI always fake); isolated real non-production environment added before the pilot if available; **pilot gate:** one real order write and one real partner write validated end-to-end outside production, otherwise a new decision (U-04); staging never connects to production; no production data in staging without approved sanitization; production as an environment strategy — including read-only — **REJECTED** |
| SNK-3 exception | APPROVED | Read-only production diagnostic inspection during a spike (U-03) | Only with owner authorization for that occasion and all conditions in `security-model.md` §10.1 (no adequate test environment, no writes, read-only credentials where possible, minimum data, no unnecessary copies, sanitized persistence, no credentials in Git, staging never connected, logged in §8). Exceptional diagnostic mechanism, not an environment strategy; never a substitute for the pilot write validation |
| SNK-4 | APPROVED | Write idempotency | Custom origin-id field(s) holding the Sales Force entity UUID of the order or account, checked before any retry (required); native idempotency in addition if S0 confirms it; heuristic primary matching **REJECTED**; observation field only as emergency fallback — owner authorization per incident, only records created while the custom field is unavailable (U-05…U-07); validated in S0 before any real order write |
| SNK-1 | PROPOSED | Integration boundary detail | Writes only via `integration_outbox` + worker; user reads from the mirror; synchronous API calls only from an allowlist (empty); Sankhya formats stay in `packages/sankhya` |
| SNK-2 | PROPOSED | Authentication | OAuth 2.0 client credentials + `X-Token` (F-01, docs level); legacy appkey/token not implemented; API per operation chosen by S1 |
| DATA-3 | PROPOSED | Mirror identifiers | Deterministic UUIDv5 from the Sankhya natural key; unique constraint on the natural key |
| SYNC-2 | PROPOSED | Mirror writes | Upsert only when content hash changed |

---

## 2. Validated facts

| ID | Fact | Status | Evidence | Confirm in environment |
|---|---|---|---|---|
| F-01 | The Sankhya API gateway authenticates with OAuth 2.0 client credentials: `client_id` and `client_secret` (Developer area) plus `X-Token` (Gateway settings screen in Sankhya Om). This replaces the appkey + token model. The response returns a bearer access token with an expiry. | VALIDATED (docs) | [Authentication reference](https://developer.sankhya.com.br/reference/post_authenticate) · [Changelog: new OAuth flow](https://developer.sankhya.com.br/changelog/novo-fluxo-de-autenticacao-com-oauth-20) · [How to obtain credentials](https://ajuda.sankhya.com.br/hc/pt-br/articles/39368763917463-Como-obter-as-credenciais-necess%C3%A1rias-para-integra%C3%A7%C3%A3o-via-API-Gateway) | Token lifetime in our environment; credential issuance for staging vs production |
| F-02 | F-01's OAuth 2.0 `client_credentials` + `X-Token` flow confirmed working against the Sandbox environment; an authentication attempt with Sandbox credentials against the production authentication endpoint was rejected (recorded by the previous spike session; a credential-only contact with production, no data, not logged in §8 — flagged for owner acknowledgement under SNK-3) | VALIDATED (env) | §9.1 | Token lifetime and issuance once staging/production credentials exist |
| F-03 | Sandbox access token `expires_in = 300` (~5 min); an expired token can produce HTTP 403; calls resume normally after renewing the bearer token | VALIDATED (env) | §9.1 | Confirm token lifetime is uniform across environments |
| F-04 | MGE gateway endpoint `.../gateway/v1/mge/service.sbr` reachable; `CRUDServiceProvider.loadRecords` and `DbExplorerSP.executeQuery` both respond for the Sandbox technical user used in this spike | VALIDATED (env) | §9.2 | Confirm the same services are permitted for the eventual integration user/profile |
| F-05 | `Parceiro` entity readable; fields CODPARC, CNPJ, CODVEND, ATIVO confirmed present | VALIDATED (env) | §9.3 | Bulk/incremental read and deletion detection (S1.2, S1.3) |
| F-06 | `Produto` entity readable; fields CODPROD, DESCRPROD, ATIVO, CODGRUPOPROD, CODVOL confirmed present | VALIDATED (env) | §9.4 | Bulk/incremental read and deletion detection (S1.2, S1.3) |
| F-07 | `GET /v1/precos/produto/{codprod}/tabela/{codtab}` returns a price for a product/table pair (value, unit, stock-location code `codigoLocalEstoque` — a location code, not a stock quantity; wording corrected in the S1 session, §9.31 —, controle); this validates the price-table query but does not by itself prove it is always the final transactional price of an order | VALIDATED (env) | §9.5 | S2.1, S2.2 — transactional price resolution rule |
| F-08 | `GET /v1/vendedores/{codvend}` returns seller fields (code, name, active, company, linked partner, manager) | VALIDATED (env) | §9.6 | Bulk/incremental read (S1.2) |
| F-09 | `CabecalhoNota` query returns order/invoice header fields (NUNOTA, NUMNOTA, CODPARC, CODVEND, TOP, TIPMOV, VLRNOTA, STATUSNOTA, PENDENTE); the general meaning of `STATUSNOTA`/`TIPMOV` values is NOT established from this small sample | VALIDATED (env) | §9.7 | S3 — full order lifecycle / state meanings |
| F-10 | Order→invoice linkage is item-to-item via entity `CompraVendavariosPedido` (physical table `TGFVAR`): fields NUNOTA, SEQUENCIA, NUNOTAORIG, SEQUENCIAORIG, QTDATENDIDA, STATUSNOTA; the destination item's `SEQUENCIA` is not guaranteed equal to the origin item's `SEQUENCIAORIG` | VALIDATED (env) | §9.8 | — |
| F-11 | `ItemNota` (TGFITE) entity readable with line-level commercial/fiscal fields; `loadRecords` paginates via `hasMoreResult`/`offsetPage` — a single response must never be assumed to contain all records | VALIDATED (env) | §9.9 | — |
| F-12 | For the TOP-1001 (order) document tested: `SUM(VLRTOT) − SUM(VLRDESC) = TGFCAB.VLRNOTA` closed exactly | VALIDATED (env) | §9.10 | Confirm across more TOPs before treating as general |
| F-13 | For the TOP-1101 (invoice) document tested: `VLRNOTA = SUM(VLRTOT) − SUM(VLRDESC) + VLRIPI`; the composition of `VLRNOTA` differs by TOP/document type — no single universal formula reconstructs it | VALIDATED (env) | §9.11 | Confirm across more TOPs; never hardcode one formula |
| F-14 | `PERCDESC` alone is not sufficient to reconstruct the effective discount: the same nominal percentage produced a different `VLRDESC` between an order and its resulting invoice for one item | VALIDATED (env) | §9.14, §9.15 | — |
| F-15 | TGFCAB fiscal fields (BASEIPI, VLRIPI, BASEICMS, VLRICMS) matched the sum of the corresponding TGFITE line values in both documents tested | VALIDATED (env) | §9.12, §9.13 | — |
| F-16 | TGFFIN financial titles: in 3 of 4 compared documents `SUM(TGFFIN) = TGFCAB.VLRNOTA` exactly; one document (NUNOTA 1231, TOP 1101) showed `SUM(TGFFIN) − VLRNOTA = R$ 0,22`, and no reviewed detail field (interest, embedded discount, fine, provision) accounts for it | VALIDATED (env) | §9.16, §9.17, §9.21 | Root cause of the R$ 0,22 divergence — unresolved, do not discard |
| F-17 | `TGFPPG` defines the configured installment schedule (count, term, percentage) per `CODTIPVENDA`, but the number of financial titles actually generated is not guaranteed to match the configured installment count (5 configured installments produced 4 titles in the case observed) | VALIDATED (env) | §9.20 | — |
| F-18 | TGFFIN/TGFCAB audit fields (DHMOV, DTALTER, CODUSU, ORIGEM) show a document and its financial titles altered by a different user shortly after inclusion; the mechanism (manual action, automatic routine, or another internal process) is NOT established | VALIDATED (env) | §9.22, §9.23 | Mechanism behind the post-inclusion alteration |
| F-19 | Sandbox database is Oracle 19c (SQL dialect: `TO_CHAR`, `OFFSET … FETCH`, `FETCH FIRST`); the data dictionary `TDDCAM` is readable through `DbExplorerSP.executeQuery`. A `DbExplorerSP` SQL error returns **HTTP 200** with `status = "0"` and an `ORA-…` `statusMessage` (never assume HTTP status signals failure). An unbounded `SELECT` is silently truncated at **5,000 rows** with `responseBody.burstLimit = true`. | VALIDATED (env) | §9.27 | Production database engine/version; whether the integration user may run `DbExplorerSP` (F-04) |
| F-20 | REST v1 list endpoints exist: `GET /v1/vendedores`, `GET /v1/parceiros/clientes`, `GET /v1/produtos` (query `page`, 0-based, fixed 50 items/page, response `pagination{page,offset,total,hasMore}`; `hasMore` is the **string** `"true"`/`"false"`; `pagina`, `pageSize`, `limit`, `offset` are ignored; `pagination.total` is the page item count, not a grand total; a page past the end of `vendedores` returned HTTP 404 with empty body) and the bulk price endpoint `GET /v1/precos/tabela/{codtab}?pagina=N` (1-based, `temMaisRegistros` boolean, 50 products/page plus appended alternate-unit rows so a page may hold 51–52 items; a page past the end returns HTTP 200 with 0 items). The endpoint families use **different pagination conventions**. `GET /v1/parceiros` and `GET /v1/precos/tabelas` returned 404 (not available). | VALIDATED (env) | §9.28 | — |
| F-21 | REST v1 partner and product lists are **not** complete snapshots of the source table (Sandbox): `parceiros/clientes` returned 5,850 rows / 5,805 distinct vs 5,851 `CLIENTE='S'` partners (46 partners missing, 45 rows duplicated in the tail); `produtos` returned 3,970 distinct of 3,993 (23 products missing, all `ATIVO='S'`, consistent with the 21 `USOPROD='S'` products plus the 2 that `loadRecords` also omits — not proven). `vendedores` returned exactly the 83 sellers of `TGFVEN`. No list is ordered by the primary key (order is deterministic across repeats but unspecified). | VALIDATED (env) | §9.28, §9.29 | Cause of the omissions/duplicates; behavior in production |
| F-22 | `CRUDServiceProvider.loadRecords` pages 50 rows (`hasMoreResult` string, `offsetPage`); no ordering parameter is honored (`orderBy`, `order` tested); `Parceiro` comes back in `CODPARC` order, `Produto` and `Vendedor` do not. Offset paging over a **large result** is unreliable: full `Parceiro` crawl = 5,991 rows / 5,950 distinct, 42 real partners missing (incl. `CODPARC` 0) and the last page (41 rows) returning already-seen codes; full `Produto` crawl = 3,991 distinct, 2 missing (`CODPROD` 300001, 300002, also absent when asked by explicit criteria). Windowed reads with a `DTALTER` criterion (507 / 3,315 / 82 rows) were complete, distinct and equal to SQL. Keyset `this.CODPARC > last` (page 0 only) was complete except `CODPARC` 0. | VALIDATED (env) | §9.29 | Root cause of the tail defect; behavior in production |
| F-23 | `DbExplorerSP.executeQuery` with an explicit `ORDER BY <full key>` + `OFFSET … FETCH` (or keyset) returned **complete, duplicate-free, run-to-run identical** sets for all entities: `TGFPAR` 5,992 rows in 12 pages of 500 (108–169 ms each), `TGFPRO` 3,993, `TGFVEN` 83, `TGFEXC` 6,279 in 7 pages of 1,000 (98–196 ms), including the keys the REST/`loadRecords` reads omit. | VALIDATED (env) | §9.29 | Whether this is an acceptable production read mechanism (owner/architect, §9.33) |
| F-24 | Partner (`TGFPAR`, entity `Parceiro`): PK `CODPARC` (5,992 rows, unique, range 0…10000000); `ATIVO` S 5,944 / N 48 (never null); `CLIENTE='S'` 5,851, `FORNECEDOR='S'` 5,756, both 5,735; `TIPPESSOA` F 161 / J 5,831; `CODVEND` never null (937 = 0), 0 orphans to `TGFVEN`; 293 partners point to an inactive seller. Inactive partners are returned by every read by default. | VALIDATED (env) | §9.30 | — |
| F-25 | Seller (`TGFVEN`, entity `Vendedor`, REST `vendedores`): PK `CODVEND` (83 rows, range 0…84); `ATIVO` S 61 / N 22; `CODPARC` 83 populated (77 ≠ 0), `CODGER` 83 populated (29 = 0, 3 self-referencing), `CODEMP` 81 populated (0 zeros), 0 orphans on partner and manager; the REST list, `loadRecords` and SQL returned the same 83 keys, inactive included. REST `nome` = column `APELIDO` (50/50 sampled), `codigoParceiro`=`CODPARC`, `codigoGerente`=`CODGER`, `codigoEmpresa`=`CODEMP`. | VALIDATED (env) | §9.30 | — |
| F-26 | Product (`TGFPRO`, entity `Produto`): PK `CODPROD` (3,993 rows, unique, range 0…300002); `ATIVO` S 3,789 / N 204 (inactive returned by default); `DESCRPROD`, `CODGRUPOPROD`, `CODVOL` populated on 100% (max description length 100), 0 orphans to `TGFGRU`/`TGFVOL`; `MARCA` 3,877, `NCM` 3,967, `REFERENCIA` 1,580 populated. REST `produtos` field mapping confirmed by equality: `nome`=`DESCRPROD`, `codigoGrupoProduto`, `volume`=`CODVOL` (`unidadeMedida` is **not** `CODVOL`), `marca`, `ncm`, `referencia`. | VALIDATED (env) | §9.30 | — |
| F-27 | Price model: `TGFNTA` (8 price tables, all `ATIVO='S'`, key `CODTAB`) → `TGFTAB` (12 **versions**, key `NUTAB`, columns `CODTAB`, `DTVIGOR`, `DTALTER`, `PERCENTUAL`, `CODTABORIG`) → `TGFEXC` (6,279 rows, key `(NUTAB, CODPROD)` unique; `CODLOCAL` always 0, `CONTROLE` always blank, `TIPO` always `V`; `VLRVENDA`, `DHALTREG`). No `TGFEXC` row references a missing product or version; 94 rows reference inactive products. Versions 1, 5, 9, 10 have no `TGFEXC` rows; the versions of `CODTAB` 2 and 9 carry `PERCENTUAL`/`CODTABORIG` and the REST price for them is numerically consistent with `PERCENTUAL` applied to the origin table's price (product 4186: origin 14,83 × 1,5 → 22,25; origin 16,43 × 2 → 32,86) — rule NOT established (S2). For each `CODTAB`, the price returned by REST equals the `TGFEXC` rows of the version with the latest `DTVIGOR ≤ SYSDATE` (`CODTAB` 5 → `NUTAB` 13: 1,610 rows compared, 0 differences; the older version `NUTAB` 11 differed on 14). `CODTAB` 7 and 8 exist in `TGFNTA` without `TGFTAB` versions and the REST price endpoints answer HTTP 400 (empty body) for them. | VALIDATED (env) | §9.31 | S2 — price resolution rule, `PERCENTUAL` semantics, future-dated versions (none exist in the Sandbox) |
| F-28 | Bulk price read `GET /v1/precos/tabela/5?pagina=N`: 76 pages, 3,790 rows / 3,786 distinct products (4 products repeated in alternate units CX/PT), ascending by `codigoProduto`, identical in two full runs (76/76 pages), 214–364 ms per page; only `ATIVO='S'` products are returned (3,786 of 3,789 active); products without a `TGFEXC` row in the effective version are returned with `valor = 0` (2,180 rows) — **`0` cannot be told apart from "no price"**; the payload carries no version (`NUTAB`), validity date or timestamp. | VALIDATED (env) | §9.31 | S2 — meaning of `valor = 0` |
| F-29 | Candidate change timestamps: `DTALTER` is populated on 100% of `TGFPAR` (5,992), `TGFPRO` (3,993) and `TGFVEN` (83), second granularity, **not unique** (distinct values 5,672 / 1,342 / 56; largest tie group 23 / 90 / 28), and ≥ `DTCAD` on all partners; `TGFEXC.DHALTREG` populated on 3,237 of 6,279 rows (51.5%; fully on `NUTAB` 11 and 13, mostly empty on `NUTAB` 6 and 12); `TGFTAB.DTALTER` exists; `TGFNTA` has no timestamp. Text formats: `DbExplorerSP` `ddMMyyyy HH:mm:ss`, `loadRecords`/REST `dd/MM/yyyy HH:mm:ss` (time zone not stated). Whether `DTALTER`/`DHALTREG` is bumped on **every** edit cannot be proven read-only. | VALIDATED (env) — existence/population/format; bump-on-edit NEEDS VALIDATION | §9.32 | Bump-on-edit for each entity (needs a controlled non-production edit — write, outside S1); time zone |
| F-30 | Incremental read mechanics: `loadRecords` with criteria `this.DTALTER >= ?` and parameter `{type:"D"}` returned exactly the SQL-counted rows (see F-22); SQL composite keyset `WHERE ts > :t OR (ts = :t AND pk > :k) ORDER BY ts, pk FETCH FIRST n ROWS ONLY` returned every row once for `TGFPAR` (5,992), `TGFPRO` (3,993), `TGFVEN` (83); keyed by `CODPROD` alone, `TGFEXC` lost a tied row (3,236 of 3,237) — the **full primary key must be the tie-breaker**. | VALIDATED (env) | §9.32 | — |
| F-31 | Authentication/errors: a bearer token past its 300 s lifetime is rejected with **HTTP 403** and body `{"error":{"codigo":"GTW3403","descricao":"Bearer Token inválido ou Expirado."}}` on REST and gateway alike; a malformed token also returns 403; a missing `Authorization` header returns 401; a new `/authenticate` call restores service. REST errors on bad path/parameter: 404 or 400 with an empty body. No HTTP 429, no rate-limit or `Retry-After` header was observed in ≈ 1,900 sequential requests (≤ ~5 req/s, no parallelism); responses expose only Kong tracing headers (`X-Kong-*`, `GTW-REQUEST-ID`). Absence of a limit signal is **not** a measured limit. | VALIDATED (env) — expiry/format; limits NEEDS VALIDATION | §9.27 | S0.2, S1.4 — actual quota |
| F-32 | Deletion signals: master rows are inactivated with `ATIVO='N'` (partners 48, sellers 22, products 204); no deletion flag column was found on the entities; the Sandbox database declares foreign keys to the master tables (`TGFPAR` 347, `TGFPRO` 299, `TGFVEN` 45, `TGFNTA` 32, `TGFTAB` 2) and no orphan reference exists from `TGFCAB` (partner, seller) or `TGFITE` (product); key-space gaps exist (e.g. 5,990 partners in 1…5999). Physical deletion of an **unreferenced** row cannot be tested read-only, and no deletion-log table was investigated. | VALIDATED (env) — signals; physical deletion NEEDS VALIDATION | §9.32 | Whether unreferenced rows are ever physically deleted in production; existence of a Sankhya deletion log |
| F-33 | User ↔ seller link (Sandbox): `TSIUSU` (PK `CODUSU`, 69 users, 116 columns) carries `CODVEND` (never null; 54 > 0, 15 = 0; all 54 match a `TGFVEN` seller; **declared foreign key** `TSIUSU.CODVEND → TGFVEN.CODVEND`). One user has at most one seller (single column). 53 distinct sellers are linked; one seller has 2 users (maximum 2), so seller → user is not one-to-one. Of the 83 sellers, 53 have a user (52 active, 1 inactive) and 30 have none (9 active, 21 inactive). Dictionary options of `TSIUSU.TIPOUSU`: 0 = Interface, 1 = Integração; the 54 linked users are all type 0; the 15 unlinked are 14 type 0 plus the single type 1 user. `TSIUSU.CODVEND` is labelled "Vendedor" in the dictionary. | VALIDATED (env) | §9.30 | Production data; whether the eventual integration user may read `TSIUSU` at all (F-04) |
| F-34 | User ↔ seller — what is **not** available or reliable (Sandbox): `TSIUSU.CODPARC` is 0/null on all 69 users (`TSIUSU → TGFPAR → TGFVEN.CODPARC` inference yields 0 matches; no user is inferable via partner); `TSIUSU` has no column named `ATIVO`, blocked or status (only `DTLIMACESSO`, an access-limit date: 4 null, 65 not past, 0 expired; and `DTULTACESSO`, null for 8 of the 54 linked users), so user activity is not directly expressed; among linked users 1 (non-expired limit) points to an **inactive** seller and 1 active seller is linked to a user with a null limit. `TGFVEN.CODUSU` (FK → `TSIUSU.CODUSU`; populated 82/83, 81 > 0, all matching a user) is **not** the reverse of `TSIUSU.CODVEND` (the two agree for only 2 of 81 sellers; 2 user codes are shared by several sellers; meaning unproven — do not use for scope). Document corroboration: of 364 `TGFCAB` rows with a seller, the including user (`CODUSUINC`) has a seller link in 234 and that seller equals the document's seller in only 35 (8 distinct including users overall), so the link identifies a person's seller code and does **not** describe who owns or creates documents. | VALIDATED (env) | §9.30 | Meaning of `TGFVEN.CODUSU`; business meaning of `DTLIMACESSO` |
| F-35 | `TGFPRO.USOPROD` dictionary (`TDDCAM` NUCAMPO 613): type `VARCHAR2(1)`, label "Usado como", option list in `TDDOPC` (domain `mge`): `1` Subproduto, `2` Prod. Intermediário, `V` Venda (fabricação própria), `T` Terceiros, `R` Revenda, `P` Em Processo, `O` Outros insumos, `M` Matéria prima, `I` Imobilizado, `F` Brinde (NF), `E` Embalagem, `D` Revenda (por fórmula), `C` Consumo, `B` Brinde, `4` Demonstração. The dictionary proves these labels only; it does not state which values a sales catalog should show. | VALIDATED (env) — labels; sellable rule NEEDS VALIDATION | §9.30 | Business confirmation of which values are sellable |
| F-36 | `USOPROD` observed in `TGFPRO` (3,993 products; ATIVO S / N): `V` 1,286 / 100, `2` 1,489 / 94, `M` 517 / 9, `R` 404 / 0, `C` 57 / 0, `S` 21 / 0, `E` 12 / 0, `3` 2 / 0, `1` 1 / 1; never null. Values **`S` (21) and `3` (2) are not in the dictionary option list**, so their meaning is unproven (the 21 `S` match the products the REST list omits, F-21). With a positive `VLRVENDA` in the effective version of `CODTAB` 5 (`NUTAB` 13): `V` 1,214 of 1,286 active, `R` 390 of 404, `2` 2 of 1,489, every other value 0 (1,606 of 3,789 active products priced). Appearing in `TGFITE` of a document with `TIPMOV='V'` (meaning of `TIPMOV` not established, F-09): `V` 790 of 1,286 active, `R` 77, `C` 5, `M` 2, `1` 1, `2` 0; with `TIPMOV='C'`: `2` 532, `R` 392, `V` 1,165, `M` 197, `C` 38, `E` 5. `ATIVO='S'` alone is **insufficient** to identify a sales catalog: 2,099 of the 3,789 active products carry a value other than `V`/`R` (`2` 1,489, `M` 517, `C` 57, `S` 21, `E` 12, `3` 2, `1` 1). | VALIDATED (env) — counts; sellable meaning NEEDS VALIDATION | §9.30 | Business rule for sellable values (owner); meaning of `S` and `3`; whether items of other values are ever sold |
| F-37 | `TGFVEN.TIPVEND` dictionary options: `S` Supervisor, `R` Representante, `C` Comprador, `E` Executante, `G` Gerente, `V` Vendedor, `T` Técnico. Observed: `V` 6, `R` 1, `G` 1, `C` 1 (all active) and null on 74 (52 active, 22 inactive) — so 52 of the 61 active sellers have no type and `TIPVEND` cannot be used to identify sellers. `TGFVEN.ATIVO` options: S = Sim, N = Não. | VALIDATED (env) | §9.30 | — |
| F-38 | Price-table structure (Sandbox, catalog + dictionary): `TGFNTA` PK `CODTAB` (8 logical tables: 0, 2, 3, 5, 6, 7, 8, 9); `TGFTAB` PK `NUTAB` (12 versions) with **declared FK** `CODTAB → TGFNTA` and `CODTABORIG → TGFNTA` (the origin of a derived table is a **logical table code**, not a version); `TGFEXC` PK `(NUTAB, CODPROD, CODLOCAL, CONTROLE)` (extends F-27; `CODLOCAL` always 0, `CONTROLE` blank); `TGFITE.NUTAB` is an FK to `TGFTAB` (the version an order item used). `TGFEXC.TIPO` is `V` on all rows and `PERCDESC` is 0/null on all rows (no per-row discount or type variation in the Sandbox). Versions per `CODTAB`: 0 → 5 (`NUTAB` 1, 2, 3, 7, 8), 2 → 2, 3 → 1, 5 → 2 (11, 13), 6 → 1, 9 → 1; `CODTAB` 7 and 8 have none. `TGFTAB.FORMULA` is empty on all 12 versions. `TGFTAB.DTVIGOR` carries a date (validity start); no end-date column was found. | VALIDATED (env) | §9.37 | Meaning of `TGFNTA.CODTABFLEX` (= 3 on `CODTAB` 3), `TGFNTA.CODTIPPARC`/`CODREG` (0 on all tables), `TGFTAB.FORMULA` (empty — semantics untested) |
| F-39 | Effective version rule (Sandbox, 2026-09-18): per `CODTAB` the effective version is the one with the **latest `DTVIGOR ≤ current database date`**. `CODTAB` 5 → `NUTAB` 13 (`DTVIGOR` 17/08/2026); the superseded `NUTAB` 11 (01/01/2026) is **still stored** with 1,606 rows, the same count as v13. No future-dated version exists (rule for future dates untested by data). The database clock reads UTC−03:00 (`TZR` −03:00, `DBTIMEZONE` +00:00). REST `GET /v1/precos/tabela/5?pagina=1` equalled SQL `NUTAB` 13 on 44 of 44 unique products (exact); the same page also equalled `NUTAB` 11 on the sample, so **the page sample alone cannot discriminate** v11 from v13 (the full-table comparison in F-27, 1,610 rows, can). Historical corroboration: all 13,375 order items carrying a `NUTAB` (`TIPMOV` P 9,309, V 4,066, C 4 — the parts sum to 13,379, not the reported 13,375; unreconciled, immaterial to the rule) reference the version that was the latest `DTVIGOR ≤ DTNEG` of the document (e.g. one partner's documents dated 08/07/2026 used `NUTAB` 11); an item therefore snapshots the version at creation. | VALIDATED (env) — rule and corroboration; behavior at a future-dated version, at the exact vigência instant and time-zone semantics NEEDS VALIDATION | §9.37 | Future-dated versions (none exist); whether "now" is the DB clock or the order date for a new order (S3) |
| F-40 | Customer → price table (Sandbox): `TGFPAR.CODTAB` is populated for 5,320 of 5,851 customers; among active customers `CODTAB` 5 → 5,183, 6 → 64, 3 → 25, null → 531. Corroboration on 13,025 versioned order items whose partner also has a `CODTAB`: the item's version belongs to **the partner's `CODTAB`** on 12,991 (`TIPMOV` P 9,097 items / 221 documents; V 3,894 / 83) and to another table on 34 (P 17 / 3 documents; V 17 / 3). Items whose partner has a null `CODTAB` exist (P 195 items / 8 documents; V 155 / 7). Other candidates are all empty or constant in the Sandbox: `TGFTPV.CODTAB`, `TGFPRO.CODTAB`, `TGFPAR.CODTABST`, `TGFEMP.CODTAB` null everywhere; `TGFNTA.CODTIPPARC`/`CODREG` 0 on all tables. Parameter `TSIPAR.TIPTABPRECOS` = 4 (dictionary label "Tabela de Preços por: Única / Região do Vendedor / Região do Par…"; value 4 **not decoded**); `TIPATUALTAB` 0, `CODTABVAREJO` 0, `RECPRECOTPV` 1. Multi-table context exists (10 of 320 documents used 2 tables; 5 of 182 partners used 2) with reason unproven. Items with an empty `NUTAB` exist on all `TIPMOV` C, D, E, F, J, O and on a few P/V. | VALIDATED (env) — `TGFPAR.CODTAB` is the table observed for 99.7% of comparable items; fallback for a null `CODTAB`, the 34 exceptions, and the meaning of `TIPTABPRECOS` 4 NEEDS VALIDATION | §9.37 | Default/fallback for customers without `CODTAB` (531 active customers); what selects a table other than `TGFPAR.CODTAB`; production configuration |
| F-41 | Derived tables (Sandbox): a `TGFTAB` version carrying `PERCENTUAL` + `CODTABORIG` has **no `TGFEXC` rows of its own** (`NUTAB` 5, 9, 10). Effective derived versions: `NUTAB` 9 (`CODTAB` 2 → origin `CODTAB` 3, `PERCENTUAL` 50) and `NUTAB` 10 (`CODTAB` 9 → origin `CODTAB` 5, `PERCENTUAL` 100); `CODTAB` 5 has no `PERCENTUAL`. Measured on REST page 1 (50 products each; 44 with a source price, 6 with `valor 0` and no source row): `CODTAB` 2 = origin price (effective `NUTAB` 6 of `CODTAB` 3) × (1 + 50/100), 44 of 44 within 0.005 (18 exact, max difference 0.005 — REST returns 2 decimals); `CODTAB` 9 = origin price (`NUTAB` 13) × 2, 44 of 44 exact. The unscaled comparison does not match. Rounding mode of the derived price, the choice of origin **version** when the origin table has several, multi-level chains, and the effect of `CODTABFLEX`/`FORMULA` are not measured. | VALIDATED (env) — multiplicative rule on 44 products per table; rounding, chains and origin-version choice NEEDS VALIDATION | §9.37 | Rounding mode of derived prices (S2.3); products beyond page 1; chains |
| F-42 | Zero / missing price states, `CODTAB` 5 effective `NUTAB` 13 (SQL vs REST, Sandbox): of 3,789 active products 1,606 have a positive `TGFEXC` row (1,604 with `USOPROD` V/R + 2 with `2`), 2,183 have **no row** (2,074 other use codes, 21 `S`, 2 `3`, 86 `V`/`R` incl. 72 `V`); the 204 inactive products have no row in `NUTAB` 13. There is **no `VLRVENDA = 0` or null row in `NUTAB` 13**; the only zero-value rows found are 2 in `NUTAB` 12 (`CODTAB` 6, products 5016 and 5017). REST returns `valor` 0 for a product without a row (single reads: product 0, and `S` product 537, whose row is also absent from the bulk list, F-21) **and** 0.0 for an explicit zero row (product 5016, `CODTAB` 6) — so over REST "no row" and "explicit zero" are **indistinguishable**; single reads answer HTTP 200 with the usual envelope (`codigo` "200", `numeroRegistros` 1). SQL is the only measured way to tell them apart. | VALIDATED (env) | §9.37 | Business meaning of a missing or zero price (hide / "no price" / block); REST behavior for an inactive product that has a row (none in the effective version) and for alternate-unit rows on a single read |
| F-43 | `GET /v1/precos/tabela/5?pagina=0` returns **HTTP 400 with an empty body** (`pagina` is 1-based; 0 is rejected, not treated as page 1). Resolves the open point in §9.28 / §9.36 item 9 for this endpoint only. | VALIDATED (env) | §9.28, §9.37 | — |
| F-44 | **Order-creation contract (Sandbox, one order).** Gateway service `CACSP.incluirNota` (module `mgecom`, JSON, bearer token) accepted a request with header fields `CODPARC`, `DTNEG`, `CODTIPOPER` (1001), `CODTIPVENDA` (11), `CODVEND`, `CODEMP` (1), `TIPMOV` (`P`), `OBSERVACAO` (free text) and **one** item with `CODPROD`, `QTDNEG`, `CODLOCALORIG`, `CODVOL`, `IGNOREDESCPROMOQTD`, under `itens.INFORMARPRECO = "False"`. Answer: HTTP 200, `status` "1", new key at `responseBody.pk.NUNOTA.$` (NUNOTA 2475), plus a `transactionId`. This is a **sufficient** field set for one customer/product/TOP/payment-type combination; omission of any single field was **not** tested, so it is not a proven minimum (`TGFCAB` has 70 and `TGFITE` 37 NOT NULL columns, the rest filled by Sankhya). | VALIDATED (env) — sufficiency for one case; minimum set, other TOPs/products/units NEEDS VALIDATION | §9.38 | Minimum mandatory set; TOP/company/payment choice for Sales Force (business, S0.4/S3.1); behavior on production configuration |
| F-45 | **State of an inserted order (Sandbox).** Immediately after `incluirNota` the header read `STATUSNOTA = 'A'`, `PENDENTE = 'S'`, `TIPMOV = 'P'`, TOP 1001; no `TSILIB` row (`NUCHAVE` = NUNOTA, `TABELA` = `TGFCAB`) existed. Sankhya stamped the current versions of the TOP (`DHTIPOPER` 12/08/2026 13:38:57) and of the payment type (`DHTIPVENDA` 10/07/2026 11:35:00). Nothing confirmed the order: `CACSP.confirmarNota` was **not** called (an extra write outside the authorized single test). | VALIDATED (env) — insertion state; confirmation flow NEEDS VALIDATION | §9.38 | Who confirms and how (S3.2); which TOP/payment settings trigger `TSILIB` releases (S4) |
| F-46 | **Transactional price, one case (Sandbox).** With `INFORMARPRECO = "False"` and no price/discount sent, the created item's `VLRUNIT` was **16.43 = the list price** of the effective version (`NUTAB` 13) of the customer's own `TGFPAR.CODTAB` (per the S2 contract, F-39/F-40); the item stored `NUTAB` 13. Sankhya resolved the price itself; the request carried no price. One product, quantity 1, one customer: **not** a general rule. Discount was **not exercised** (no `PERCDESC` sent); product `DESCMAX` = 12 was read as a candidate limit only. Historical items of the same product show `VLRUNIT` mostly equal to the list price with a separate `PERCDESC`; only 1 of 20 sampled items had a `VLRUNIT` (15.61) below it with `PERCDESC` 0 — mechanism unproven (HYPOTHESIS: discount/negotiated price entered manually). `INFORMARPRECO = "True"` (client-supplied price, requires `VLRUNIT`/`PERCDESC` per the docs) was **not** tested. | VALIDATED (env) — one case; rounding, quantity ranges, discounts, other tables, client-supplied price NEEDS VALIDATION | §9.38 | S2.1–S2.3 (general rule, 50–100 cases); discount authority and the meaning of `DESCMAX` (S4, R35/R36) |
| F-47 | **Totals (Sandbox, one order).** Header `VLRNOTA` = **18.03**; item total 16.43; the 1.60 difference is **inferred** to be IPI computed at insertion (**HYPOTHESIS** — the IPI columns of the row were not separately reconciled before the order was removed). If so, for TOP 1001 as configured **today** `VLRNOTA` includes IPI at insertion, whereas the historical order in F-12 closed as `SUM(VLRTOT) − SUM(VLRDESC) = VLRNOTA`; the TOP definition in the Sandbox was last altered 12/08/2026 (`DHTIPOPER`, F-45), which is a HYPOTHESIS for the difference (not proven; older documents keep the totals rules of their time). Because the inserted total differed from the item total, the Sales Force client must not predict the total by a fixed formula (extends F-13). | VALIDATED (env) — the measured totals of one order; attribution of the 1.60 to IPI is a HYPOTHESIS; formula per TOP/version NEEDS VALIDATION | §9.38 | Tax simulation before an order exists (S2.4); which TOP-version totals rule applies in production |
| F-48 | **Financial titles at insertion (Sandbox).** One `TGFFIN` row was created synchronously with the unconfirmed order: `VLRDESDOB` = 18.03 = `VLRNOTA`, due date = `DTNEG` (18/09/2026), for payment type 11. Whether type 11 is configured as a single installment (`TGFPPG`) was **not** re-read, so the single title is an observation, not a rule (F-17 already showed titles ≠ configured installments). | VALIDATED (env) — one order | §9.38 | Installment generation rule per payment type (S3/S4) |
| F-49 | **Read-your-write.** `TGFCAB`, `TGFITE` and `TGFFIN` rows of the new order were readable through `DbExplorerSP` about 300 ms after the `incluirNota` answer, and a lookup by the test marker in `OBSERVACAO` returned exactly one header. | VALIDATED (env) — one order | §9.38 | Consistency under load (S0.2) |
| F-50 | **Cancellation of an unconfirmed order.** `CACSP.cancelarNota` (body `notasCanceladas`: `nunota` list, `justificativa`, `validarProcessosWmsEmAndamento`) on the pending order answered **HTTP 200, `status` "1"**, with `resultadoCancelamento.totalNotasCanceladas = "0"` — the note was **not** cancelled and the call reports success. The official documentation states a note must be confirmed to be cancelled (VALIDATED (docs)); the environment behaved consistently. **A cancellation result must be judged by `totalNotasCanceladas` (and a read-back), never by HTTP/`status`.** Cancellation of a **confirmed** order was **not** tested. | VALIDATED (env) — unconfirmed case only | §9.38, §9.39 | Cancellation of confirmed orders and how it is observed (`TGFCAN`, S3.4) |
| F-51 | **Delete of an unconfirmed order.** `CACSP.excluirNotas` with body `{"notas":{"nota":[{"NUNOTA":"2475"}]}}` (NUNOTA as a plain string, not `{"$":…}`; format taken from a **third-party** SDK, not from official documentation) answered HTTP 200, `status` "1", empty `responseBody`. Read-back afterwards: `TGFCAB` 0, `TGFITE` 0, `TGFFIN` 0, `TGFCAN` 0 rows for NUNOTA 2475 and 0 headers carrying the test marker — the order, its item and its financial title were **physically removed** and no cancellation record remains. The empty answer proves nothing by itself. | VALIDATED (env) — the Sandbox unconfirmed-order case | §9.38, §9.39 | Whether the integration user may delete in production (S0); delete leaves no audit trail — never a production compensation without an owner decision |
| F-52 | **Origin-id candidates on `TGFCAB` (Sandbox dictionary/catalog).** No unique index other than the PK (`NUNOTA`); `NUMNOTA` (NUMBER, NOT NULL) has only non-unique indexes; `OBSERVACAO` (VARCHAR2 4000, nullable, no index); custom nullable fields exist, among them **`AD_NUVIDYA` and `AD_VDYORIG` (VARCHAR2 100)**, `AD_OFFLINE` (VARCHAR2 100), `AD_STATUS` (VARCHAR2 10), `AD_OBS`/`AD_OBSINTERNA` (VARCHAR2 4000), `AD_DHCRIACAOVDY`/`AD_DHCONFIRMVDY` (DATE) — named after the outgoing sales-force system (`VDY`/`VIDYA`) — their origin is a **HYPOTHESIS** from the names; their exact use was not established and no written value was inspected in this session. **No database-level uniqueness** exists for any candidate, so a duplicate check must be done by the application before each retry (SNK-4). Whether `incluirNota` accepts a value for an `AD_` header field was **not** tested (it needed a second order). `transactionId` in the answer is per call; it is **not** an accepted idempotency key (nothing in the contract accepts it) and no native idempotency was observed — V-13 remains NEEDS VALIDATION because a deliberate duplicate was not allowed. | VALIDATED (env) — dictionary facts; usability of any field as origin-id NEEDS VALIDATION | §9.39 | V-11 (custom origin-id field feasibility, owner + Sankhya partner), V-13; owner decision on reuse of `AD_VDYORIG`/`AD_NUVIDYA` vs a new field |

Facts F-02–F-18 come from the Sandbox validation session in §9 (2026-09-18); F-19–F-32 from the S1 closing session (§9.27–§9.33, same date); F-33–F-37 from the S1 follow-up on the user ↔ seller link and `USOPROD` (§9.30, same date; 9 Sandbox requests, read-only); F-38–F-43 from the S2 price-resolution session (§9.37, same date; 14 Sandbox requests, read-only); F-44–F-52 from the S3 controlled-order session (§9.38–§9.40, same date; 25 Sandbox requests, exactly one order write plus its cleanup).

---

## 3. Spikes

Each spike has questions, an exit criterion and what it blocks; the status of each question is on its own row (S1–S3 are PARTIALLY VALIDATED as of 2026-09-18).

### S0 — Commercial and environment (with the Sankhya partner/executive)

**Start immediately; non-technical; long lead time.**

| # | Question | Status |
|---|---|---|
| S0.1 | Does a homologation environment exist for our Sankhya contract? If not, can an isolated real non-production environment (e.g. a separate test database) be provided through the partner, and at what cost? | NEEDS VALIDATION |
| S0.2 | What are the API request limits (per minute/hour/day, concurrency)? | NEEDS VALIDATION |
| S0.3 | Is there a cost per integration, per API user or per request? | NEEDS VALIDATION |
| S0.4 | Is the company authorized to create custom additional fields on the order header and partner records, and can the partner support it? | NEEDS VALIDATION |
| S0.5 | Does Sankhya offer native idempotency for document or partner insertion? | NEEDS VALIDATION |
| S0.6 | Maintenance windows and support channel for integration incidents | NEEDS VALIDATION |
| S0.7 | Can API credentials be restricted to read-only access (per user, profile or gateway configuration)? Needed for SNK-3 read-only inspections. | NEEDS VALIDATION |
| S0.8 | Do order header and partner records have observation/free-text fields usable for the SNK-4 emergency fallback, and can the custom origin-id field hold a 36-character UUID? | NEEDS VALIDATION |

- **Exit criterion:** written answers from the partner/executive recorded in §7.
- **Blocks:** S1–S6; SNK-3 (staging environment); SNK-4 (Sankhya writes).
- **Validation IDs:** V-11, V-13.

### S1 — API choice, reads and change detection

| # | Question | Status |
|---|---|---|
| S1.1 | For each operation, which API is used: REST v1 or gateway services? Criteria: support for custom fields, confirmation behavior, incremental reads, error messages. | PARTIALLY VALIDATED (Sandbox, reads only) — three read mechanisms measured per entity (F-19–F-23); REST/`loadRecords` unfiltered lists are incomplete, explicit-order SQL is complete; choice is an open ARCHITECTURAL DECISION INPUT (§9.33); custom fields and write-side criteria remain NEEDS VALIDATION (S0.4, S3) |
| S1.2 | For each Phase 0 mirror entity: service, filters, pagination, incremental cursor (change date, increasing key, other). | PARTIALLY VALIDATED (Sandbox) — source, PK, pagination, ordering and cursor candidates measured for the four entities (F-20–F-30, §4); bump-on-edit of the cursor NEEDS VALIDATION |
| S1.3 | How are deletions detected per entity? | PARTIALLY VALIDATED (Sandbox) — soft inactivation via `ATIVO` and FK protection measured (F-32); physical deletion of unreferenced rows NEEDS VALIDATION |
| S1.4 | Error format; behavior on rate limiting (status codes, headers, retry hints); authentication expiry behavior. | PARTIALLY VALIDATED (Sandbox) — error and expiry formats measured (F-19, F-31); rate-limit behavior NEEDS VALIDATION (no 429 observed at ≤ ~5 req/s; not a limit) |
| S1.5 | Measured latency and throughput per entity; feasibility of daily reconciliation within the night window. | PARTIALLY VALIDATED (Sandbox) — latencies and full-read durations measured (§9.34); Sandbox volume only, production volume and window NEEDS VALIDATION |
| S1.6 | Token lifetime and renewal behavior in our environment (confirms F-01). | VALIDATED (env)) — `expires_in` 300 s, expired/invalid token → HTTP 403 `GTW3403`, missing → 401, re-authentication restores service (F-31); production tenant NEEDS VALIDATION |

- **S1 closing session (2026-09-18, Sandbox, read-only):** measurements in §9.27–§9.34, facts F-19–F-32, mirror matrix in §4, minimum read contracts in §9.35, open items in §9.36. Overall S1 status: **PARTIALLY VALIDATED** — S1 cannot be closed as VALIDATED because the bump-on-edit semantics, physical deletion, production permissions/dialect and rate limits cannot be proven by read-only Sandbox calls.

- **S1 follow-up (2026-09-18, Sandbox, read-only, 9 HTTP requests):** the user ↔ seller link (F-33, F-34) and the meaning of `TGFPRO.USOPROD` (F-35, F-36) were measured for the first-UI slice (§9.30, §9.35, §9.36 items 7, 11, 12). S1 overall status unchanged (**PARTIALLY VALIDATED**).

- **Candidate tables to validate** (not assumptions): `TGFPAR` (partners), `TGFVEN` (sellers), `TGFPRO` (products), `TGFTAB` / `TGFEXC` (prices), `TGFCAB` / `TGFITE` (document header/items), `TGFFIN` (financial titles).
- **Exit criterion:** entity → method → cursor → deletion detection table (§4) filled with measured timings and recorded sanitized samples.
- **Blocks:** Phase 0 mirror implementation against a real environment (V-12).
- **Sandbox evidence (2026-09-18):** `Parceiro`, `Produto`, `vendedores` (REST v1) and `CabecalhoNota` / `ItemNota` / `TGFVAR` (via `loadRecords` / `DbExplorerSP.executeQuery`) confirmed reachable in the Sandbox, and `loadRecords` pagination behavior (`hasMoreResult`/`offsetPage`) confirmed (F-04–F-11, §9). This validates single-record/entity reachability only — incremental cursor and deletion detection per entity (S1.2, S1.3) remain NEEDS VALIDATION.

### S2 — Price resolution, rounding and taxes

| # | Question | Status |
|---|---|---|
| S2.1 | The real price resolution rule in the company's configuration: dependence on company, TOP, payment/negotiation type, partner or product exceptions, quantity ranges, region, partner-linked table, minimum price, maximum discount. | PARTIALLY VALIDATED (Sandbox, reads only) — **list-price** part measured: effective version (F-39), partner-linked table `TGFPAR.CODTAB` (F-40, 99.7% of comparable items), derived tables (F-41), zero/missing states (F-42). NEEDS VALIDATION: fallback for a null `CODTAB`, the 34 exceptions, `TIPTABPRECOS` 4, company/TOP/payment/region/quantity dependence, minimum price, maximum discount. **S3 end-to-end test (F-46): the transactional price of ONE created item (`INFORMARPRECO` false) equalled the list price of the customer's effective table (VALIDATED (env), one case)** |
| S2.2 | 50–100 real cases (customer, product, quantity, condition → Sankhya price), sanitized, recorded as acceptance tests for `packages/domain`. | NEEDS VALIDATION — **one** created-order case now exists (F-46: list price 16.43, `NUTAB` 13, quantity 1, no discount); descriptive corroboration otherwise (F-39, F-40: 13,375 historical items by version; 1,102 of 9,270 `P` and 798 of 4,045 `V` items with `VLRUNIT` ≠ the `TGFEXC` price, cause unproven); no sanitized case set recorded (only one order was authorized) |
| S2.3 | Rounding rule (per item or total) and decimal precision of prices, percentages and quantities. | NEEDS VALIDATION — `TGFNTA.DECVENDA` is 0 on all 8 tables and REST returns 2 decimals (0.005 differences on derived prices, F-41); one item with quantity 1 cannot show rounding; rounding mode and precision not established |
| S2.4 | Can Sankhya simulate taxes (IPI, ICMS-ST) for a quotation before an order exists? | NEEDS VALIDATION — **not tested** (no simulation service exercised). Observed only: the inserted order total exceeded its item total by 1.60, inferred to be IPI (F-47, HYPOTHESIS), i.e. taxes appear to exist after an order is created, not before |

- **Exit criterion:** recorded cases; rounding rule documented; R30 and R31 ready for decision.
- **Blocks:** pricing in `packages/domain`, quotations and orders (Phase 1); percentage/quantity precision in DATA-3.
- **S2 session (2026-09-18, Sandbox, read-only, 14 HTTP requests):** list-price contract measured in §9.37 (F-38–F-43). Overall S2 status: **PARTIALLY VALIDATED** — **VALIDATED (env) for the list-price rule as observed on the Sandbox sample** (structure, effective version, derived tables, zero/missing states, partner-linked table as the observed rule); **NOT validated** for the transactional order price, rounding, tax simulation, the fallback for customers without a table, and any production configuration.
- **S3 end-to-end result (2026-09-18, Sandbox, one order, §9.38):** the S2 list-price contract was confirmed end-to-end for one case (F-46). S2 overall stays **PARTIALLY VALIDATED** — the list price is VALIDATED (env) and one transactional price agrees with it; general transactional price, rounding, discounts, taxes simulation and the fallback table remain open.
- **Sandbox evidence (2026-09-18):** the price-table query (`GET /v1/precos/produto/{codprod}/tabela/{codtab}`) confirmed reachable (F-07, §9.5). It does not by itself validate the transactional price resolution rule — S2.1 and S2.2 remain NEEDS VALIDATION beyond the one case of F-46.

### S3 — Order lifecycle

| # | Question | Status |
|---|---|---|
| S3.1 | Mandatory fields for order insertion; TOP and company to use for Sales Force orders. | PARTIALLY VALIDATED (Sandbox, one order) — `CACSP.incluirNota` accepted a sufficient field set (F-44) with TOP 1001, `CODEMP` 1, payment type 11. **Not** validated: the true minimum set (no omission test), other TOPs/units, and whether TOP 1001/company 1/payment type 11 is the business choice for Sales Force orders (owner + S0.4; production may differ) |
| S3.2 | Is an inserted order pending confirmation? Who confirms, and how (API, manual, TOP rule)? | PARTIALLY VALIDATED (Sandbox) — an inserted order is pending: `STATUSNOTA` A, `PENDENTE` S, no `TSILIB` row (F-45). NEEDS VALIDATION: who confirms and how (`CACSP.confirmarNota` exists in the docs but was not called — the authorization covered one write), confirmation side effects, `TSILIB` releases |
| S3.3 | Invoicing: link between order and invoice document(s); partial invoicing; cut items. | NEEDS VALIDATION — not exercised in the S3 write test (the existing item-to-item `TGFVAR` link, F-10, is from historical documents only) |
| S3.4 | Cancellation after insertion and how it is observed. | PARTIALLY VALIDATED (Sandbox, unconfirmed order only) — `cancelarNota` is a silent no-op on a pending order (HTTP 200, 0 cancelled, F-50); `excluirNotas` physically removed the order with item and title (F-51); cancellation of a **confirmed** order and its `TGFCAN` record were **not** tested |
| S3.5 | Duplicate-proof write: origin-id field, native idempotency and duplicate detection before a retry (SNK-4, V-11, V-13). | PARTIALLY VALIDATED (dictionary only) — candidate fields exist, no DB uniqueness (F-52); writing an origin-id value and native idempotency **not tested** (no second order allowed) → NEEDS VALIDATION, **blocks real order writes** |

- **Exit criterion:** state diagram validated with one real order in the non-production environment.
- **S3 test session (2026-09-18, Sandbox, one order, §9.38–§9.40):** creation, read-back and cleanup were measured (F-44–F-52). Overall S3 status: **PARTIALLY VALIDATED** — insertion, pending state, list-price-based item pricing, totals with IPI, synchronous financial title, cancel/delete of an *unconfirmed* order are VALIDATED (env) for the Sandbox; confirmation, invoicing, cancellation of a confirmed order, origin-id write and native idempotency are NOT.
- **Blocks:** order submission and status tracking (Phase 1); R24, R25.
- **Sandbox evidence (2026-09-18):** order/invoice header fields, item-to-item linkage (TGFVAR), totals and fiscal mirroring rules observed by reading existing documents on TOP 1001 and TOP 1101 (F-09–F-16, §9). That reconnaissance was read-only; the controlled order creation followed later the same day (bullet above, §9.38). TOP 1000 and TOP 2209 were not exercised (§9.26).

### S4 — Limit releases and credit

| # | Question | Status |
|---|---|---|
| S4.1 | Which native "liberação de limites" events can fire on orders (discount, credit, minimum price)? | NEEDS VALIDATION |
| S4.2 | Can a dedicated TOP for Sales Force orders avoid those events (or create them already released)? | NEEDS VALIDATION |
| S4.3 | The formula for available credit (limit, open titles, pending orders). | NEEDS VALIDATION |

- **Exit criterion:** R26 and R38 ready for decision.
- **Blocks:** approval flow and credit checks (Phase 1).

### S5 — Partner registration

| # | Question | Status |
|---|---|---|
| S5.1 | Mandatory partner fields in the company's configuration. | NEEDS VALIDATION |
| S5.2 | Coded address data (city, neighborhood, street) and how to resolve them from a postal code. | NEEDS VALIDATION |
| S5.3 | Fiscal data required (state registration, ICMS contributor indicator, tax regime, classification). | NEEDS VALIDATION |
| S5.4 | Definition of the custom idempotency field on the partner (depends on S0.4). | NEEDS VALIDATION |

- **Exit criterion:** field list split into seller-collected vs approval-completed data; R27 ready for decision.
- **Blocks:** new customer creation (Phase 1).

### S6 — Goals, positivization and commissions

| # | Question | Status |
|---|---|---|
| S6.1 | Where goals are stored; granularity (value/volume, period, product/group); update frequency. | NEEDS VALIDATION |
| S6.2 | Whether positivization exists as data in Sankhya or must be counted from invoices. | NEEDS VALIDATION |
| S6.3 | Where commissions are stored; forecast vs released; whether only available after period closing. | NEEDS VALIDATION |

- **Exit criterion:** source per indicator; R28 ready for decision.
- **Blocks:** goals, positivization and commissions screens (Phase 1).

---

## 4. Phase 0 mirror entity map

Filled by the S1 closing session from Sandbox measurements (2026-09-18, §9.27–§9.36). Frequencies are the spec's initial values (RF-SNK-1) and remain PROPOSED until S0.2 limits are known. Read methods below are what was **measured to work**; the mechanism to adopt is an open decision input (§9.33), not a choice made here.

| Sales Force entity | Sankhya source | Read method (measured) | Incremental cursor | Deletion detection | Proposed frequency | Status |
|---|---|---|---|---|---|---|
| Sellers | `TGFVEN` (PK `CODVEND`, 83 rows) — VALIDATED (env)) | REST `GET /v1/vendedores?page=` (complete, 2 pages) or `loadRecords` `Vendedor` (complete) or SQL — all returned the same 83 keys | Candidate `TGFVEN.DTALTER` (100% populated); at 83 rows a **full read each cycle** is cheaper than a cursor — VALIDATED as feasible | `ATIVO='N'` (22 of 83) returned by default; physical deletion NEEDS VALIDATION | 15 min | PARTIALLY VALIDATED |
| Customers / partners and portfolio | `TGFPAR` (PK `CODPARC`, 5,992 rows, 5,851 `CLIENTE='S'`) — VALIDATED (env)); portfolio = `TGFPAR.CODVEND` (F-24) | SQL with `ORDER BY CODPARC` + `OFFSET/FETCH` (complete, 12 × 500); `loadRecords` with `DTALTER` window (complete when result ≤ ~3.3k rows); **unfiltered REST/`loadRecords` crawl incomplete (F-21, F-22)** | Composite `(DTALTER, CODPARC)`, keyset — VALIDATED as a read mechanism (F-30); bump-on-edit NEEDS VALIDATION | `ATIVO='N'` (48); FK-protected rows (F-32); physical deletion NEEDS VALIDATION | 10 min | PARTIALLY VALIDATED |
| Products | `TGFPRO` (PK `CODPROD`, 3,993 rows) — VALIDATED (env)) | SQL with `ORDER BY CODPROD` (complete, 3,993); `loadRecords` windowed by `DTALTER` (complete); unfiltered REST list missed 23 active products, unfiltered `loadRecords` 2 (F-21, F-22) | Composite `(DTALTER, CODPROD)` — VALIDATED as a read mechanism; bump-on-edit NEEDS VALIDATION | `ATIVO='N'` (204); physical deletion NEEDS VALIDATION | 15 min | PARTIALLY VALIDATED |
| Price tables | `TGFNTA` (8 tables) → `TGFTAB` (12 versions, PK `NUTAB`) → `TGFEXC` (6,279 rows, PK `(NUTAB, CODPROD)`); derived tables resolved by REST price endpoint — VALIDATED (env)) | SQL over `TGFEXC` ordered by `(NUTAB, CODPROD)` (complete, 7 × 1,000, deterministic); REST `GET /v1/precos/tabela/{codtab}?pagina=` (76 pages for `CODTAB` 5, deterministic, `valor 0` ambiguous, no version) | `TGFTAB.DTALTER`/`DTVIGOR` per version + `TGFEXC.DHALTREG` (51.5% populated — **not sufficient alone**); a full 6,279-row read takes ~1 s of query time, so **full snapshot + hash diff** is the measured-viable strategy (S2 confirmed it: superseded versions stay stored, F-39, so the mirror must key rows by `(NUTAB, CODPROD)`, keep `TGFTAB` versions with `DTVIGOR`/`PERCENTUAL`/`CODTABORIG`, and resolve the effective version itself; derived tables have no `TGFEXC` rows, F-41 — proposal, NOT APPROVED); cursor NEEDS VALIDATION | No delete signal: a new `TGFTAB` version supersedes the old one (`DTVIGOR`); removed `TGFEXC` rows can only be seen by snapshot diff — NEEDS VALIDATION | 10 min | PARTIALLY VALIDATED |

Whether financial titles, sales documents and goals/commissions are mirrored in Phase 0 is an open scope question (`roadmap.md` Q-02).

**S3 note (2026-09-18):** after an order write the header, item and financial rows were readable through SQL within ~300 ms (F-49); the fields a document-status mirror would need first are `TGFCAB.STATUSNOTA` and `PENDENTE` (F-45). Whether sales documents are mirrored in Phase 0 stays the open scope question above (Q-02); nothing in this matrix changes.

**Sandbox evidence (2026-09-18):** single-record REST v1 reads were confirmed for `Parceiro` (candidate `TGFPAR`), `Produto` (candidate `TGFPRO`) and `vendedores` (candidate `TGFVEN`), and a price read for candidate `TGFTAB`/`TGFEXC` (F-05–F-08, §9.3–§9.6). This confirms the entities are reachable but does not validate bulk listing, incremental cursor or deletion detection for the mirror — the table's status column stays NEEDS VALIDATION per S1.2/S1.3.

---

## 5. Request limits and concurrency

| Item | Value | Status |
|---|---|---|
| Requests per time unit | — (≈ 1,900 sequential requests at ≤ ~5 req/s produced no throttling in the Sandbox; not a measured limit) | NEEDS VALIDATION (S0.2, S1.5) |
| Allowed concurrency | — (never tested; all S1 calls were sequential) | NEEDS VALIDATION |
| Rate-limit signal | No HTTP 429 or `Retry-After` observed (F-31); token expiry is HTTP 403 `GTW3403`; `DbExplorerSP` 5,000-row silent cap flagged by `burstLimit` (F-19) | NEEDS VALIDATION (S1.4) — rate-limit behavior; VALIDATED (env)) — expiry and cap signals |

Until measured, the worker serializes Sankhya requests and backs off on rate-limit and server errors.

---

## 6. Fixture policy

1. Raw responses are captured only into `.sankhya-raw/` (git-ignored), normally from a non-production environment. Captures from Sankhya production happen only inside an authorized read-only diagnostic inspection (SNK-3 exception, `security-model.md` §10.1), are limited to the minimum needed, are not copied elsewhere, and are logged in §8.
2. Before committing, fixtures are sanitized: CNPJ/CPF, names, trade names, addresses, emails, phones and free-text notes replaced with synthetic values; identifiers remapped consistently; monetary values kept only when needed by a test.
3. Committed fixtures live in `packages/sankhya` with provenance: spike, operation, date, environment type.
4. Credentials, tokens and `X-Token` values never appear in fixtures, logs or this document.

---

## 7. Findings log

Append-only. One row per finding, with evidence.

| Date | Spike | Finding | Evidence | Recorded by |
|---|---|---|---|---|
| 2026-09-16 | — | F-01 authentication model from official documentation | Links in §2 | Decision session |
| 2026-09-18 | S1, S2, S3 | Sandbox validation session: confirmed auth/gateway reachability, `Parceiro`/`Produto`/`vendedores` reads, order↔invoice linkage via TGFVAR, `loadRecords` pagination, item/fiscal/financial totalization rules for TOP 1001 and TOP 1101 documents; recorded an unresolved R$ 0,22 financial divergence on one invoice (F-02–F-18) | §2 (F-02–F-18), §9 | Sandbox spike session |
| 2026-09-18 | S1 | S1 closing session (Sandbox, read-only, ≈ 1,900 requests): measured per-entity bulk reads, pagination, ordering determinism, change-timestamp candidates, deletion signals, price versioning and expiry/error formats. Unfiltered REST and `loadRecords` list reads are **incomplete** (partners −42/duplicated tail, products −2/−23); explicit-order SQL and narrow filtered windows are complete. S1 = PARTIALLY VALIDATED (F-19–F-32) | §2 (F-19–F-32), §4, §9.27–§9.36 | S1 closing session |
| 2026-09-18 | S1 | S1 follow-up (Sandbox, read-only, 9 requests): measured `TSIUSU.CODVEND → TGFVEN.CODVEND` (FK-backed, 54 of 69 users linked, one seller with 2 users, no partner route, no active flag) and the `USOPROD` option list vs observed values (`S` and `3` unlisted; 2,099 of 3,789 active products are not `V`/`R`). Both first-UI gaps refined, not decided (F-33–F-37) | §2 (F-33–F-37), §9.30, §9.35, §9.36 | S1 follow-up session |
| 2026-09-18 | S2 | S2 price-resolution session (Sandbox, read-only, 14 requests: 2 authenticate + 5 SQL + 7 REST; no limit hit; the only non-200 was the measured `pagina=0` HTTP 400). Measured: price-table structure and FKs, effective version = latest `DTVIGOR ≤ now` per `CODTAB` (superseded versions stay stored; historical items follow the same rule), partner `CODTAB` as the table on 99.7% of 13,025 comparable items, derived tables = origin price × (1 + `PERCENTUAL`/100) on 44 products per table, no zero/null price row in the effective `CODTAB` 5 version (REST `0` = "no row" indistinguishable from an explicit zero), `pagina=0` rejected. List price VALIDATED (env) for the Sandbox; transactional price, rounding, fallback table and taxes NOT validated. S2 = PARTIALLY VALIDATED (F-38–F-43) | §2 (F-38–F-43), §9.37 | S2 session |
| 2026-09-18 | S2, S3 | S3 controlled-order session (Sandbox only, 25 requests: 5 authenticate + 17 `DbExplorerSP` reads + 1 `CACSP.incluirNota` + 2 cleanup calls; no server limit hit, request budget used in full). Exactly **one** order was created (NUNOTA 2475, TOP 1001, one item, pending `A`/`S`, price = list price 16.43, `VLRNOTA` 18.03 with IPI, one financial title 18.03, no `TSILIB`), read back, then removed: `cancelarNota` was a silent no-op (0 cancelled) and `excluirNotas` deleted the order, item and title (all four table counts 0). **Final Sandbox state: the test order does not remain.** Origin-id, native idempotency, confirmation, invoicing and cancellation of a confirmed order were not tested. S3 = PARTIALLY VALIDATED (F-44–F-52) | §2 (F-44–F-52), §9.38–§9.40 | S3 session |

---

## 8. Production diagnostic inspection log

Append-only. Every read-only inspection of Sankhya production (SNK-3 exception) is recorded here **before** it starts (authorization) and completed after it ends. No credentials, tokens or real customer data in this table.

| Date | Authorized by / reference | Spike question | Why no test environment suffices | Credentials read-only? | Data inspected (categories only) | Raw captures kept (location, deletion date) | Outcome / finding ID |
|---|---|---|---|---|---|---|---|
| — | — | No inspection performed yet | — | — | — | — | — |

---

## 9. Sandbox validation session — 2026-09-18

Practical validation run against the company's Sankhya Sandbox environment (not production — see §9.1). Findings are rolled up as F-02–F-18 in §2, cross-referenced from the relevant spikes in §3, and logged in §7. Names, legal ids and logins below are removed or pseudonymised; internal ERP codes (partner, seller, product, document and title numbers) are real Sandbox codes kept as evidence — the §6 rule 2 remapping was not applied; this session's raw capture, if any, belongs in `.sankhya-raw/` and is never committed.

### 9.1 Environment and authentication

Status: VALIDATED (env)

- Web test environment: `https://<company>-teste.sankhyacloud.com.br` (company-specific subdomain, redacted here)
- Sandbox API base: `https://api.sandbox.sankhya.com.br`
- Authentication endpoint: `POST /authenticate`
- Confirmed authentication: OAuth 2.0 `client_credentials` with Client ID, Client Secret and an `X-Token` header — confirms F-01 in the Sandbox, not just documentation.
- An authentication attempt against the production endpoint `https://api.sankhya.com.br/authenticate` with Sandbox credentials was rejected (recorded by the previous spike session): the credentials are environment-specific. It was a credential-only contact with production — no data was requested — and is **not** logged in §8; flagged for owner acknowledgement (SNK-3). It must not be repeated.
- Observed access token `expires_in = 300` (~5 minutes).
- An expired token can produce HTTP 403; calls resume normally after renewing the bearer token.
- **Action required:** the credentials/tokens used during this spike were exposed during testing and must be rotated before any real implementation work (§6 rule 4 — no actual secret values are recorded here).

### 9.2 MGE gateway

Status: VALIDATED (env)

Validated endpoint: `https://api.sandbox.sankhya.com.br/gateway/v1/mge/service.sbr`

Services tested:

- `CRUDServiceProvider.loadRecords`
- `DbExplorerSP.executeQuery`

`DbExplorerSP.executeQuery` worked for the Sandbox technical user used in this spike; whether the eventual integration user/profile will have the same permission is not yet confirmed.

### 9.3 Partner (`Parceiro`)

Status: VALIDATED (env)

Test partner (sanitized): **TEST_PARTNER_234**

- CODPARC: 234
- CODVEND: 5
- ATIVO: S

Entity: `Parceiro`. The API also returned the partner's legal name and CNPJ; those values are not reproduced here (sanitized per §6 rule 2).

### 9.4 Product (`Produto`)

Status: VALIDATED (env)

- CODPROD: 4186
- Description: FORMINHA DE PAPEL NOBRE N. 5 S. MERC 10X100 - BAUNILHA
- ATIVO: S
- CODGRUPOPROD: 5000200
- CODVOL: PT

Entity: `Produto`.

### 9.5 Price

Status: VALIDATED (env)

Endpoint tested: `GET /v1/precos/produto/4186/tabela/5?pagina=1`

Result: product 4186, table 5, value R$ 16,43, unit PT, local stock 0, controle empty.

This validates the price-table query but does not by itself prove this is always the final transactional price of an order — contextual price rules still need validation in an order-creation spike (S2, S3; see §9.26).

### 9.6 Seller (`vendedores`)

Status: VALIDATED (env)

Endpoint: `GET /v1/vendedores/5`

Result (sanitized): CODVEND 5 — **SELLER_5**, active: true, company: 1, linked partner: 5240, manager: **MANAGER_83**.

### 9.7 Partner TEST_PARTNER_234 — commercial history

Status: VALIDATED (env)

Query against `CabecalhoNota`. Documents found dated 08/07/2026:

| NUNOTA | NUMNOTA | CODPARC | CODVEND | TOP | TIPMOV | VLRNOTA | STATUSNOTA | PENDENTE |
|---|---|---|---|---|---|---|---|---|
| 1164 | 236 | 234 | 5 | 1001 | P | R$ 2.485,03 | L | S |
| 1202 | 54045 | 234 | 5 | 1101 | V | R$ 2.771,89 | L | N |
| 1229 | 260 | 234 | 5 | 1001 | P | R$ 2.485,21 | L | N |
| 1231 | 54051 | 234 | 5 | 1101 | V | R$ 2.770,27 | L | N |

Do not infer the general meaning of `STATUSNOTA=L`, or of every `TIPMOV` value, from this single small sample.

### 9.8 Order → invoice link via TGFVAR

Status: VALIDATED (env)

Entity `CompraVendavariosPedido`, physical table `TGFVAR`. Item-to-item linkage confirmed.

Fields: NUNOTA, SEQUENCIA, NUNOTAORIG, SEQUENCIAORIG, QTDATENDIDA, STATUSNOTA.

**Flow 1229 → 1231:** 37 links found, all pointing NUNOTAORIG 1229 → NUNOTA 1231. Confirms invoice 1231 originated from order 1229. The linkage is item-to-item; the invoice's `SEQUENCIA` is **not** assumed equal to the order's `SEQUENCIAORIG` (examples observed: invoice seq. 1 ← order seq. 33; invoice seq. 6 ← order seq. 27).

**Flow 1164 → 1202:** 33 links found; confirms invoice 1202 originated from order 1164.

### 9.9 Items (`ItemNota` / TGFITE)

Status: VALIDATED (env)

Entity `ItemNota`. Validated fields: NUNOTA, SEQUENCIA, CODPROD, QTDNEG, VLRUNIT, VLRTOT, VLRDESC, PERCDESC, CODVOL, PENDENTE.

Pagination: a query for NUNOTA 1229 and 1231 returned 74 total records — page 0: 50 records (`hasMoreResult = true`), page 1: 24 records (`hasMoreResult = false`). Every sync via `loadRecords` must handle `hasMoreResult` and increment `offsetPage`; a single response must never be assumed to contain all records.

### 9.10 Order 1229 — item totals

Status: VALIDATED (env)

37 items. VLRTOT R$ 2.613,48 − VLRDESC R$ 128,27 = R$ 2.485,21, matching `TGFCAB.VLRNOTA` exactly.

Formula observed for this document (TOP 1001): `SUM(VLRTOT) − SUM(VLRDESC) = VLRNOTA`.

### 9.11 Invoice 1231 — item totals

Status: VALIDATED (env)

37 items. VLRTOT R$ 2.613,48 − VLRDESC R$ 129,85 = net item total R$ 2.483,63.

Header: VLRDESCTOTITEM R$ 129,85, VLRIPI R$ 286,64, VLRNOTA R$ 2.770,27.

Formula observed for this document (TOP 1101): `2.613,48 − 129,85 + 286,64 = 2.770,27`, i.e. `VLRNOTA = net items + VLRIPI`.

**Important conclusion:** the semantics of `VLRNOTA` depend on the document/TOP. For TOP 1001 (order), VLRNOTA is the net item total and IPI already exists but does not compose it; for TOP 1101 (invoice), VLRNOTA = net items + IPI. Do not implement a single universal formula to reconstruct `VLRNOTA` in Sales Force (see §9.25). **Update (S3, F-47):** the one order created under TOP 1001 as configured today had `VLRNOTA` 1.60 above its item total (attribution to IPI is a HYPOTHESIS), so the TOP 1001 statement above holds for the historical documents measured in F-12 and is not proven for TOP 1001 today.

### 9.12 Order 1229 — fiscal (TGFCAB)

Status: VALIDATED (env)

VLRNOTA R$ 2.485,21; VLRDESCTOTITEM R$ 128,27; BASEIPI R$ 2.485,21; VLRIPI R$ 286,88; BASEICMS R$ 2.485,21; VLRICMS R$ 447,41. TGFITE line sums confirmed the same values.

### 9.13 Invoice 1231 — fiscal (TGFCAB)

Status: VALIDATED (env)

VLRNOTA R$ 2.770,27; VLRDESCTOTITEM R$ 129,85; BASEIPI R$ 2.483,61; VLRIPI R$ 286,64; BASEICMS R$ 2.483,63; VLRICMS R$ 447,13. TGFITE line sums confirmed the same values.

### 9.14 Change between order 1229 and invoice 1231

Status: VALIDATED (env)

Item-by-item comparison using the real TGFVAR linkage. Exactly one item (CODPROD 3547, order seq. 36 → invoice seq. 29) showed a commercial/fiscal difference. Quantity and unit price were unchanged (QTD 2 → 2, VLRUNIT R$ 64,47 → R$ 64,47, VLRTOT R$ 128,94 → R$ 128,94). Discount: order R$ 11,60 → invoice R$ 13,18 (+R$ 1,58), while `PERCDESC` stayed at 9 in both.

**Important conclusion:** `PERCDESC` alone is NOT sufficient to reconstruct the real discount amount — use the effective `VLRDESC` (see F-14, §9.25).

### 9.15 Fiscal detail of product 3547 (the changed item)

Status: VALIDATED (env)

| Field | Order 1229 seq. 36 | Invoice 1231 seq. 29 |
|---|---|---|
| VLRTOT | R$ 128,94 | R$ 128,94 |
| VLRDESC | R$ 11,60 | R$ 13,18 |
| PERCDESC | 9 | 9 |
| BASEIPI | R$ 117,34 | R$ 115,74 |
| ALIQIPI | 15 | 15 |
| VLRIPI | R$ 17,60 | R$ 17,36 |
| BASEICMS | R$ 117,34 | R$ 115,76 |
| VLRICMS | R$ 21,12 | R$ 20,84 |

This single item's change (discount +R$ 1,58) fully explains the fiscal variation observed between order 1229 and invoice 1231: BASEICMS −R$ 1,58, ICMS −R$ 0,28, BASEIPI −R$ 1,60, IPI −R$ 0,24.

### 9.16 Invoice 1231 — financial (TGFFIN)

Status: VALIDATED (env)

Titles: NUFIN 4553, 4554, 4555, 4556. Installments R$ 692,62 / R$ 692,62 / R$ 692,62 / R$ 692,63, due 05/08, 12/08, 19/08, 26/08/2026.

Total TGFFIN: R$ 2.770,49. `TGFCAB.VLRNOTA`: R$ 2.770,27.

**Divergence: R$ 0,22.** This finding is preserved as an open, unresolved divergence (F-16) — see §9.17 and the hypothesis in §9.24. It must not be removed or treated as resolved without further environment evidence.

### 9.17 Financial detail fields of invoice 1231

Status: VALIDATED (env)

All four titles show VLRJURO, VLRDESC, DESPCART, VLRVENDOR, CARTAODESC, VLRDESCEMBUT, VLRJUROEMBUT, VLRMULTA, VLRMULTAEMBUT, VLRJURONEGOC, VLRMULTANEGOC, VLRPROV = 0, and VLRDESDOBCALC empty.

**Conclusion:** none of these detail fields explain the additional R$ 0,22 on the financial side.

### 9.18 Payment type

Status: VALIDATED (env)

Code 4 = BOLETO, active: true, subtype 2. The installments of invoice 54051 carry their own boleto data (barcode, "nosso número", digitable line) — this data must never be persisted unsanitized in a fixture or document.

### 9.19 Negotiation type

Status: VALIDATED (env)

TGFCAB: CODTIPVENDA 1, DHTIPVENDA 30/06/2026 11:37:44, description `PARCELADO - 0/28/35/42/49`. Configuration observed: SUBTIPOVENDA 3, TIPTAXA U, TIPJURO I, VENDAMIN 2500; TAXAJURO, TAXAJURSIM, TIPOJURSIM, ARREDPRIMEIRAPARC empty; NROPARCELAS empty at header level.

### 9.20 Configured installments (TGFPPG)

Status: VALIDATED (env)

`TGFPPG` for CODTIPVENDA 1:

| Seq | Term (days) | Percentage | Title type |
|---|---:|---:|---:|
| 1 | 28 | 20% | 4 |
| 2 | 35 | 20% | 4 |
| 3 | 42 | 20% | 4 |
| 4 | 49 | 20% | 4 |
| 5 | 0 | 20% | 4 |

Total configured: 100%. FORMULA was null on every observed installment. The documents analyzed generated **four** financial titles, not five.

**Conclusion:** the actual number of financial titles must not be inferred from `TGFPPG` alone (F-17) — financial generation can go through additional rules, edits or processing.

### 9.21 Financial comparison across the four documents

Status: VALIDATED (env)

| NUNOTA | TOP | CODTIPVENDA | VLRNOTA | TGFFIN titles | Sum TGFFIN | Difference |
|---|---|---|---|---|---|---|
| 1164 | 1001 | 1 | R$ 2.485,03 | 8 | R$ 2.485,03 | R$ 0,00 |
| 1202 | 1101 | 1 | R$ 2.771,89 | 4 | R$ 2.771,89 | R$ 0,00 |
| 1229 | 1001 | 1 | R$ 2.485,21 | 4 | R$ 2.485,21 | R$ 0,00 |
| 1231 | 1101 | 1 | R$ 2.770,27 | 4 | R$ 2.770,49 | **+R$ 0,22** |

`COUNT(TGFFIN)` must not be automatically interpreted as the count of valid/active installments (NUNOTA 1164 shows 8 title records).

**Conclusion:** the R$ 0,22 divergence is not a generic rule of TOP 1101 or negotiation type 1 — it is specific to the 1231 document/flow observed. It remains an open, unresolved finding and must not be discarded (F-16).

### 9.22 TGFFIN audit — invoices 1202 and 1231

Status: VALIDATED (env)

NF 54045 / NUNOTA 1202: titles NUFIN 4480–4483, DHMOV 08/07/2026 14:02:03, DTALTER 08/07/2026 16:19:47, CODUSU **USER_15**, ORIGEM E. Financial closes exactly with VLRNOTA.

NF 54051 / NUNOTA 1231: titles NUFIN 4553–4556, DHMOV 08/07/2026 16:46:43, DTALTER 08/07/2026 17:18:03 (installments 1–3) / 17:18:04 (installment 4), CODUSU **USER_0**, ORIGEM E. Financial ended R$ 0,22 above VLRNOTA.

### 9.23 TGFCAB audit — invoices 1202 and 1231

Status: VALIDATED (env)

| Field | NUNOTA 1202 | NUNOTA 1231 |
|---|---|---|
| NUMNOTA | 54045 | 54051 |
| TIPMOV | V | V |
| CODUSU | USER_15 | USER_0 |
| CODUSUINC | USER_15 | USER_15 |
| HRMOV | 162232 | 171801 |
| DTALTER | 08/07/2026 16:22:32 | 08/07/2026 17:18:02 |
| DHTIPOPER | 07/07/2026 08:18:15 | 07/07/2026 08:18:15 |
| DHTIPVENDA | 30/06/2026 11:37:44 | 30/06/2026 11:37:44 |
| AD_DHCRIACAOVDY | empty | empty |
| AD_DHCONFIRMVDY | empty | empty |

**Conclusion:** invoice 1231 was included under user USER_15, but the header's last recorded user became USER_0. The four financial titles of the same invoice also show their last alteration recorded by USER_0, right after the header change — this proves a later alteration recorded by USER_0. **Not established:** whether this was a manual action, an automatic routine, a process running under the USER_0 account, or another internal mechanism (F-18).

### 9.24 Hypothesis — the R$ 0,22 divergence

Status: HYPOTHESIS — NOT VALIDATED

Observed coincidence: invoice 1231's final BASEIPI (R$ 2.483,61) + order 1229's IPI (R$ 286,88) = R$ 2.770,49, which exactly equals the TGFFIN sum. The invoice's final IPI is R$ 286,64 (difference from R$ 286,88: R$ 0,24). But VLRNOTA uses the net commercial item total (R$ 2.483,63), not BASEIPI (R$ 2.483,61): `2.483,63 + 286,64 = 2.770,27`.

It was not proven internally which routine generated the R$ 2.770,49 figure. Recorded as hypothesis only: **the financial titles may have been calculated from an intermediate state prior to the final fiscal recalculation.** Do not implement any rule based on this hypothesis — it is not confirmed, and does not replace the open item in F-16.

### 9.25 Architectural inputs derived from this session

Status: ARCHITECTURAL DECISION INPUT — NOT APPROVED

Recommendations for the owner/architect to evaluate against `architecture.md` and `decisions.md`; they do not bind on their own until recorded there.

- **Totals:** do not reconstruct `VLRNOTA` with a universal formula; mirror the value Sankhya calculated (§9.11).
- **Discounts:** persist/mirror both `VLRDESC` and `PERCDESC`; never derive `VLRDESC` from `PERCDESC` alone (§9.14).
- **Fiscal:** mirror Sankhya-calculated values for BASEIPI, VLRIPI, BASEICMS, VLRICMS; do not build a proprietary fiscal engine in Sales Force (§9.12–9.15).
- **Financial:** treat TGFCAB and TGFFIN as related but independent states; do not assume `SUM(TGFFIN) = TGFCAB.VLRNOTA` — the real divergence must be representable (§9.16, §9.21).
- **Order → invoice:** use TGFVAR to trace origin, as `(NUNOTAORIG, SEQUENCIAORIG) → (NUNOTA, SEQUENCIA)`; never assume equal sequence numbers (§9.8).
- **Pagination:** every `CRUDServiceProvider.loadRecords` read must loop while `hasMoreResult = true` (§9.9).
- **Source of truth:** Sankhya remains the source of truth for customers after approval, sellers, products, prices, negotiation types, TOPs, submitted orders, invoices, financial titles and fiscal data; Sales Force must not silently "correct" inconsistencies that already exist in the ERP.

### 9.26 Follow-up questions raised by this session

Status: NEEDS VALIDATION — mapped to existing spikes, not new IDs

- Controlled order creation in the Sandbox; minimum mandatory fields for insertion; TOP and company to use → **S3.1**.
- Transactional price resolution and discount application during creation → **S2.1, S2.2**.
- Negotiation type behavior and the `NUNOTA` returned on an API-created order → **S3.1, S3.2**.
- Idempotency / duplicate order prevention; the custom `Sales Force origin id` field → **S0.4, S0.8, SNK-4**.
- Safe cancellation/deletion of a test order → **S3.4**.
- Behavior of TOP 1000 (orçamento) and TOP 2209 (ZFM) specifically — only TOP 1001 and TOP 1101 were exercised in this session → **S3.1**.
- API rate limits → **S0.2, S1.5** (§5).
- Credit rules; overdue titles / available credit → **S4.3**.
- Goals, positivization and commissions → **S6**.
- **Stock — flagged, not queued as a spike:** the session notes recorded "stock, if needed for some future rule" as a possible future question. `CLAUDE.md` hard invariants P-01/P-13 list stock queries/blocking as **out of scope** for this project. This note is preserved here only as a flagged item for the owner to resolve explicitly (drop it, or approve a scope exception) — it is not an active NEEDS VALIDATION question and must not be treated as authorized scope.

**S1 closing session (same date; §9.27–§9.36).** Status of everything below: VALIDATED (env)) where marked as measured; NEEDS VALIDATION otherwise. Sandbox only; no production access (§8 unchanged). Method: only `GET`s and pure-query `POST`s (`DbExplorerSP.executeQuery` `SELECT`, `CRUDServiceProvider.loadRecords`); no write of any kind; sequential requests, small pages, pauses; ≈ 1,900 authenticated requests in total; the bearer token was kept in process memory only. Counts, codes, field names and timings are recorded; no partner/company names, tax ids, contacts or addresses.

### 9.27 Environment, dictionary and error behavior

- Sandbox database dialect is Oracle 19c; `TDDCAM` (field dictionary) is readable via `DbExplorerSP` (F-19). SQL errors come back as HTTP 200 with `status = "0"` and an `ORA-…` message; an unbounded result is truncated at 5,000 rows and flagged `burstLimit = true` (F-19).
- Token: `expires_in = 300`; after expiry or with a malformed token the REST and gateway calls return HTTP 403 with error code `GTW3403`; a missing token returns 401; a new `/authenticate` restores service (F-31, S1.6).
- No HTTP 429 and no rate-limit header in ≈ 1,900 sequential requests at ≤ ~5 req/s. This is not a limit measurement (S0.2, §5).

### 9.28 REST v1 list endpoints

| Endpoint | Page param | Page size | Termination | Notes |
|---|---|---|---|---|
| `GET /v1/vendedores` | `page`, 0-based | 50 | `pagination.hasMore` = string `"false"`; a further page returns HTTP 404 | 83 sellers in 2 pages, complete |
| `GET /v1/parceiros/clientes` | `page`, 0-based | 50 | `hasMore` string | ≈ 117 pages; 5,850 rows, 5,805 distinct; incomplete + duplicated tail (F-21) |
| `GET /v1/produtos` | `page`, 0-based | 50 | `hasMore` string | ≈ 80 pages; 3,970 distinct of 3,993; incomplete (F-21) |
| `GET /v1/precos/tabela/{codtab}` | `pagina`, **1-based** | 50 products (+ alternate-unit rows) | `temMaisRegistros` boolean; page past the end = HTTP 200, 0 items | 76 pages for `CODTAB` 5; complete for active products (F-28) |

`page`/`pagina` are not interchangeable across endpoint families; `pageSize`, `limit`, `offset` are ignored. `pagina=0` on the price endpoint returns HTTP 400 with an empty body (F-43, VALIDATED (env)); `page=0`/`pagina=0` on the other endpoint families is unchanged (`page` is 0-based there). `GET /v1/parceiros` and `GET /v1/precos/tabelas` return 404. No change-timestamp filter parameter was found on the REST lists — NEEDS VALIDATION whether REST v1 supports one.

### 9.29 Pagination, completeness and ordering — measured

| Read | Result | Deterministic on repeat |
|---|---|---|
| `loadRecords` `Parceiro`, unfiltered, offset crawl | 5,991 rows / 5,950 distinct; 42 partners missing (incl. `CODPARC` 0); last page (41 rows) returns already-seen codes | Yes (same result twice) |
| `loadRecords` `Produto`, unfiltered crawl | 3,991 distinct; `CODPROD` 300001 and 300002 missing (also absent when requested by explicit criteria) | Yes |
| `loadRecords` `Vendedor`, unfiltered crawl | 83 / 83 | Yes |
| `loadRecords` with `this.DTALTER >= ?` (`{type:"D"}`) | 507, 3,315 and 82 rows: complete, distinct, equal to SQL count | Yes |
| `loadRecords` keyset `this.CODPARC > last` (page 0 only) | Complete except `CODPARC` 0 | Yes |
| REST lists (§9.28) | See F-21 | Yes (same order each run) |
| SQL `ORDER BY <full PK>` + `OFFSET … FETCH` | Complete and identical on two runs: `TGFPAR` 5,992 (12 × 500), `TGFPRO` 3,993, `TGFVEN` 83, `TGFEXC` 6,279 (7 × 1,000) | Yes |
| SQL composite keyset `(DTALTER, PK)` | Every row exactly once for `TGFPAR`, `TGFPRO`, `TGFVEN` | Yes |

- Repeating the **same page** returned the same rows on every read tested, so the defect is not non-determinism but a systematic omission/duplication at the tail of large offset crawls in the unfiltered `loadRecords`/REST reads. Root cause NOT established (NEEDS VALIDATION); do not rely on unfiltered offset pagination as a complete snapshot.
- `loadRecords` honors no ordering parameter (F-22). The `ItemNota` behavior from §9.9 is **not** generalized: each entity was measured on its own.
- Termination rules: `loadRecords` → `hasMoreResult` string; REST → `hasMore` string (v1 lists) or `temMaisRegistros` boolean (price). A reader must compare against the string `"true"`/`"false"`, not truthiness.

### 9.30 Entity facts (Partner, Seller, Product)

- **Partner `TGFPAR`** (F-24): PK `CODPARC` (5,992; 0…10,000,000). Customer flag `CLIENTE='S'` = 5,851. `CODVEND` (portfolio-owner candidate) never null, 937 = 0, 0 orphans; 293 partners point to an inactive seller. `CODTAB` (customer price-table candidate): among the 5,851 customers 531 null, none 0, 3 distinct tables, 0 orphans to `TGFNTA`; whether it drives the price a customer gets is NEEDS VALIDATION (S2). `LIMCRED` (credit **limit**, not available credit): 5,765 positive, 227 null. Null counts across all partners: `NOMEPARC` 0, `RAZAOSOCIAL` 44, `CGC_CPF` 1, `CODCID` 1 (null or 0), `TELEFONE` 275, `EMAIL` 5,992 (the column is empty on every partner — contact e-mail lives elsewhere, NEEDS VALIDATION). `TIPPESSOA` F 161 / J 5,831; `ATIVO` S 5,944 / N 48.
- **Seller `TGFVEN`** (F-25): PK `CODVEND` (83). `APELIDO` populated on 100%; `EMAIL` null on 31; `TIPVEND` null on 74. A seller links to a partner row (`CODPARC`, 83 populated). **User ↔ seller (follow-up, F-33, F-34):** the Sankhya user table `TSIUSU` has an FK-backed `CODVEND → TGFVEN.CODVEND` (54 of 69 users linked; ≤ 1 seller per user; 1 seller with 2 users); the partner route and `TGFVEN.CODUSU` are unusable/unproven; `TIPVEND` labels and `TIPOUSU` labels come from the dictionary (F-37). That is the **Sankhya** user, not the Sales Force login — how a Sales Force account is tied to a `CODVEND` is a design decision (§9.36 item 11), not a Sankhya fact.
- **Product `TGFPRO`** (F-26): PK `CODPROD` (3,993). `TGFPRO.CODTAB` exists but is null on all 3,993 products (no per-product table). `USOPROD` (label "Usado como", 15 dictionary options) was enumerated in the follow-up: 9 values are used, two of them (`S`, `3`) absent from the dictionary, and `ATIVO='S'` alone does not identify a sales catalog (F-35, F-36); which values are sellable is a business rule, still NEEDS VALIDATION (§9.36 item 12). EAN: only 17 `TGFBAR` rows — not a usable coverage (NEEDS VALIDATION).

### 9.31 Price model and resolution — measured

See F-27, F-28. In addition: the rule "latest `DTVIGOR ≤ SYSDATE` per `CODTAB`" reproduced the REST price exactly for `CODTAB` 5. Effective versions resolved (max `DTVIGOR` ≤ now): `CODTAB` 0 → `NUTAB` 8, 2 → 9, 3 → 6, 5 → 13, 6 → 12, 9 → 10; no future-dated version exists in the Sandbox. `codigoLocalEstoque` returned by the single-price read (F-07) is a stock-**location** code; `TGFEXC.CODLOCAL` is 0 on all rows. Whether the price a customer pays follows the `CODTAB` of the partner, of the product, of the negotiation or of the TOP was NOT established by S1; the S2 measurements are in §9.37 (partner `CODTAB` is the observed table for 99.7% of comparable historical items, F-40; the other candidates are empty in the Sandbox).

### 9.32 Change detection and deletion — measured and unproven

- Candidates: `TGFPAR.DTALTER`, `TGFPRO.DTALTER`, `TGFVEN.DTALTER` (100% populated, second granularity, ties up to 23 / 90 / 28 rows, dictionary type `H` datetime); `TGFTAB.DTALTER`/`DTVIGOR`; `TGFEXC.DHALTREG` (51.5%). `TGFNTA` has no timestamp. Many rows share a timestamp (bulk-modification history), so ties are real, not theoretical (F-29).
- The cursor must be composite `(timestamp, full primary key)` (F-30); a single-column tie-breaker lost a row on `TGFEXC` (composite PK).
- **Not proven (needs a controlled non-production edit, outside S1):** that `DTALTER` changes on every kind of edit (including batch routines, imports, triggers or direct SQL), that it is server-side, and its time zone. Until then a `DTALTER` cursor is an **optimization** to be complemented by a periodic full reconcile (hash diff) — consistent with SYNC-2 and DATA-3 (both PROPOSED), not a new decision.
- Deletion: soft inactivation via `ATIVO` (F-32). The Sandbox declares foreign keys from other tables to the masters, so referenced rows cannot be deleted; unreferenced rows may be. An absent row in a full snapshot is the only observable delete signal (NEEDS VALIDATION whether Sankhya deletes physically in production, and whether a deletion log exists).

### 9.33 Architectural inputs derived from S1

Status: ARCHITECTURAL DECISION INPUT — NOT APPROVED. Owner/architect to evaluate against SNK-1/SNK-2 (PROPOSED) and record in `decisions.md`; none of it binds now.

1. **Read mechanism.** Measured: only `DbExplorerSP` SQL with explicit `ORDER BY <full PK>` gave complete, deterministic full reads; unfiltered REST and `loadRecords` reads lost rows. Options: (a) SQL via `DbExplorerSP` for mirror reads (requires the production integration user to be permitted to use it, and is dialect-dependent — Oracle in the Sandbox; production dialect NEEDS VALIDATION); (b) `loadRecords` restricted to `DTALTER`-windowed reads plus a keyset/PK reconciliation; (c) REST lists only with a completeness check against a count. Recommendation: **do not use an unfiltered REST/`loadRecords` crawl as the only read of any mirror entity**; whichever mechanism is chosen, every full or incremental read needs a completeness check (count / key-set comparison) and must fail closed on mismatch. Whether ad-hoc SQL is acceptable as a normal integration surface is an owner decision (security/support implications of a raw-SQL service in the worker: read-only account, allow-listed statements → `security-reviewer`).
2. **Incremental strategy per entity (proposal):** Partner and Product — composite keyset `(DTALTER, PK)` with an overlap window plus a scheduled full reconcile; Seller — full read each cycle (83 rows); Price — full snapshot of `TGFEXC` plus content-hash diff, version resolved by `TGFTAB.DTVIGOR`; derived-price tables resolved per S2.
3. **Mirror must model `ATIVO`** and never hard-delete on absence from one read; mark stale only after a confirmed full reconcile.
4. **Mirror the price version** (`NUTAB`, `DTVIGOR`) and store "no price" distinct from `0` (the REST bulk endpoint cannot).
5. **Time handling:** store the raw timestamp string and interpret it in one configured zone once verified (NEEDS VALIDATION).

### 9.34 Performance (Sandbox, measured)

| Read | Volume | Pages / requests | Time | Errors |
|---|---|---|---|---|
| SQL `TGFPAR` full | 5,992 rows | 12 pages × 500 | 108–169 ms per page | none |
| SQL `TGFPRO` / `TGFVEN` full | 3,993 / 83 | few pages | not itemized per page | none |
| SQL `TGFEXC` full | 6,279 rows | 7 × 1,000 | 98–196 ms per page, identical on 2 runs | none |
| REST price `CODTAB` 5 full | 3,790 rows | 76 pages (× 2 runs) | 214–364 ms per page | none |
| REST / `loadRecords` list crawls | ≈ 5.9k partners, ≈ 4k products | ≈ 117 / 120 / 80 pages | not itemized per page | none, apart from the 404 after the last `vendedores` page |

A full Sandbox mirror of the four entities through SQL is on the order of tens of requests, which supports a daily full reconcile inside a night window; production volume and the effect of parallelism/limits are NEEDS VALIDATION (S0.2, S1.5).

### 9.35 Minimum read contracts for the first UI slice (documentation only)

Source column = Sankhya column confirmed in the Sandbox dictionary (`TDDCAM`). "Null" = null count measured in the Sandbox. Availability: **AVAILABLE** (read and mapped), **PARTIAL**, **UNAVAILABLE** (another spike unresolved). Blueprint screens W-07, W-08, W-14 were used only to choose fields.

**Seller identity / scope**

| Field | Source | Type | Null / evidence | Availability |
|---|---|---|---|---|
| sellerCode | `TGFVEN.CODVEND` | integer | PK | AVAILABLE |
| displayName | `TGFVEN.APELIDO` | string | 0 null of 83 | AVAILABLE |
| active | `TGFVEN.ATIVO` | S/N | never null | AVAILABLE |
| managerCode | `TGFVEN.CODGER` | integer | 29 = 0, 3 self-referencing | AVAILABLE (0 = none; hierarchy vs. R35/R36 UNDECIDED) |
| partnerCode / company | `TGFVEN.CODPARC` / `CODEMP` | integer | 83 / 81 populated | AVAILABLE |
| sellerType | `TGFVEN.TIPVEND` | string | 74 null (52 of 61 active); dictionary labels S/R/C/E/G/V/T (F-37) | AVAILABLE; cannot identify sellers (mostly null) |
| Sankhya user ↔ seller link | `TSIUSU.CODVEND → TGFVEN.CODVEND` (FK) | integer | 54 of 69 users linked, ≤ 1 seller per user, 1 seller with 2 users; no partner route; no active flag (F-33, F-34) | AVAILABLE as a Sankhya-side reference only; Sales Force account ↔ `CODVEND` mapping is an open design decision (§9.36 item 11) |
| portfolio scope of a seller | `TGFPAR.CODVEND` | integer | never null, 937 = 0 | AVAILABLE as the partner's assigned seller; whether it is the portfolio rule is a business decision (open) |

**W-07 Customer portfolio (list) and W-08 Customer detail**

| Field | Source | Type | Null / evidence | Availability |
|---|---|---|---|---|
| customerCode | `TGFPAR.CODPARC` | integer | PK, 5,992 | AVAILABLE |
| isCustomer | `TGFPAR.CLIENTE` | S/N | 5,851 = S | AVAILABLE |
| tradeName | `TGFPAR.NOMEPARC` | string | 0 null | AVAILABLE |
| legalName | `TGFPAR.RAZAOSOCIAL` | string | 44 null | AVAILABLE |
| taxId | `TGFPAR.CGC_CPF` | string | 1 null | AVAILABLE (sensitive; masking per `security-model.md`) |
| personType | `TGFPAR.TIPPESSOA` | F/J | never null | AVAILABLE |
| active | `TGFPAR.ATIVO` | S/N | never null | AVAILABLE |
| blocked flag | `TGFPAR.BLOQUEAR` | S/N | column exists; values not measured | NEEDS VALIDATION (S4) |
| sellerCode | `TGFPAR.CODVEND` | integer | never null | AVAILABLE |
| city / address | `TGFPAR.CODCID`, `CODEND`, `NUMEND`, `CODBAI`, `CEP` | integer/string | `CODCID` 1 null; lookup tables not measured | PARTIAL — lookups NEEDS VALIDATION |
| phone | `TGFPAR.TELEFONE` | string | 275 null | AVAILABLE |
| e-mail | `TGFPAR.EMAIL` | string | null on all 5,992 | UNAVAILABLE here (contacts source NEEDS VALIDATION) |
| price table | `TGFPAR.CODTAB` | integer | 531 null of 5,851 customers (531 of the active ones); the partner's table on 12,991 of 13,025 comparable historical items (F-40) | AVAILABLE as the observed table; fallback for null `CODTAB` NEEDS VALIDATION (S2.1) |
| credit limit | `TGFPAR.LIMCRED` | number | 227 null | AVAILABLE as a limit only |
| **available credit** | — | — | needs open titles and orders | UNAVAILABLE (S4.3) |
| **overdue titles** | `TGFFIN` (not read by S1) | — | — | UNAVAILABLE (S4, Q-02) |
| **last purchase / history** | `TGFCAB` (not read by S1) | — | — | UNAVAILABLE (Q-02) |
| pipeline status (`lead … cliente`) | Sales Force | — | not a Sankhya field (P-19) | Sales Force owned |
| changedAt (sync) | `TGFPAR.DTALTER` | datetime | 100% populated | AVAILABLE (bump-on-edit NEEDS VALIDATION) |

**W-14 Product catalog**

| Field | Source | Type | Null / evidence | Availability |
|---|---|---|---|---|
| productCode | `TGFPRO.CODPROD` | integer | PK, 3,993 | AVAILABLE |
| description | `TGFPRO.DESCRPROD` | string (≤ 100) | 0 null | AVAILABLE |
| group | `TGFPRO.CODGRUPOPROD` → `TGFGRU` | integer | 0 null, 0 orphans | AVAILABLE (group description lookup not itemized) |
| unit | `TGFPRO.CODVOL` → `TGFVOL` | string | 0 null, 0 orphans | AVAILABLE |
| brand | `TGFPRO.MARCA` | string | 3,877 populated (116 null) | AVAILABLE |
| reference | `TGFPRO.REFERENCIA` | string | 1,580 populated | AVAILABLE |
| NCM | `TGFPRO.NCM` | string | 3,967 populated | AVAILABLE |
| active | `TGFPRO.ATIVO` | S/N | 3,789 S / 204 N | AVAILABLE |
| product use / sellable candidate | `TGFPRO.USOPROD` | string(1) | 9 observed values (`V`, `2`, `M`, `R`, `C`, `S`, `E`, `3`, `1`), never null; labels for 15 options in the dictionary, `S` and `3` unlisted (F-35, F-36) | AVAILABLE as a raw code to mirror; the sellable rule (candidate `ATIVO='S'` and `USOPROD` in (`V`,`R`), corroborated by price coverage) is NOT decided — NEEDS VALIDATION (§9.36 item 12) |
| weight / features | `TGFPRO.PESOBRUTO`, `CARACTERISTICAS`, `COMPLDESC` | number/string | not measured | NEEDS VALIDATION |
| image | — | — | no image column measured | UNAVAILABLE (P-17 blob store) |
| EAN / barcode | `TGFBAR` | — | only 17 rows | UNAVAILABLE for practical use |
| stock quantity | — | — | out of scope (P-01/P-13) | NOT IN SCOPE |
| cost / margin | — | — | never to external representatives (P-20) | NOT PART OF THIS CONTRACT |

**List price**

| Field | Source | Type | Evidence | Availability |
|---|---|---|---|---|
| priceTableCode | `TGFNTA.CODTAB` | integer | 8 tables, all active; `CODTAB` 7 and 8 have no version (REST 400) | AVAILABLE |
| priceVersion | `TGFTAB.NUTAB` (+ `DTVIGOR`) | integer / date | 12 versions; effective = latest `DTVIGOR ≤ now` per `CODTAB` (F-39); superseded versions stay stored | AVAILABLE — VALIDATED (env) rule |
| unitPrice | `TGFEXC.VLRVENDA` for `(NUTAB, CODPROD)` | number | 6,279 rows; equals REST for the effective version (F-27, F-39); no zero/null row in `NUTAB` 13 (F-42) | AVAILABLE for tables with `TGFEXC` rows |
| derived price | `TGFTAB.PERCENTUAL` on `CODTABORIG` (origin **logical table**) | number | origin effective price × (1 + `PERCENTUAL`/100): 44 of 44 per table on `CODTAB` 2 and 9 (F-41) | AVAILABLE — multiplicative rule VALIDATED (env) on the sample; rounding, chains, origin-version choice NEEDS VALIDATION; the REST price read remains the safe reference |
| price state | absence of a `TGFEXC` row vs explicit `0` | — | REST shows `0` for both (F-42); SQL distinguishes them; 2,183 of 3,789 active products have no row in `NUTAB` 13 | AVAILABLE via SQL only; store "no price" distinct from `0` (§9.33 item 4); UI treatment NEEDS VALIDATION (business) |
| changedAt | `TGFEXC.DHALTREG` / `TGFTAB.DTALTER` | datetime | 51.5% / populated | PARTIAL |
| **transactional order price / taxes / rounding** | — | — | S2 measured list price only; 1,102 of 9,270 `P` and 798 of 4,045 `V` historical items differ from the table price (cause unproven) | UNAVAILABLE (S2.1–S2.4; order pricing belongs to S3) |
| **which table applies to a customer or order** | `TGFPAR.CODTAB` | integer | observed rule on 99.7% of comparable items (F-40); 34 exceptions and null-`CODTAB` customers unexplained | AVAILABLE as the observed table; fallback, exceptions, `TSIPAR.TIPTABPRECOS` = 4 NEEDS VALIDATION (S2.1) |

### 9.36 Remaining S1 gaps and proposed follow-up (not decided)

Status: NEEDS VALIDATION — mapped to existing spikes; owner decisions are proposals only.

1. Whether `DTALTER` / `DHALTREG` change on every kind of update, and their time zone — needs a controlled non-production edit (write capability, S3-side) → S1.2 stays PARTIALLY VALIDATED.
2. Physical deletion of unreferenced masters and any deletion log → S1.3.
3. Root cause of the tail defect and omitted rows in unfiltered REST/`loadRecords` reads, and whether it occurs in production → S1.1.
4. Whether the production integration user may use `DbExplorerSP`, and the production database engine/dialect → S0.2/S1.1; a production check is only possible inside an owner-authorized §8 inspection.
5. Request quota and concurrency → S0.2, S1.5, §5.
6. Price resolution — **refined by the S2 session (§9.37)**: list-price rules for `PERCENTUAL`/`CODTABORIG`, `valor 0`, vigência and the partner table are measured (F-39–F-42). Still open → S2.1/S2.3/S3: fallback for customers with a null `CODTAB`, the 34 historical exceptions, `TSIPAR.TIPTABPRECOS` = 4, derived-price rounding, transactional order price and taxes.
7. Seller scope: **refined** — the Sankhya-side link is measured (`TSIUSU.CODVEND → TGFVEN.CODVEND`, F-33, F-34); what remains is the Sales Force account ↔ `CODVEND` mapping (item 11) and the portfolio rule (`TGFPAR.CODVEND`, business decision open) → access design.
8. Available credit, overdue titles, last purchase; whether `TGFFIN`/`TGFCAB` are mirrored in Phase 0 → S4.3, Q-02.
9. `pagina=0` — **resolved** for the price endpoint (HTTP 400, F-43). Still open: REST time-filter support and contact e-mail location → S1.2.
10. Owner/architect decision on the read mechanism (§9.33) → SNK-1/SNK-2 remain PROPOSED.
11. Proposal, NOT APPROVED — Sales Force account ↔ seller mapping. A Sales Force login is its own account (RF-IAM-1) and is not a Sankhya user. Measured: the Sankhya user table links to sellers (F-33), but 15 of 69 users are unlinked, one seller has 2 users, there is no partner route and no active flag (F-34), and the Sales Force e-mail has no documented relation to any `TSIUSU` column. Option A (draft `RF-IAM-4`): a Sales Force-owned mapping set by an admin, `sales-force user → CODVEND`, validated against the mirrored `TGFVEN` (exists, active); `TSIUSU` is not needed for scope. Option B: derive it from `TSIUSU` by matching e-mail/login — no documented rule and it needs heuristics; not recommended. Owner to decide (the mapping direction, whether one seller may map to several accounts, and how a hierarchy/`CODGER` applies, are undocumented → R35/R36 UNDECIDED, `RF-IAM-4`/`RF-IAM-5` draft).
12. Proposal, NOT APPROVED — W-14 sellable filter. Candidate rule to confirm with the business: `TGFPRO.ATIVO='S'` and `USOPROD` in (`V` Venda (fabricação própria), `R` Revenda), corroborated by measured price coverage (F-36: 1,604 of the 1,606 priced active products in `CODTAB` 5 are `V`/`R`); to keep configurable until confirmed; `S` (21) and `3` (2) unlisted in the dictionary, and `D` Revenda (por fórmula) is listed but unused. Questions: are `2`/`M`/`C`/`E` never sold; may a product with `USOPROD` outside `V`/`R` appear in an order; is a product without a price in the customer's table hidden or shown "no price" (S2). **S2 measured (F-42):** in `CODTAB` 5 (effective `NUTAB` 13) 1,606 of 3,789 active products have a positive price row, 1,604 of them `V`/`R`; 86 active `V`/`R` products (72 `V`) have no row, and REST reports them as `valor 0` — so a "priced" filter must be computed from `TGFEXC` (or treat REST `0` as "no price"), never from the product flag alone. Owner still to decide the UI treatment of a missing price and the sellable values.

13. Remaining S2 gaps (Sandbox, NEEDS VALIDATION), by impact: **blocks first UI** — none for a read-only catalog priced from `CODTAB` 5 via the partner's table, but customers with a null `CODTAB` (531 active) have no defined table → the UI must show "table not defined" or use an owner-approved default (NOT APPROVED); business meaning of a missing price. **Blocks order creation (S3)** — refined by the S3 test (§9.38): the transactional price of one item equalled the list price (F-46), so the remaining open items are why `VLRUNIT` ≠ table price on ≈ 11–20% of historical items (discount/negotiation, mechanism unproven; discount write path untested), rounding (S2.3, quantity 1 only), taxes before an order exists (S2.4; IPI at insertion is a HYPOTHESIS, F-47), company/TOP/payment/quantity/region dependence, minimum price and maximum discount (S2.1), what selects the table for the 34 exceptions, decoding `TSIPAR.TIPTABPRECOS` = 4. **Can wait** — chains of derived tables, `CODTABFLEX`/`FORMULA`, future-dated versions, alternate-unit rows on a single read, inactive product with a price row.

**Recommended next spike (refined after S3):** S4.3 (credit/overdue) and S0 with the Sankhya partner for the origin-id field and native idempotency (V-11, V-13); then, in a second authorized Sandbox test, the origin-id write, confirmation and cancellation of a confirmed order. See §9.40.

### 9.37 S2 — list-price resolution, measured (Sandbox, read-only)

Session 2026-09-18. Environment: Sandbox only (production untouched). **14 HTTP requests: 2 `/authenticate` + 5 `DbExplorerSP` SQL + 7 REST GET** (budget 15); sequential, no HTTP 429 or expiry; the only non-200 response was the deliberate `pagina=0` (HTTP 400). No write, no raw capture kept in the repository, no credential or token recorded. Results are aggregates and codes only; person-named table labels are not reproduced.

**Measured (each maps to a row F-38–F-43):**

| Question | Result | Fact |
|---|---|---|
| Structure and keys | `TGFNTA(CODTAB)` → `TGFTAB(NUTAB; FK CODTAB, CODTABORIG → TGFNTA)` → `TGFEXC(NUTAB, CODPROD, CODLOCAL, CONTROLE)`; `TGFITE.NUTAB → TGFTAB` | F-38 |
| Table 5 effective version | `NUTAB` 13 (`DTVIGOR` 17/08/2026); `NUTAB` 11 (01/01/2026) superseded but stored; REST page 1 = `NUTAB` 13 on 44/44 (page cannot discriminate v11/v13); full-table proof in F-27 | F-39 |
| Version rule | latest `DTVIGOR ≤ current DB date` per `CODTAB`; 13,375 historical items follow "latest ≤ `DTNEG`"; DB clock UTC−03:00 | F-39 |
| Customer → table | `TGFPAR.CODTAB` = the item's table on 12,991 of 13,025 comparable items; 34 exceptions; null `CODTAB` on 531 active customers; every other candidate column empty | F-40 |
| Derived / `PERCENTUAL` | `CODTAB` 2 = `CODTAB` 3 × 1.5 (44/44 within 0.005); `CODTAB` 9 = `CODTAB` 5 × 2 (44/44 exact); no own `TGFEXC` rows | F-41 |
| Zero / missing | no zero/null row in `NUTAB` 13; 2,183 of 3,789 active products have no row; REST `0` for no-row and explicit-zero alike | F-42 |
| `pagina=0` | HTTP 400, empty body | F-43 |

**Minimum LIST-PRICE contract (Sandbox scope): VALIDATED (env) for the observed rule on the Sandbox sample (LIST PRICE of a price table).** For `(customer, product)` the list price is: (1) `codtab = TGFPAR.CODTAB` of the customer; (2) the effective `NUTAB` = latest `DTVIGOR ≤ now` among `TGFTAB` rows of `codtab`; (3) if that version has `CODTABORIG` + `PERCENTUAL`, take the origin table's effective price × (1 + `PERCENTUAL`/100), else the `TGFEXC.VLRVENDA` of `(NUTAB, CODPROD)`; (4) no `TGFEXC` row → "no price" (REST would show `0`). This is a **description of measured behavior**, not an approved Sales Force rule; scope limits: 8 Sandbox tables, `CODTAB` 5 measured in full, derived tables on 44 products each, unit/alternate-unit and inactive-product behavior partly untested.

**NOT validated (NEEDS VALIDATION):**
- Transactional order price (the price Sankhya assigns to an item of a created document) — **refined by S3 (§9.38, F-46): one created item equalled the list price; the general rule remains NEEDS VALIDATION.** Descriptive only: 1,102 of 9,270 `P` and 798 of 4,045 `V` items have `TGFITE.VLRUNIT` ≠ the `TGFEXC` price of their version; cause unproven (HYPOTHESIS only: discount, later table change or manual edit).
- Fallback table for customers without `CODTAB`; the 34 items using another table (candidates unproven: `TSIPAR` defaults, a non-`TGFPAR` selector); decoding of `TSIPAR.TIPTABPRECOS` = 4 (label "Tabela de Preços por: Única / Região do Vendedor / Região do Par…").
- Rounding (`TGFNTA.DECVENDA` = 0 on all 8 tables; `USADECPREC` has no value), derived-price rounding mode, chains of derived tables, `CODTABFLEX`, `FORMULA`, future-dated versions, `DTALTER` bump semantics on `TGFTAB`, time zone.
- Dependence on company, TOP, payment/negotiation type, region, quantity range, minimum price and maximum discount; taxes (S2.4). Values are Sandbox data and may not reflect the production configuration.

**Implication for W-14 (Product Catalog), NOT APPROVED, for owner/architect:** the catalog price column is READY for a read-only price by the customer's own `CODTAB` (list price only, labeled as list price, never as the order price); PARTIALLY READY overall because of the null-`CODTAB` customers and the missing-price treatment. The mirror needs the version model (F-39, §4) and must store "no price" separately from `0` (§9.33 item 4). Order pricing stays out of the UI until S3 and P-09 (`revisao_preco`) apply.

---

### 9.38 S3 — controlled order creation (Sandbox, exactly one order write)

Session 2026-09-18. Environment: **Sandbox only** (`api.sandbox.sankhya.com.br`; the host was hard-coded and asserted in the scripts, any other host aborted the run). Credentials were read from environment variables at run time, never printed, never written to disk or to this document. Production untouched (§8 unchanged). No raw capture kept in the repository; results are codes and aggregates only. Customer, seller, product and company are referenced by code (`TEST_PARTNER_234`, seller `CODVEND` 5, product `CODPROD` 4186, `CODEMP` 1).

**Governance gate (before the write).** The owner explicitly authorized **one** controlled Sandbox order write with cleanup (owner instruction, precedence 1); SNK-3/U-04 make one real order write in a non-production environment mandatory before the pilot; P-15 permits the Sandbox as the SNK-3 non-production environment. SNK-4 says "no real order write before S0 validation" and `sankhya.md` gates writes on V-11/V-13. **Interpretation (owner to confirm):** these gates bind the *integration* write path (worker/outbox, Sales Force orders); this one manual, owner-authorized spike write in the Sandbox is the validation SNK-3/U-04 require. No raw SQL `INSERT`/`UPDATE`/`DELETE`, no direct table writes, no DDL and no custom-field creation were performed — the only write was the supported service call. Cleanup was allowed to be exactly one attempt per supported mechanism.

**HTTP requests (all against the Sandbox): 25 of the 25 allowed.**

| Kind | Count | Notes |
|---|---|---|
| `/authenticate` | 5 | token expires in 300 s; one token per script run |
| `DbExplorerSP.executeQuery` reads (SELECT only) | 17 | 15 pre-/post-write + 1 cleanup verification + 1 final dictionary recheck |
| Order write (`CACSP.incluirNota`) | **1** | the only order creation — no second order, no deliberate duplicate |
| Cleanup calls | 2 | `CACSP.cancelarNota` ×1, `CACSP.excluirNotas` ×1 |

No HTTP 429, no `Retry-After`, no error status; all 25 answers were HTTP 200. The budget was consumed in full; **no server-side limit was hit**. A gateway `status` "0" was not observed on any call in this session (only the earlier S1 `DbExplorerSP` SQL errors, F-19).

**Pre-write contract (sources and what was checked).** The service shape came from the official documentation (`CACSP.incluirNota`, `INFORMARPRECO`; docs: VALIDATED (docs)), the `TGFCAB`/`TGFITE` dictionary and NOT NULL catalog (70 and 37 NOT NULL columns), and historical TOP 1001 documents. Checked read-only before writing: TOP 1001 is `TIPMOV` P, its current version stamps `DHTIPOPER`; the customer is active with a `CODTAB`; the seller and product are active; payment type 11 is active; `CODEMP` 1 exists; the effective `NUTAB` 13 list price exists for the product; product `DESCMAX` = 12; the local `CODLOCALORIG` 207 and unit `PT` come from the product's historical items. Historical prices for the product are mostly the list price with a separate `PERCDESC` (1 of 20 sampled items carried a lower `VLRUNIT`, 15.61, with `PERCDESC` 0).

**Request shape (sanitized, F-44).** `POST /gateway/v1/mgecom/service.sbr?serviceName=CACSP.incluirNota&outputType=json`, `requestBody.nota.cabecalho` = `NUNOTA` (empty), `CODPARC`, `DTNEG`, `CODTIPOPER`, `CODTIPVENDA`, `CODVEND`, `CODEMP`, `TIPMOV`, `OBSERVACAO` (test marker `SF-S3-TEST-<yyyyMMddHHmm>`); `requestBody.nota.itens` = `INFORMARPRECO` "False" + one `item` (`NUNOTA` empty, `IGNOREDESCPROMOQTD`, `CODPROD`, `QTDNEG`, `CODLOCALORIG`, `CODVOL`); each value wrapped as `{"$": "<value>"}`. Answer: `status` "1", `responseBody.pk.NUNOTA.$` = **2475**, `transactionId`. Dates use `dd/MM/yyyy`.

**Read-back (SQL, ~300 ms after the write; F-45–F-49).**

| Object | Result |
|---|---|
| `TGFCAB` | 1 header; `STATUSNOTA` A, `PENDENTE` S, `TIPMOV` P, TOP 1001, `CODTIPVENDA` 11, `VLRNOTA` 18.03; `DHTIPOPER` 12/08/2026 13:38:57 and `DHTIPVENDA` 10/07/2026 11:35:00 stamped as the current versions; marker lookup in `OBSERVACAO` = 1 row |
| `TGFITE` | 1 item; `VLRUNIT` 16.43 = list price of `NUTAB` 13; item total 16.43 |
| `TGFFIN` | 1 title; `VLRDESDOB` 18.03 = `VLRNOTA`; due 18/09/2026 (= `DTNEG`) |
| `TSILIB` | 0 rows for the header |
| Totals | 18.03 = 16.43 + 1.60; the 1.60 is inferred to be IPI (HYPOTHESIS, F-47) |

**Hypothesis (not a rule):** the difference between this order's totals (with IPI) and the historical F-12 closure without IPI is caused by the TOP 1001 definition change of 12/08/2026 — unproven (HYPOTHESIS).

---

### 9.39 S3 — idempotency, origin-id and retry: findings and input (NOT APPROVED)

**Measured (F-52, dictionary only).** `TGFCAB` has no unique index besides the PK; no candidate origin-id column has an index or uniqueness; nullable custom fields exist (`AD_VDYORIG`, `AD_NUVIDYA` VARCHAR2(100) — capacity for a 36-character UUID; `AD_OFFLINE`, `AD_STATUS`, `AD_OBS`, `AD_OBSINTERNA`, two `AD_` dates); `OBSERVACAO` is free text (4000). **Not measured:** that `incluirNota` writes an `AD_` header value (needs a second order), that a lookup by such a field is fast (it is a full-scan without an index), what values the Vidya Force fields carry, whether any native idempotency exists (V-13; the `transactionId` is not an input of the contract). The marker lookup in `OBSERVACAO` (F-49) proves only that an exact-match read-back works, **not** that `OBSERVACAO` is an acceptable origin-id — SNK-4 allows it only as an owner-authorized emergency fallback (U-05/U-06).

**ARCHITECTURAL DECISION INPUT — NOT APPROVED** (for `architect` / owner; nothing here changes SNK-4):

1. Identifier: the Sales Force order UUID, stable across retries (U-07); an attempt or job id is never used.
2. Field: a dedicated custom `TGFCAB` field agreed with the Sankhya partner (V-11). Options: (a) a new field with a supporting index requested from the partner; (b) reuse `AD_VDYORIG`/`AD_NUVIDYA` — capacity fits, but they appear (HYPOTHESIS, from their names) to belong to the outgoing Vidya Force flow and may collide or be overwritten while both systems run; owner and partner to decide.
3. Outbox state machine (worker): `pending → sending → confirmed (NUNOTA stored) | rejected (permanent) | unknown`. The outcome is `unknown` on any timeout, dropped connection or 5xx after the request left — never `failed`.
4. Before any retry (and on `unknown`): a `SELECT` on the origin-id field (through the same gateway) → found: adopt its `NUNOTA`, do not write; not found and the lookup succeeded: the write may be retried; lookup impossible: stay `unknown` and alert. No matching by customer/date/total (SNK-4).
5. Persist `NUNOTA` from `responseBody.pk.NUNOTA.$` in the same transaction that closes the outbox row; read back header, item count and title count to confirm.
6. Classification (to confirm — the `incluirNota` error format was **not** observed, so this is NEEDS VALIDATION): HTTP 200 + `status` "1" + `NUNOTA` = success; a business/validation answer = permanent, no retry; 403 `GTW3403` = renew token and repeat the *lookup first* (F-31); 5xx/timeout = `unknown`. Never treat HTTP 200 alone as success (F-50).

---

### 9.40 S3 — cleanup, final Sandbox state and blockers

**Cleanup (one attempt per supported mechanism, no loops).** (1) `CACSP.cancelarNota` on NUNOTA 2475: HTTP 200, `status` "1", `totalNotasCanceladas` "0" (F-50); (2) `CACSP.excluirNotas`: HTTP 200, `status` "1", empty body (F-51; format from a third-party SDK — evidence level: third party, worked in the Sandbox); (3) one read-back: `TGFCAB` 0, `TGFITE` 0, `TGFFIN` 0, `TGFCAN` 0 for NUNOTA 2475, 0 headers with the test marker. **Result: DELETED AS EXPECTED. The test order does not remain in the Sandbox.** The sequence proves that cancellation is not the cleanup path for an unconfirmed order and that deletion leaves no cancellation record; this is a non-production, owner-authorized removal and is not a production compensation pattern.

**Contracts recorded (VALIDATED (env), one order):** creation (F-44), pending state (F-45), item price (F-46), totals (F-47), title (F-48), NUNOTA at `responseBody.pk.NUNOTA.$` (F-44), cancel no-op semantics (F-50), delete (F-51).

**Remaining blockers before the order write path (Phase 1):**

| Item | Class |
|---|---|
| Origin-id field: existence/creation, writing it via `incluirNota`, indexing/lookup cost (V-11, S0.4) | **Blocks implementation of the write path** |
| Native idempotency (V-13) — a repeated request was not allowed here | **Blocks implementation of the write path** (SNK-4 D is additive; B alone can proceed once its field is validated) |
| `incluirNota` error/rejection format and mandatory-field errors; minimum set | **Blocks implementation of the write path** (needed to classify permanent vs transient) |
| Confirmation (`confirmarNota`), `TSILIB` releases, invoicing, cancellation of a confirmed order (S3.2–S3.4, S4) | Can wait until order status tracking is designed; a second authorized Sandbox test |
| General transactional price, rounding, discounts, tax simulation (S2.1–S2.4) | Can wait for pricing work; pricing rules are P-09 territory |
| Read mirror in Phase 0 | **Not blocked** by S3 (`roadmap.md` 0.8 is reads only; the write path is gated by V-11/V-13) |
| Owner decisions: confirm the governance interpretation in §9.38; which TOP/company/payment type Sales Force orders use (S0.4); reuse vs new origin-id field; authorize a second Sandbox test if wanted | Owner decision |

**Recommendation (not a decision):** the implementation gate may be opened for Phase 0 scope (no Sankhya writes; read mirror per S1); the order write path stays out of scope until V-11 and V-13 are closed.

---
