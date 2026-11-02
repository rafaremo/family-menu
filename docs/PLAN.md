# Family Menu — Plan de implementación

> Recetario familiar + base de ingredientes + planeador de menús semanales que genera la lista del súper.
> Administrado vía **MCP** (Claude / ChatGPT) y un **dashboard web** autenticado.

- **Ubicación del proyecto:** `/root/workspace/code/family-menu`
- **Repo:** GitHub `rafaremo/family-menu` — licencia **MIT**
- **Dominio:** `https://menu.rafaymon.com`
- **Fecha del plan:** 2026-11-01

---

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Framework | **Remix 3** (`remix@3.1.x`, el nuevo, sin React): `remix/router`, `remix/component` (JSX en servidor + islas hidratadas), middleware, file-storage |
| Lenguaje | TypeScript estricto, ESM, **Node ≥ 24.3** (requerido por Remix 3; en el servidor vía `fnm`, ver `.nvmrc`) |
| Auth | **Better Auth** (`better-auth@1.7.x`) con plugins `admin` y `apiKey` |
| BD | **PostgreSQL 17** |
| ORM / migraciones | **Drizzle ORM + drizzle-kit** (Better Auth tiene adaptador oficial de Drizzle, así que hay un solo esquema y una sola herramienta de migraciones) |
| MCP | `@modelcontextprotocol/sdk` con transporte **Streamable HTTP** (versión Web-standard `Request`/`Response`) montado en `/mcp` |
| Auth del MCP | **Tokens API por usuario** (plugin `apiKey` de Better Auth) enviados como `Authorization: Bearer <token>` |
| Roles | `admin` + `member` |
| Tenencia | Una sola familia por instancia |
| Idioma | UI y datos en **español** |
| Deploy | **Docker** (app + Postgres) con docker-compose en tu servidor |
| Funciones de menú | Planeador semanal (día × comida), escalado por porciones, suma y conversión de unidades, lista agrupada por pasillo/tienda |
| Extras v1 | Fotos de recetas, importar receta desde URL, etiquetas/categorías y favoritos |

### Riesgo importante: autenticación MCP con tokens
- **Claude Code / Claude Desktop / Cursor / clientes con headers:** funcionan directo con `Authorization: Bearer`.
- **Claude.ai (conectores personalizados) y ChatGPT (conectores / developer mode):** priorizan **OAuth** y en general no te dejan poner headers arbitrarios.
  - **Plan v1:** también aceptar el token en la ruta, `https://menu.rafaymon.com/mcp/t/<token>`. Funciona con cualquier cliente, pero la URL pasa a ser secreta: se puede rotar o revocar desde el dashboard.
  - **Plan v2 (opcional):** activar el plugin OAuth/MCP de Better Auth (`oidcProvider` / `mcp`) para tener un flujo OAuth formal, sin cambiar las herramientas.

---

## 2. Arquitectura

```
                ┌───────────────────────────────┐
 Claude / GPT ─▶│  /mcp  (Streamable HTTP)      │──┐
                │  auth: API key (Bearer/ruta)  │  │
                └───────────────────────────────┘  │
                ┌───────────────────────────────┐  │   ┌──────────────────┐   ┌──────────┐
 Navegador ────▶│  Dashboard Remix 3 (SSR JSX)  │──┼──▶│  services/*      │──▶│ Postgres │
                │  auth: sesión Better Auth     │  │   │  (lógica única)  │   └──────────┘
                └───────────────────────────────┘  │   └──────────────────┘
                ┌───────────────────────────────┐  │            │
                │  /api/auth/*  (Better Auth)   │──┘            ▼
                └───────────────────────────────┘     uploads/ (fotos, volumen)
```

**Principio clave:** toda la lógica de negocio vive en `app/services/*`. Las acciones del dashboard y las herramientas MCP son capas delgadas que validan la entrada, verifican permisos y llaman al mismo servicio. Así el dashboard y el MCP no pueden comportarse distinto.

### Integración Better Auth ↔ Remix 3
- `auth.handler(request)` recibe un `Request` y regresa un `Response`, así que se monta tal cual en `router.map('/api/auth/*', ...)`.
- Middleware propio `loadSession()`: llama a `auth.api.getSession({ headers })` y pone `context.user` y `context.session`.
- Middleware `requireUser()` / `requireAdmin()` para proteger controladores.
- Middleware `requireApiKey()` para `/mcp`: llama a `auth.api.verifyApiKey({ key })` y carga el usuario dueño del token.
- Registro público **deshabilitado** (`emailAndPassword.disableSignUp: true`). Solo el admin crea miembros con `auth.api.createUser` (plugin `admin`).
- Seed: el primer admin se crea desde `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `scripts/seed.ts`.

---

## 3. Estructura del proyecto

```
family-menu/
├─ app/
│  ├─ router.ts              # createRouter + middleware global + router.map(...)
│  ├─ routes.ts              # route map tipado
│  ├─ actions/               # controladores Remix 3 (dashboard)
│  │  ├─ controller.tsx      # raíz: /, /login, /logout
│  │  ├─ recetas/            # CRUD recetas, fotos, importar URL
│  │  ├─ ingredientes/
│  │  ├─ menus/
│  │  ├─ listas/
│  │  ├─ admin/miembros/
│  │  └─ cuenta/tokens/
│  ├─ components/            # JSX remix/component (layout, forms, grid semanal, lista)
│  ├─ assets/                # entradas cliente (islas hidratadas) + CSS
│  ├─ auth/
│  │  ├─ auth.ts             # betterAuth({ database: drizzleAdapter, plugins: [admin(), apiKey()] })
│  │  └─ middleware.ts       # loadSession, requireUser, requireAdmin, requireApiKey
│  ├─ db/
│  │  ├─ client.ts           # pg Pool + drizzle
│  │  ├─ schema/auth.ts      # generado por @better-auth/cli
│  │  └─ schema/app.ts       # tablas de dominio
│  ├─ services/
│  │  ├─ recipes.ts
│  │  ├─ ingredients.ts
│  │  ├─ menus.ts
│  │  ├─ shopping.ts         # motor de lista del súper
│  │  ├─ units.ts            # conversión y normalización de unidades
│  │  ├─ ingredient-parser.ts# "2 tazas de harina cernida" → {qty, unit, name, note}
│  │  ├─ importer.ts         # JSON-LD schema.org/Recipe desde URL
│  │  ├─ photos.ts           # remix/file-storage (fs local)
│  │  └─ members.ts
│  ├─ mcp/
│  │  ├─ server.ts           # McpServer + registro de tools/resources/prompts
│  │  ├─ handler.ts          # transporte Streamable HTTP (Request→Response)
│  │  └─ tools/{recipes,ingredients,menus,shopping,meta}.ts
│  └─ lib/{validation.ts, errors.ts, slug.ts, i18n-es.ts}
├─ drizzle/                  # migraciones SQL
├─ scripts/seed.ts           # admin, unidades, pasillos, tiendas, ingredientes base
├─ test/                     # remix test: unidades, motor de lista, MCP e2e
├─ uploads/                  # (volumen Docker) fotos
├─ Dockerfile
├─ docker-compose.yml        # app + postgres:17
├─ drizzle.config.ts
├─ .env.example
└─ README.md
```

---

## 4. Modelo de datos

### Tablas de Better Auth (generadas)
`user` (+ `role`, `banned` del plugin admin), `session`, `account`, `verification`, `apikey`.

### Tablas de dominio

| Tabla | Campos principales |
|---|---|
| **aisle** (pasillo/categoría) | id, name ("Frutas y verduras", "Lácteos", "Carnes"…), sort_order |
| **store** | id, name ("Costco", "Súper", "Mercado"…), sort_order |
| **unit** | code PK (`g`,`kg`,`ml`,`l`,`pz`,`taza`,`cda`,`cdta`,`lata`,`manojo`,`diente`…), name, plural, dimension (`mass`/`volume`/`count`/`other`), to_base (factor a g, ml o pz) |
| **ingredient** | id, name (único, normalizado), slug, aliases text[], aisle_id, default_store_id?, default_unit, density_g_per_ml?, grams_per_piece?, notes, created_by |
| **recipe** | id, title, slug, description, servings, prep_minutes, cook_minutes, steps jsonb (`[{text}]`), notes, source_url?, family_credit ("Receta de la abuela Lupe"), cover_photo_id?, created_by, updated_by, timestamps |
| **recipe_ingredient** | id, recipe_id, ingredient_id, quantity numeric? (null = "al gusto"), unit_code?, preparation ("picada"), group_label ("Para la salsa"), optional bool, position |
| **recipe_photo** | id, recipe_id, storage_key, content_type, width, height, position |
| **tag** | id, name, slug, kind (`category`/`diet`/`occasion`/`free`) |
| **recipe_tag** | recipe_id, tag_id |
| **favorite** | user_id, recipe_id, created_at |
| **menu** | id, name, week_start (date, lunes), default_servings, notes, created_by, timestamps |
| **menu_item** | id, menu_id, date, meal (`desayuno`/`comida`/`cena`/`colacion`), recipe_id, servings, position, notes |
| **shopping_list** | id, menu_id?, name, status (`abierta`/`completada`), generated_at |
| **shopping_list_item** | id, list_id, ingredient_id?, label, quantity numeric?, unit_code?, aisle_id?, store_id?, checked, source (`generated`/`manual`), source_recipes jsonb, notes |
| **audit_log** | id, user_id, via (`web`/`mcp`), action, entity, entity_id, at |

Índices: búsqueda de texto completo en español (`to_tsvector('spanish', ...)`) sobre recipe.title, description e ingredient names, y `pg_trgm` para búsqueda difusa de ingredientes y alias.

---

## 5. Motor de lista del súper (`services/shopping.ts`)

1. Cargar `menu_item`s con `recipe` y `recipe_ingredient`s.
2. **Escalar:** `factor = item.servings / recipe.servings`; `qty = ri.quantity * factor`. Los ingredientes `optional` se excluyen por defecto (flag `includeOptional`).
3. **Normalizar unidades:** convertir a la unidad base de su dimensión (g, ml, pz).
   - Si cruza dimensiones (taza→g) y el ingrediente tiene `density_g_per_ml` o `grams_per_piece`, se convierte. Si no, se deja como renglón separado.
4. **Agrupar y sumar** por `(ingredient_id, dimensión)`. Las cantidades "al gusto" (null) se agregan una sola vez sin cantidad.
5. **Humanizar:** 1500 g → 1.5 kg, 750 ml → 750 ml, 2.33 pz → 3 pz (piezas redondeadas hacia arriba).
6. **Asignar pasillo y tienda** desde el ingrediente; ordenar por `store.sort_order` y luego `aisle.sort_order`.
7. Guardar `source_recipes`, por ejemplo `[{recipe:"Tinga", qty:"500 g"}]`, para mostrar de dónde sale cada cosa.
8. **Regenerar** conserva los renglones `manual` y el estado `checked` de los renglones que siguen existiendo.
9. **Exportar** como texto o markdown agrupado (para WhatsApp o Notas) desde el dashboard o el MCP.

Se cubre con pruebas unitarias exhaustivas: escalado, conversiones, mezcla de unidades, "al gusto" y regeneración.

---

## 6. Servidor MCP

- Endpoint: `POST/GET /mcp` (Bearer) y `/mcp/t/:token` (token en ruta).
- Sin estado (stateless, un transporte por request) para simplificar el despliegue.
- Cada llamada queda en `audit_log` con `via='mcp'`.
- Descripciones de las herramientas en español, con ejemplos, para que el LLM las use bien.

### Herramientas

| Dominio | Herramientas |
|---|---|
| Recetas | `search_recipes` (texto, tags, ingrediente, favoritos), `get_recipe`, `create_recipe` (con ingredientes estructurados; crea ingredientes nuevos si no existen), `update_recipe`, `delete_recipe`, `scale_recipe`, `toggle_favorite`, `import_recipe_from_url` (regresa borrador para revisar y luego `create_recipe`) |
| Ingredientes | `search_ingredients`, `create_ingredient`, `update_ingredient` (pasillo, tienda, alias, densidad), `merge_ingredients` (deduplicar) |
| Catálogos | `list_tags`, `list_aisles`, `list_stores`, `list_units` |
| Menús | `list_menus`, `get_menu`, `create_menu`, `add_menu_item`, `update_menu_item`, `remove_menu_item`, `copy_menu` (repetir una semana) |
| Lista | `generate_shopping_list`, `get_shopping_list`, `add_list_item`, `check_list_items`, `export_shopping_list` |
| Meta | `whoami` |

**Resources:** `recipe://{slug}` (markdown de la receta) y `menu://{id}`.
**Prompts:** `planear_semana` (sugerir el menú con base en favoritos y lo que no se ha repetido) y `capturar_receta` (dictar una receta familiar).

La gestión de usuarios **no** se expone por MCP; se hace solo desde el dashboard (por seguridad).

---

## 7. Dashboard (UI en español)

| Ruta | Acceso | Descripción |
|---|---|---|
| `/login` | público | Email + contraseña |
| `/` | miembro | Menú de la semana actual + accesos rápidos |
| `/recetas`, `/recetas/nueva`, `/recetas/:slug`, `/recetas/:slug/editar` | miembro | Búsqueda, filtros por tag y favoritos, editor de ingredientes con autocompletado, fotos, vista para cocinar |
| `/recetas/importar` | miembro | Pegar una URL → vista previa → guardar |
| `/ingredientes` | miembro | Catálogo, pasillo y tienda, alias, fusionar duplicados |
| `/menus`, `/menus/:id` | miembro | Cuadrícula semanal día × comida, porciones por platillo, botón "Generar lista" |
| `/listas/:id` | miembro | Lista para usar en el celular, con casillas por pasillo y tienda, agregar a mano, exportar |
| `/catalogos` | admin | Pasillos, tiendas, unidades, tags |
| `/admin/miembros` | admin | Crear miembro, cambiar rol, resetear contraseña, desactivar (ban) |
| `/cuenta` | miembro | Cambiar contraseña, **tokens MCP** (crear, revocar) con snippets listos para Claude Code, Claude Desktop y ChatGPT |

UI: HTML renderizado en servidor con `remix/component`; formularios nativos; solo se hidratan islas (autocompletado de ingredientes, cuadrícula del menú, casillas de la lista). CSS propio ligero con el mixin `css` de Remix, mobile-first. Middleware `csrf` + `cop` para los formularios.

---

## 8. Importar receta desde URL (`services/importer.ts`)

1. `fetch` de la URL (timeout, límite de tamaño, solo http/https, bloqueo de IPs privadas para evitar SSRF).
2. Extraer `<script type="application/ld+json">` y buscar `@type: Recipe` (incluso dentro de `@graph`).
3. Mapear title, description, recipeYield → servings, prepTime y cookTime (ISO 8601), recipeInstructions, image (se descarga como foto) y recipeIngredient[].
4. `ingredient-parser.ts` (en español): fracciones (`1/2`, `½`, `1 ½`), unidades y sinónimos (`tz`, `taza(s)`, `cucharada`, `cda`…), "al gusto", "una pizca", y separa la preparación ("picada finamente").
5. Empatar con ingredientes existentes por nombre o alias (trigram). Los que no empatan se marcan como "nuevo" en la vista previa.
6. Por MCP, el LLM puede corregir el borrador antes de llamar `create_recipe`.

---

## 9. Variables de entorno

```
DATABASE_URL=postgres://family:***@db:5432/family_menu
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://menu.rafaymon.com
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
UPLOADS_DIR=/data/uploads
MCP_ALLOW_PATH_TOKEN=true
PORT=3010
```

Puertos locales: app `3010`, Postgres `127.0.0.1:5434` (el 5433 ya lo usa cfdi-express-api).

---

## 10. Fases de implementación

| # | Fase | Entregables | Criterio de "hecho" |
|---|---|---|---|
| 0 | Scaffold | `remix new`, tsconfig (`jsxImportSource: remix/component`), docker-compose con Postgres, Drizzle, README, repo en GitHub | `npm run dev` levanta y `/health` responde |
| 1 | Auth y miembros | Better Auth (admin + apiKey), esquema, login/logout, middleware, seed del admin, `/admin/miembros` | El admin crea un miembro, el miembro inicia sesión y no ve rutas de admin |
| 2 | Catálogos e ingredientes | Unidades, pasillos, tiendas y tags con seed; CRUD de ingredientes; alias; búsqueda | Los seeds cargan y la búsqueda difusa funciona |
| 3 | Recetas | CRUD, editor de ingredientes, fotos, tags, favoritos, búsqueda de texto completo | Se puede capturar una receta familiar completa con foto |
| 4 | Menús y lista | Cuadrícula semanal, motor de lista + pruebas, vista móvil de la lista, exportar | Un menú de 7 días genera una lista correcta y agrupada |
| 5 | MCP | Servidor, todas las tools, tokens en `/cuenta`, auditoría, pruebas e2e con cliente MCP | Claude Code crea una receta, arma un menú y genera la lista |
| 6 | Importar URL | Importador JSON-LD, parser de ingredientes en español + pruebas, vista previa | Importa correctamente 5 sitios de recetas populares en español |
| 7 | Deploy | Dockerfile multi-stage, compose de producción, volumen de uploads, backups `pg_dump` (cron), HTTPS (reverse proxy o Cloudflare Tunnel) | Accesible por HTTPS y conectado desde Claude y ChatGPT |
| 8 | Pulido (opcional) | OAuth para MCP, PWA de la lista, sugerencias "no repetir platillos" | — |

---

## 11. Pruebas

- **Unitarias:** `units`, `ingredient-parser`, `shopping` (el núcleo), `importer` (con fixtures HTML).
- **Integración:** servicios contra Postgres de prueba (contenedor).
- **MCP e2e:** `@modelcontextprotocol/sdk` como cliente contra el servidor, con token válido, inválido y revocado.
- **Navegador:** `remix test` para login, crear receta, generar lista.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Remix 3 es muy nuevo (3.0 estable desde oct-2026); hay pocos ejemplos y algunas APIs todavía cambian (`@remix-run/ui` sigue en 0.x) | Fijar versiones exactas, no usar `@remix-run/ui` en v1 y aislar el framework en `actions/` y `components/` (los servicios son TS puro) |
| Better Auth no tiene integración oficial con Remix 3 | Se usa su `handler(Request)` estándar y `api.getSession`, sin depender del framework |
| ChatGPT y Claude.ai prefieren OAuth | Token en ruta para v1; OAuth en la fase 8 |
| Conversión de unidades ambigua (tazas a gramos) | Densidad por ingrediente opcional; si falta, se muestra como renglón separado |
| Fotos en disco local | Volumen Docker + backup; `remix/file-storage` permite cambiar a S3/R2 después |

---

## 13. Decisiones confirmadas
- **Dominio:** `menu.rafaymon.com` (detrás de reverse proxy o Cloudflare Tunnel; se define en la fase 7).
- **Repo:** `github.com/rafaremo/family-menu`, licencia MIT.
- **Tiendas iniciales (seed):** Costco, City Market, Amazon, Tiendita, Otros.
- **Pasillos iniciales (seed):** Frutas y verduras, Carnes y pescados, Salchichonería, Lácteos y huevo, Panadería y tortillas, Abarrotes, Especias y condimentos, Enlatados, Congelados, Bebidas, Limpieza, Otros.

## 14. Estado
- [x] **Fase 0 — Scaffold** (`remix new`, Drizzle, Postgres en Docker, `/health`, Dockerfile, MIT)
- [x] **Fase 1 — Auth y miembros** (Better Auth + admin/apiKey, login/logout, `/admin/miembros`, `/cuenta`, seed del admin, bitácora, 17 pruebas)
- [ ] Fase 2 — Catálogos e ingredientes
