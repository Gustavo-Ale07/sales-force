# Sales Force — Claude Code Project Instructions

## 1. Project Mission

This repository contains **Sales Force**, an internal, single-tenant commercial platform for an industrial company.

The system has two primary goals:

1. Replace **Vidya Force** with an integrated sales-force application connected to Sankhya ERP.
2. Replace **Agendor** with an internal CRM integrated with the same commercial, financial and customer data.

The final platform combines:

- sales force;
- customer portfolio;
- customers and contacts;
- quotations and orders;
- commercial approvals;
- financial information;
- goals, positivization and commissions;
- CRM;
- leads;
- opportunities;
- pipelines;
- proposals;
- activities and follow-ups;
- automations;
- dashboards;
- integrations;
- offline mobile operation;
- AI-assisted workflows.

This is a real production-oriented business system.

It is not a prototype, demo, disposable MVP, tutorial project or generic CRM template.

---

# 2. Authoritative Documentation

The following files define the project and MUST be treated as authoritative:

- `docs/project-spec.md`
- `docs/architecture.md`
- `docs/decisions.md`
- `docs/roadmap.md`
- `docs/sankhya-spike.md`
- `docs/security-model.md`
- `docs/sync-protocol.md`

Do not silently contradict these documents.

When working on a feature, load only the relevant documents necessary for the task.

## Required context by subject

### Architecture

Before making architectural changes, read:

- `docs/architecture.md`
- `docs/decisions.md`

### Sankhya

Before implementing or modifying Sankhya integration, read:

- `docs/sankhya-spike.md`
- `docs/architecture.md`
- relevant sections of `docs/project-spec.md`

### Offline synchronization

Before changing synchronization behavior, read:

- `docs/sync-protocol.md`
- `docs/security-model.md`
- relevant domain rules

### Security, authentication and authorization

Read:

- `docs/security-model.md`
- `.claude/rules/security.md`
- relevant permission requirements in `docs/project-spec.md`

### Database

Read:

- `docs/architecture.md`
- `.claude/rules/database.md`
- `docs/sync-protocol.md` when synchronized entities are involved

### Frontend

Read:

- `.claude/rules/frontend.md`
- relevant feature requirements
- relevant UX flows

### Backend

Read:

- `.claude/rules/backend.md`
- architecture boundaries
- relevant feature requirements

### Testing

Read:

- `.claude/rules/testing.md`
- the testing strategy in `docs/project-spec.md`

---

# 3. Conflict Resolution

If project instructions conflict, follow this order:

1. explicit instruction from the user for the current task;
2. approved decisions in `docs/decisions.md`;
3. project specification in `docs/project-spec.md`;
4. architecture documents;
5. security and synchronization documents;
6. `.claude/rules/*`;
7. implementation conventions already established in the repository.

If two authoritative project documents contradict each other:

DO NOT silently choose one.

Report:

- the conflicting documents;
- the exact contradiction;
- expected impact;
- recommended resolution.

Wait for a decision when the conflict affects architecture, business rules, security, data integrity or user-visible behavior.

---

# 4. Approved Product Boundaries

The application is:

- internal;
- single-tenant;
- designed for approximately 20–100 users initially;
- designed for an industrial company;
- integrated with Sankhya Cloud;
- web + mobile;
- fully offline-capable for field representatives.

The project is NOT:

- a SaaS product;
- multi-tenant;
- a replacement ERP;
- an inventory management system;
- a route/check-in system;
- a B2B self-service portal.

Do not expand the scope without explicit approval.

---

# 5. System Ownership

## Sankhya is the system of record for ERP data

Sankhya remains authoritative for:

- customers/partners after approval;
- sellers;
- products;
- price tables;
- payment terms;
- operation types/TOP;
- orders and invoices;
- financial titles;
- goals;
- positivization;
- commissions.

## Sales Force is authoritative for CRM data

Sales Force owns:

- leads;
- prospects;
- CRM accounts before becoming Sankhya customers;
- opportunities;
- pipelines;
- proposals;
- activities;
- follow-ups;
- CRM interactions;
- automation rules;
- internal CRM metadata;
- CRM custom fields;
- AI metadata and usage records.

Never create competing sources of truth without an approved architectural decision.

---

# 6. Critical Architectural Rule

The mobile application and web frontend MUST NEVER communicate directly with Sankhya.

All Sankhya communication goes through:

Sales Force API / Worker
→ `SankhyaGateway`
→ Sankhya API

The package responsible for knowing Sankhya-specific formats, services and behavior is:

`packages/sankhya`

Do not spread Sankhya-specific implementation details throughout the codebase.

---

# 7. Approved Architecture

The system uses a **modular monolith**.

Do not introduce microservices unless an approved architectural decision explicitly changes this.

Expected monorepo structure:

```text
apps/
  api/
  worker/
  web/
  mobile/

packages/
  domain/
  db/
  mobile-db/
  contracts/
  sankhya/
  ui/
  config/
Responsibilities
apps/api
NestJS application responsible for:
- REST API;
- authentication;
- authorization;
- business orchestration;
- synchronization endpoints;
- inbound webhooks;
- OpenAPI.
apps/worker
Responsible for asynchronous and scheduled work:
- Sankhya synchronization;
- integration outbox;
- imports;
- automation execution;
- notifications;
- emails;
- PDF generation;
- batch AI operations;
- scheduled jobs.
apps/web
Next.js web application for:
- internal sellers;
- managers;
- directors;
- backoffice;
- administrators.
apps/mobile
Expo / React Native application focused primarily on field representatives and offline operation.
packages/domain
Contains pure business rules.
Examples:
- price calculations;
- discounts;
- approval authority;
- credit rules;
- order state transitions;
- proposal state transitions;
- opportunity state transitions;
- deduplication;
- automation domain rules.
packages/domain MUST NOT depend on:
- NestJS;
- Next.js;
- React;
- database drivers;
- Drizzle;
- Redis;
- HTTP;
- Sankhya;
- external APIs;
- infrastructure.
Domain logic must remain portable and testable.
packages/db
Contains:
- PostgreSQL Drizzle schema;
- migrations;
- database infrastructure shared by server applications.
packages/mobile-db
Contains:
- local SQLite schema;
- local migrations;
- offline persistence logic.
packages/contracts
Contains shared typed contracts:
- Zod schemas;
- DTO definitions;
- API contracts;
- synchronization protocol types.
packages/sankhya
Contains:
- SankhyaGateway;
- real implementation;
- fake implementation;
- fixtures and contract support;
- Sankhya-specific mapping.
packages/ui
Contains reusable web UI components.
packages/config
Contains shared configuration for:
- TypeScript;
- ESLint;
- formatting;
- build conventions.
8. Approved Technology Stack
Use the approved stack unless an explicit decision changes it.
Language
TypeScript with strict type checking.
Avoid any unless there is a documented and unavoidable reason.
Monorepo
- pnpm workspaces
- Turborepo
API
- NestJS
- REST
- Zod
- generated OpenAPI
Database
- PostgreSQL 16+
- Drizzle ORM
Queue / jobs
- Redis
- BullMQ
Web
- Next.js App Router
- React
- TanStack Query
- Tailwind CSS
- shadcn/ui
Mobile
- Expo
- React Native
- Expo Router
- SQLite
- SQLCipher where technically validated and supported
- SecureStore
- EAS Build / EAS Update
Do not assume SQLCipher integration details before the technical validation is complete.
Files
- MinIO
- S3-compatible API
PDF generation
HTML → PDF through Playwright/Chromium executed by the worker.
AI
- official Anthropic SDK
- backend only
API keys MUST NEVER reach web or mobile clients.
Observability
- structured JSON logs
- pino
- Sentry
- health checks
Infrastructure
- Docker Compose
- Caddy
- GitHub Actions
9. Phase Discipline
Development is divided into phases.
Do not prematurely implement functionality from later phases.
Phase 0 — Foundation
Includes:
- monorepo;
- CI;
- environments;
- authentication;
- roles;
- teams;
- basic auditing;
- Sankhya API client;
- incremental ERP mirror;
- Sankhya technical spike.
Phase 1 — Sales Force
Primary objective:
replace Vidya Force safely.
Includes:
- offline mobile;
- customer portfolio;
- financial information;
- product catalogue;
- prices;
- quotations;
- orders;
- customer approval;
- discounts;
- commercial approvals;
- goals;
- positivization;
- commissions;
- basic tasks;
- imports;
- integration health.
Phase 2 — CRM
Primary objective:
replace Agendor.
Includes:
- leads;
- pipelines;
- opportunities;
- proposals;
- interactions;
- follow-ups;
- automation;
- dashboards;
- migration from Agendor;
- Google integration.
Phase 3 — Intelligence and channels
Includes:
- configurable automation builder;
- internal AI assistant;
- summaries;
- next-action suggestions;
- product mix suggestions;
- churn indicators;
- AI-assisted imports;
- lead capture;
- ads integrations;
- telephony.
Phase 4 — Future scope
Includes:
- official WhatsApp Cloud API conversations;
- external customer chatbot.
Do not pull Phase 2–4 functionality into Phase 0/1 unless explicitly approved.
10. Mandatory Sankhya Spike
Do not invent Sankhya behavior.
Before implementing features that depend on Sankhya details, validate them through the Phase 0 spike.
The spike must establish:
- actual services/endpoints used;
- relevant Sankhya entities;
- price table resolution;
- mandatory order fields;
- TOP;
- company;
- payment terms;
- change detection;
- deletion detection;
- request limits;
- error behavior;
- homologation behavior;
- real response samples for tests.
Important expected tables include, but are not limited to:
- TGFPAR
- TGFVEN
- TGFPRO
- TGFTAB
- TGFEXC
- TGFCAB
- TGFITE
- TGFFIN
Do not assume that a table name alone defines the correct business API behavior.
Do not invent:
- TOP;
- company code;
- price rules;
- integration service names;
- mandatory fields;
- commission tables;
- goal tables.
When unknown, mark them as a spike dependency.
11. Offline-First Design
Offline operation is a core requirement, not an enhancement.
Field representatives must be able to work with unreliable or absent connectivity.
The local application stores only the subset of data authorized for that user.
Expected local data includes:
- portfolio accounts;
- contacts;
- applicable products;
- applicable prices;
- payment terms;
- operation types;
- financial summaries;
- recent sales history;
- goals;
- commissions;
- orders;
- tasks;
- future precomputed suggestions.
Sensitive server-side-only information must not be synchronized unnecessarily.
12. Synchronization Protocol
The synchronization protocol is a critical part of the architecture.
Consult:
docs/sync-protocol.md
before modifying it.
Pull
Expected conceptual endpoint:
GET /sync/pull
Synchronization is cursor-based using change_seq.
The server returns:
- upserts;
- deletes/tombstones;
- a new cursor.
Results MUST be filtered using the authenticated user's data scope.
A user must never receive records they are not authorized to access.
Records leaving the user's scope must eventually be removed from the local database.
Push
Expected conceptual endpoint:
POST /sync/push
Offline commands are stored in a local outbox.
Commands include a unique:
command_id
Commands MUST be idempotent.
Retrying the same command must not create duplicate effects.
The server MUST revalidate:
- authorization;
- prices;
- discount authority;
- credit;
- current state;
- business invariants.
Never trust decisions made only by the offline client.
13. Idempotency
Idempotency is mandatory for important write flows.
Especially:
- offline synchronization commands;
- Sankhya order creation;
- approved customer creation;
- integration retries.
A retry must never create duplicate orders or duplicate partners.
Do not rely only on HTTP retries or UI state to prevent duplication.
14. Price Integrity
Price comes from Sankhya-derived data.
Do not create an independent pricing engine unless an approved decision changes the architecture.
When an offline order was created with an older price and the server detects that the applicable price changed:
DO NOT silently replace it.
The order enters:
revisao_preco
The seller must see:
- previous price;
- current price;
- affected items.
After seller confirmation, commercial approval rules must be evaluated again.
15. Discount Approval
Discount authority is configured in Sales Force.
There are conceptually:
- seller limit;
- manager limit;
- director authority above manager limit.
Rules may have:
- defaults by profile;
- overrides per user.
Approval rules must be enforced server-side.
Never trust discount validation performed exclusively in web or mobile clients.
16. Credit Rules
Credit restrictions may be evaluated offline using the last synchronized data.
They MUST be revalidated by the server before final processing.
Potential blockers include:
- overdue financial titles;
- insufficient available credit.
Do not allow stale mobile information to override current server-side commercial rules.
17. Order State Integrity
Order states are domain rules.
Do not mutate order statuses arbitrarily.
Important conceptual states include:
- rascunho
- aguardando_aprovacao
- aprovado
- na_fila
- enviado
- faturado
- reprovado
- erro_integracao
- revisao_preco
- cancelado
State transitions belong in domain logic and must be tested.
Do not duplicate transition rules independently in multiple applications.
18. Account Lifecycle
A commercial account can move through:
lead
→ prospect
→ cliente_pendente
→ cliente
Possible alternate outcomes include:
- rejeitado
- inativo
Do not create separate competing company/customer tables without revisiting the approved account model.
Existing Sankhya customers have a Sankhya partner identifier.
CRM-only accounts may exist without one.
19. New Customer Approval
A seller may create a new customer request.
Before becoming a Sankhya partner, the customer must pass through the approved backoffice process.
Conceptual sequence:
seller creates account
→ cliente_pendente
→ backoffice/finance review
→ approved
→ Sankhya creation through integration outbox
→ cliente
A pending customer may have quotations.
A final Sankhya order must not be submitted before customer approval.
20. Permissions and Data Scope
Authorization uses:
- RBAC;
- data scope.
Expected scope types:
- proprio
- equipe
- tudo
Authorization is enforced SERVER-SIDE.
Never rely solely on:
- hidden UI;
- disabled buttons;
- frontend route guards;
- local mobile filters.
Synchronization endpoints MUST apply the same data-scope rules as normal API endpoints.
21. External Representative Restrictions
External representatives are autonomous/PJ users and require stronger restrictions.
They must never receive unauthorized:
- product cost;
- margin information;
- unrestricted data exports;
- data belonging to unrelated portfolios.
Do not merely hide these fields in the interface.
Do not send restricted fields to the client.
Representatives are explicitly prohibited from exporting general data.
22. Device Security
Mobile devices are security boundaries.
The system includes:
- device registration;
- server-side revocation;
- local data deletion after revocation when the device reconnects;
- maximum offline period;
- encrypted local storage.
The current maximum offline period is configurable, initially 7 days.
After exceeding it, the application must require synchronization before continued use.
23. Authentication
Current approved decision:
email + strong password.
Do not silently add, remove or redesign authentication mechanisms.
The absence of 2FA is an explicitly accepted project risk.
If security requirements materially change, propose revisiting the decision instead of silently changing it.
Web
Use secure session behavior consistent with the security specification.
Mobile
Use short-lived access tokens and rotating refresh tokens according to the security model.
Passwords must be hashed using Argon2id.
Never store plaintext passwords.
24. Security Rules
Security requirements are non-negotiable.
Always follow:
.claude/rules/security.md
Never:
- commit secrets;
- expose credentials;
- hardcode passwords;
- expose third-party tokens;
- log authentication tokens;
- send server credentials to clients;
- bypass authorization to fix a bug;
- weaken security controls for convenience.
Treat all external input as untrusted.
Validate all external data.
Use parameterized database access.
Apply least privilege.
25. Environment Separation
Staging and production must remain separate.
Staging connects to Sankhya homologation.
Production connects to Sankhya production.
Never mix:
- credentials;
- databases;
- queues;
- object storage;
- Sankhya environments.
Never use production credentials for tests or local development.
26. Database Rules
Follow:
.claude/rules/database.md
Primary database:
PostgreSQL.
Use Drizzle migrations for schema evolution.
Important conventions include:
- UUIDv7 identifiers where specified;
- logical deletion where defined;
- audit timestamps;
- actor fields;
- synchronization metadata;
- Sankhya source identifiers.
Use:
- numeric for monetary values;
- appropriate precision for quantities and percentages.
Never represent business-critical money using floating-point arithmetic.
27. Database Destructive Operations
Do not perform destructive database operations without explicit user approval.
This includes:
- DROP TABLE;
- TRUNCATE;
- irreversible column removal;
- bulk deletion;
- destructive production migrations;
- resetting production data.
If a migration could cause data loss, stop and explain the risk.
28. Migration Strategy
Production migrations must be compatible with rolling application changes whenever possible.
Prefer:
expand
→ migrate
→ contract
Do not introduce a migration that requires application and database changes to become valid at exactly the same instant unless unavoidable and explicitly reviewed.
29. Module Boundaries
API modules may interact through public application services.
Do not casually access another module's persistence internals.
Avoid cross-module database coupling that bypasses defined module boundaries.
If a new dependency between modules is needed:
1. determine ownership;
2. expose a public service or domain contract;
3. avoid direct internal table manipulation from unrelated modules.
30. Backend Rules
Follow:
.claude/rules/backend.md
General expectations:
- thin HTTP controllers;
- explicit validation;
- business logic outside transport code;
- clear application services;
- infrastructure separated from domain rules;
- explicit error handling;
- typed contracts;
- no silent failure.
Do not place core business logic directly in controllers.
31. Frontend Rules
Follow:
.claude/rules/frontend.md
The UI must look and behave like a professional B2B business application.
Avoid:
- generic AI-generated dashboards;
- decorative clutter;
- excessive gradients;
- unnecessary animations;
- inconsistent spacing;
- inaccessible custom controls.
Prefer:
- strong hierarchy;
- information density appropriate for business software;
- reusable components;
- keyboard usability;
- responsive design;
- clear filters;
- explicit loading states;
- explicit empty states;
- useful error states;
- accessible form controls.
Use the installed frontend-design skill for important UI design work.
Use web-design-guidelines when auditing interface quality.
32. Mobile Rules
The mobile application is offline-first.
Do not design it as a web application wrapped in a mobile shell.
Account for:
- intermittent connectivity;
- retries;
- synchronization indicators;
- pending operations;
- conflicts;
- local database migrations;
- constrained storage;
- device revocation;
- stale data;
- background/foreground transitions.
Never assume network availability.
33. Imports
Spreadsheet import must not directly write uncontrolled data into final business tables.
Imports follow a controlled workflow:
upload
→ mapping
→ validation
→ preview
→ confirmation
→ asynchronous processing
→ result report
Rows with errors must be identifiable.
Partial failures must not silently corrupt the import.
Supported formats include:
- XLSX
- CSV
Do not assume arbitrary spreadsheet layouts.
34. Files
Files are stored through MinIO / S3-compatible storage.
Do not store large generated files directly in relational database columns unless explicitly justified.
Store metadata in the database and object data in object storage.
35. Queue and Worker Responsibilities
Long-running or retryable work belongs in the worker.
Examples:
- Sankhya synchronization;
- Sankhya outbox;
- imports;
- email;
- PDF generation;
- scheduled automation;
- AI batches;
- notifications;
- reconciliation.
Do not hold API requests open for work that should be asynchronous.
36. Retry Behavior
Retries must be intentional.
Use exponential backoff where specified.
Differentiate between:
- transient failures;
- permanent validation failures;
- authentication failures;
- authorization failures;
- provider rate limits;
- malformed requests.
Do not blindly retry permanent failures.
37. Observability
Important operations must be observable.
Use:
- structured logs;
- correlation/request IDs;
- Sentry;
- health endpoints;
- integration status;
- queue monitoring.
Do not log secrets or unnecessary personal data.
Integration failures should be diagnosable without requiring direct database archaeology.
38. Auditability
Important administrative and commercial actions require audit trails.
Examples include:
- login failures;
- account lockouts;
- user changes;
- permission changes;
- device revocation;
- order approvals;
- customer approvals;
- discount-limit changes;
- imports;
- exports;
- automation changes;
- administrative actions.
Do not make sensitive state-changing actions invisible.
39. AI Features
AI is Phase 3 unless explicitly approved earlier.
Use AI to assist users, not silently make irreversible business decisions.
AI calls:
- originate from the backend;
- use minimal necessary data;
- respect the current user's permissions;
- must not receive unrelated users' data;
- must not receive passwords, secrets or tokens;
- must not receive cost/margin when the current user is not authorized.
In Phase 3, the assistant uses READ-ONLY tools.
Do not add write tools to the assistant without a new approved decision.
40. No AI as Deterministic Business Logic
Do not use a language model to calculate rules that should be deterministic.
Examples:
- discounts;
- credit;
- pricing;
- permissions;
- order transitions;
- commissions;
- totals;
- idempotency.
These belong in normal application/domain code.
AI may explain or suggest.
It must not replace deterministic commercial rules.
41. External Integrations
Use official APIs whenever required by the specification.
Do not introduce unofficial WhatsApp integrations.
Current WhatsApp behavior before Phase 4 is:
- generated wa.me link;
- optional manual interaction registration.
Official WhatsApp Cloud API is future scope.
42. Testing Strategy
Follow:
.claude/rules/testing.md
The project uses a testing pyramid focused on business risk.
Unit tests
High priority for packages/domain.
Especially:
- pricing;
- discounts;
- approval authority;
- credit;
- state transitions;
- deduplication;
- automation rules.
API integration tests
Use a real PostgreSQL environment through test containers where appropriate.
Test authorization aggressively.
Examples:
- seller cannot see another portfolio;
- representative cannot export;
- representative does not receive cost;
- manager sees correct team scope.
Sync tests
Must cover:
- idempotent push;
- cursor advancement;
- tombstones;
- portfolio reassignment;
- revocation;
- price revision;
- conflict handling.
Sankhya contract tests
Use sanitized real response fixtures from the Phase 0 spike.
Do not use real customer data in fixtures.
Worker tests
Cover:
- retries;
- outbox;
- failures;
- backoff;
- reprocessing;
- automation loop protection.
Web E2E
Use Playwright for important flows.
Mobile E2E
Use Maestro for important mobile flows.
43. TDD
Use the installed test-driven-development skill when the problem is appropriate for TDD.
TDD is particularly valuable for:
- domain rules;
- bug fixes;
- synchronization;
- pricing;
- discounts;
- credit;
- permissions;
- state transitions.
Do not force TDD onto trivial visual-only changes when it adds no meaningful value.
44. Debugging
For non-trivial bugs, use the installed:
systematic-debugging
workflow.
Do not jump directly to speculative fixes.
Preferred sequence:
1. reproduce;
2. isolate;
3. inspect evidence;
4. identify root cause;
5. fix the root cause;
6. add regression coverage when appropriate;
7. verify.
Never repeatedly apply random fixes without understanding the failure.
45. Planning
For meaningful multi-file or architectural work:
use writing-plans before implementation.
Use executing-plans after a plan is accepted.
When requirements are unclear, use brainstorming rather than immediately writing code.
If the user explicitly invokes grill-me, perform the structured requirement interrogation before implementation.
46. Parallel Agents
Use parallel agents only for genuinely independent work.
Good examples:
- one agent researches Sankhya behavior while another audits existing tests;
- frontend and backend analysis when they do not edit overlapping files;
- security review after implementation.
Bad examples:
- multiple agents editing the same module;
- several agents independently implementing the same feature;
- agents making conflicting architectural decisions.
Avoid parallel edits to the same files.
47. Project Agents
Specialized agents live under:
.claude/agents/
Use them when appropriate.
architect
Responsible for:
- architecture;
- boundaries;
- large technical decisions;
- integration design;
- architectural review.
backend-engineer
Responsible for:
- NestJS;
- APIs;
- application services;
- backend integrations;
- workers when backend-specific.
frontend-engineer
Responsible for:
- Next.js;
- React;
- web UX;
- accessibility;
- frontend architecture.
database-engineer
Responsible for:
- PostgreSQL;
- Drizzle;
- schemas;
- indexes;
- migrations;
- query performance;
- data integrity.
qa-engineer
Responsible for:
- test planning;
- validation;
- E2E;
- regression analysis;
- edge cases.
security-reviewer
Responsible for:
- authentication review;
- authorization review;
- data exposure;
- secrets;
- attack surface;
- dependency and integration risks.
The security reviewer SHOULD review high-risk changes but SHOULD NOT rewrite working implementation without reason.
code-reviewer
Responsible for:
- correctness;
- maintainability;
- architecture adherence;
- regressions;
- unnecessary complexity;
- missing tests.
48. Agent Context
Before delegating work, give the agent:
- objective;
- relevant file paths;
- relevant documentation;
- constraints;
- expected output.
Do not dump the entire repository context into every agent unnecessarily.
Each agent should read the project documents relevant to its responsibility.
49. Code Review
Use requesting-code-review for substantial completed work when appropriate.
Address valid review findings before completion.
Use receiving-code-review thoughtfully.
Do not blindly accept review suggestions that contradict:
- requirements;
- architecture;
- domain rules;
- security;
- established project decisions.
50. Verification Before Completion
For non-trivial implementation work, use:
verification-before-completion
Never claim a task is complete only because files were edited.
Completion requires evidence.
51. Definition of Done
A task is complete only when applicable conditions are satisfied:
1. requested behavior is implemented;
2. architecture boundaries are respected;
3. business rules are correctly enforced;
4. security implications were considered;
5. relevant tests pass;
6. type checking passes;
7. lint passes;
8. build passes where relevant;
9. user-visible behavior was verified;
10. no known regression was introduced;
11. important edge cases were considered;
12. documentation was updated if necessary;
13. the final implementation was reviewed.
Do not say "done", "fixed" or "working" before verification.
52. Commands and Scripts
Use the repository's actual scripts.
Before running commands, inspect:
- package.json;
- workspace configuration;
- Turborepo configuration;
- package-level scripts.
Do not invent commands that do not exist.
Do not install a dependency simply because you remember it exists.
First confirm:
- current dependency;
- current version constraints;
- whether an existing package already solves the problem.
53. Dependency Discipline
Before adding a dependency:
1. determine whether it is actually needed;
2. prefer already approved libraries;
3. evaluate maintenance and security implications;
4. avoid overlapping libraries that solve the same problem;
5. keep dependency scope minimal.
Do not add frameworks casually.
54. Security of Third-Party Skills and Scripts
Third-party skills and scripts may execute commands.
Before running unknown bundled scripts:
- inspect them;
- understand their behavior;
- avoid exposing secrets;
- avoid piping unknown remote scripts directly to a shell.
Do not assume a skill is safe merely because it is installed.
55. Git Safety
Do not perform irreversible Git actions without explicit approval.
Never automatically:
- force push;
- rewrite published history;
- delete remote branches;
- reset destructive changes;
- merge into protected branches;
- deploy production.
Do not discard unrelated uncommitted user work.
Before modifying files with existing user changes:
inspect the diff.
Preserve unrelated changes.
56. Commit Scope
When commits are requested:
- keep commits focused;
- do not combine unrelated work;
- use meaningful messages;
- do not commit secrets;
- do not commit temporary debug artifacts.
Do not commit automatically unless requested or explicitly allowed by the active workflow.
57. Documentation Discipline
Documentation should reflect actual behavior.
When implementation changes an approved behavior:
determine whether the relevant documentation needs updating.
Architecture-changing work should update:
- docs/architecture.md
- and/or docs/decisions.md
Synchronization changes should update:
- docs/sync-protocol.md
Security-model changes should update:
- docs/security-model.md
Sankhya discoveries should update:
- docs/sankhya-spike.md
Do not silently alter approved product requirements to match an implementation shortcut.
58. Architectural Decisions
If a meaningful new architectural decision is required:
1. explain the problem;
2. list realistic alternatives;
3. explain trade-offs;
4. recommend one;
5. obtain approval when material;
6. record the decision in docs/decisions.md.
Do not hide architecture decisions inside implementation code.
59. YAGNI
The project has a large scope.
Strictly apply YAGNI within the current phase.
Do not build infrastructure for imagined future requirements merely because they may eventually exist.
However, do not violate already approved architectural boundaries in the name of YAGNI.
60. Simplicity
Prefer the smallest design that correctly satisfies:
- current requirements;
- approved architecture;
- security;
- expected scale.
Avoid premature abstraction.
Avoid "enterprise architecture" for its own sake.
Do not split a module into services merely to create more files.
61. Performance
Do not prematurely optimize without evidence.
However, respect explicitly defined non-functional targets.
Pay special attention to:
- mobile local queries;
- synchronization payload size;
- pagination;
- bulk operations;
- database indexes;
- dashboard queries;
- Sankhya API rate limits;
- queue throughput.
Measure before making complex optimizations.
62. User Scale
Initial expected scale:
- approximately 20–100 users;
- medium-sized customer base;
- medium-sized product catalogue.
Architecture should have reasonable headroom but must not be designed as hyperscale infrastructure.
63. Error Handling
Errors must be actionable.
Avoid exposing raw implementation errors to end users.
For integrations, distinguish:
- provider unavailable;
- authentication failure;
- validation error;
- rate limit;
- temporary failure;
- permanent business rejection.
User-facing integration errors should be translated into understandable status when possible.
Technical detail should remain available in logs.
64. Business Data Integrity
When forced to choose between:
- convenience;
- speed;
- data integrity;
prefer data integrity for:
- orders;
- financial information;
- prices;
- approvals;
- synchronization;
- permissions;
- Sankhya writes.
Do not silently "best guess" critical commercial data.
65. Unknown Business Rules
When a required business rule is not documented:
DO NOT invent it.
Check:
1. relevant project documentation;
2. existing implementation;
3. Sankhya behavior if applicable.
If still unknown:
ask the user or register it as a pending validation.
66. Current Explicit Out-of-Scope Items
Unless a later approved decision changes them, do not implement:
- multi-tenant SaaS;
- billing/subscriptions;
- route planning;
- GPS check-in;
- field surveys;
- point-of-sale photos;
- returns/exchanges;
- stock blocking;
- stock availability rules;
- independent goal calculation;
- independent commission calculation;
- B2B customer portal;
- unofficial WhatsApp integration.
67. Communication During Work
Before substantial implementation, summarize:
- what will change;
- what modules are affected;
- important risks;
- whether an architectural decision is involved.
During long tasks, keep the plan current.
At completion report:
- what changed;
- important files;
- tests executed;
- validation performed;
- unresolved risks or pending items.
Do not produce long celebratory summaries.
Prefer concrete technical evidence.
68. Stop Conditions
Stop and request clarification or approval when:
- an approved architectural decision must change;
- a business-critical rule is unknown;
- a destructive database action is required;
- production credentials would be needed;
- production deployment is required;
- existing user work would be overwritten;
- a security rule must be weakened;
- a Sankhya integration detail is unknown and not yet validated;
- the implementation would materially expand project scope.
69. Core Principle
The objective is not to generate the most code.
The objective is to build a reliable commercial system that:
- preserves business data;
- works offline;
- integrates safely with Sankhya;
- enforces commercial rules;
- protects customer information;
- remains maintainable by a small team;
- can gradually replace Vidya Force and Agendor without operational disruption.
When uncertain, prefer:
correctness
→ data integrity
→ security
→ maintainability
→ simplicity
→ performance optimization
→ implementation speed.