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

## MCP (Claude / ChatGPT)

1. En el dashboard: **Mi cuenta → Tokens → Crear token**. El token (`fm_…`) se muestra una sola vez, con snippets listos.
2. Conecta tu cliente:
   - **Claude Code:** `claude mcp add --transport http family-menu https://menu.rafaymon.com/mcp --header "Authorization: Bearer fm_…"`
   - **Claude Desktop:** `npx -y mcp-remote https://menu.rafaymon.com/mcp --header "Authorization: Bearer fm_…"` en `claude_desktop_config.json`.
   - **Claude.ai / ChatGPT** (no permiten headers): `https://menu.rafaymon.com/mcp/t/fm_…` — la URL es secreta (se desactiva con `MCP_ALLOW_PATH_TOKEN=false`).
3. Prueba: “¿qué hay en el menú de esta semana?”, “guarda la receta de tinga de mi abuela”, “arma el menú de la próxima semana y genera la lista del súper”.

Servidor sin estado (Streamable HTTP, POST `/mcp`). 28 herramientas (recetas, ingredientes, catálogos, menús, lista, `whoami`),
resources `recipe://{slug}` y `menu://{id}` en markdown, y prompts `planear_semana` y `capturar_receta`.
La gestión de miembros **no** se expone por MCP. Cada llamada queda en `audit_log` con `via='mcp'`. Revocar un token corta el acceso al instante.

## Producción
```sh
docker compose --profile prod up -d --build   # app en 127.0.0.1:3010
```

## Licencia
[MIT](LICENSE)
