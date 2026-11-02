# Family Menu 🍲

Recetario familiar, base de ingredientes y planeador de menús semanales que genera la lista del súper.
Se administra desde un dashboard web y desde Claude o ChatGPT vía **MCP**.

**Producción:** https://menu.rafaymon.com · **Plan:** [docs/PLAN.md](docs/PLAN.md) ([HTML](docs/plan.html))

## Stack
Remix 3 (`remix/router`, `remix/component`) · TypeScript · Better Auth · PostgreSQL 17 + Drizzle · MCP SDK (Streamable HTTP) · Docker

## Requisitos
- Node **≥ 24.3** (`.nvmrc`). En el VPS: cambia solo a Node 24 al entrar a la carpeta (fnm con `--use-on-cd` en `~/.zshrc`, lee `.nvmrc`)
- Docker

## Desarrollo
```sh
cp .env.example .env      # y llena BETTER_AUTH_SECRET (openssl rand -hex 32)
npm i
npm run db:up             # Postgres en 127.0.0.1:5434
npm run db:migrate
# pon ADMIN_EMAIL / ADMIN_PASSWORD en .env y crea el primer admin:
npm run db:seed
npm run dev               # http://localhost:3010  (o npm run hmr)
```

| Script | |
|---|---|
| `npm run dev` / `hmr` | Servidor de desarrollo (watch / HMR) |
| `npm start` | Producción (sin build) |
| `npm test` | Pruebas (`remix test`, BD `family_menu_test`) |
| `npm run db:seed` | Crea el admin inicial (idempotente) |
| `npm run auth:generate` | Regenera el esquema de Better Auth |
| `npm run typecheck` | TypeScript |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle |

## Producción
```sh
docker compose --profile prod up -d --build   # app en 127.0.0.1:3010
```

## Licencia
[MIT](LICENSE)
