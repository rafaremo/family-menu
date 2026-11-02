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

## Starter Layout

- `app/routes.ts` defines the shared route contract used by server and browser modules for type-safe hrefs
- `app/router.ts` wires routes to controllers and installs the standard Remix component renderer used by actions
- Put top-level route actions in `app/actions/controller.tsx`; add `app/actions/<route-key>/controller.tsx` for nested route maps. `app/actions/controller.test.ts` is the root controller's router smoke test
- `app/actions/home-page.tsx` and `app/actions/document.tsx` render the route-owned starter UI
- `app/actions/public/` contains the browser runtime entry and interactive prompt button
- `app/assets.ts` owns the server-side asset pipeline used by the asset route and render middleware
- Root `public/` contains static files served unchanged from the app root

This starter intentionally begins small; add directories like `app/data/`, `app/middleware/`, `app/ui/`, and `test/` only when you need them.

## Project Conventions (Family Menu)

- Full plan: `docs/PLAN.md`. Update its "Estado" checklist when a phase is completed.
- UI text and domain data are in **Spanish**; code identifiers in English.
- Node ≥ 24.3 is required. On this VPS: `eval "$(~/.local/share/fnm/fnm env)" && fnm use`.
- Business logic lives in `app/services/*`; dashboard actions and MCP tools are thin wrappers around it.
- DB: Drizzle ORM (`app/db/`), migrations in `drizzle/`. Postgres dev at `127.0.0.1:5434` (`npm run db:up`).
- Auth: Better Auth (plugins `admin`, `apiKey`), mounted at `/api/auth/*`. No public sign-up.
