# Family Menu Agent Guide

This app was scaffolded with `remix new`. Use these conventions when continuing to build it out.

## Commands

```sh
npm i
npm run dev
npm run hmr
npm run start
npm test
npm run typecheck
```

Use `npm run hmr` for live server and browser updates; `npm run dev` only watches and restarts the server. `npm run start` runs in production mode without a separate build step.

## Building Features

Refer to ./.agents/skills/remix/SKILL.md for the Remix mental model and how to find guides and API READMEs through `node_modules/remix/INDEX.md`.

## Layout

- `app/routes.ts` — shared route contract (type-safe hrefs). `app/router.ts` — router middleware (`staticFiles`, `cop`, `render`) and one `router.map(...)` per route map.
- `app/actions/controller.tsx` — root leaves: assets, `/health`, `/api/auth/*` (Better Auth handler), `/logout`.
- `app/actions/<area>/controller.tsx` + `page.tsx` — one controller per nested route map (`dashboard`, `login`, `account`, `admin/members`).
- `app/auth/` — `auth.ts` (Better Auth config, roles `admin`/`member`) and `middleware.ts` (`sessionAuth`, `requireUser`, `requireAdmin`).
- `app/services/` — business logic (members, audit). `app/lib/` — validation (zod) and error mapping. `app/ui/` — shared layout and form components.
- `public/styles.css` — global stylesheet (served as-is). `app/actions/public/entry.ts` — browser runtime entry.
- `test/` — test setup (creates/migrates the `*_test` DB) and request helpers. `scripts/seed.ts` — idempotent seed.

### Remix gotcha

Action-level `middleware` inside `createController({ actions })` does not type-check (context not inferred). Put middleware on the **controller** and split route maps so each controller has a single middleware boundary.

## Project Conventions (Family Menu)

- Full plan: `docs/PLAN.md`. Update its "Estado" checklist when a phase is completed.
- UI text and domain data are in **Spanish**; code identifiers in English.
- Node ≥ 24.3 is required. On this VPS: `eval "$(~/.local/share/fnm/fnm env)" && fnm use`.
- Business logic lives in `app/services/*`; dashboard actions and MCP tools are thin wrappers around it.
- DB: Drizzle ORM (`app/db/`), migrations in `drizzle/`. Postgres dev at `127.0.0.1:5434` (`npm run db:up`).
- Auth: Better Auth (plugins `admin`, `apiKey`), mounted at `/api/auth/*`. No public sign-up. After changing plugins run `npm run auth:generate` then `npm run db:generate`.
- Tests: `npm test` runs against `TEST_DATABASE_URL` (must end in `_test`), serially. Use `test/helpers.ts` (`request`, `login`, `resetDb`).
- First admin: set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, then `npm run db:seed`.
