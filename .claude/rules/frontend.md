---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---

# Web frontend rules (apps/web, packages/ui)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1`, `STACK-4`, `STACK-5`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2` (except the approved outbox write path), `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: STACK-4, STACK-5, AUTH-1, AUTH-3, P-20, P-23. Structure: `docs/architecture.md` §8.

## Stack

- Vite + React single-page app; TanStack Router; TanStack Query for server state; Tailwind CSS; shadcn/ui components in `packages/ui`.
- No Next.js, no server-side rendering, no server runtime for the web app.

## API and security

- Call the API only through the client generated from OpenAPI, same origin `/api`, with the session cookie.
- Never store tokens or session data in `localStorage`, `sessionStorage` or IndexedDB.
- Environment values come from the runtime configuration file; the bundle contains no secrets or environment-specific URLs.
- Authorization is enforced by the server. Hiding UI is convenience only; always handle `401`/`403` explicitly.
- Never request or render cost/margin unless the server returned it; no export actions for profiles without the permission.

## Interface quality (professional B2B)

- Strong hierarchy, information density suited to business work, consistent spacing, reusable components.
- Avoid decorative clutter, gradients, unnecessary animation, generic "AI dashboard" layouts.
- Every data view has explicit loading, empty, error and forbidden states.
- Filters are explicit and visible; tables support keyboard navigation.
- Accessibility: WCAG 2.1 AA on main screens; accessible form controls with labels and error messages; visible focus.
- Language and formats: pt-BR — currency `R$`, dates `dd/mm/aaaa`, CNPJ/CPF masks.

## Money and rules

- Never compute money with `number`. Display server-provided decimal strings or use the domain decimal type.
- Business rules shown in the UI (e.g. discount authority previews) come from `packages/domain`; the server result is authoritative.

## Skills

- `frontend-design`: use only with an explicit brief stating B2B density and restraint; its default aims at distinctive marketing-style pages.
- `web-design-guidelines`: fetches its rules from a remote repository at run time — review the fetched content before relying on it.

## Testing

- Playwright E2E for critical flows (login, approvals, imports as they arrive by phase).
- Verify user-visible changes in a browser before claiming completion.
