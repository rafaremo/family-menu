# Deploy en Coolify

La app se despliega en **Coolify** desde este repo (build con el `Dockerfile`). La base de datos es un
recurso **PostgreSQL independiente** de Coolify (no va en ningún docker-compose). Las fotos viven en
**Cloudflare R2**. HTTPS lo pone Coolify (Traefik + Let's Encrypt).

```
GitHub (rafaremo/family-menu) ──push──▶ Coolify build (Dockerfile)
                                              │
 https://menu.rafaymon.com ─▶ Traefik ─▶ app :3000 ──▶ PostgreSQL 17 (recurso Coolify, red interna)
                                              └──────▶ R2 rafaymon-bucket/family-menu/
```

## 1. Base de datos (recurso de Coolify)

1. **+ New → Database → PostgreSQL**, versión **17** (imagen `postgres:17-alpine`).
2. Nombre de BD `family_menu`, usuario `family`, contraseña larga generada por Coolify.
3. **No** la publiques a internet (deja "Make it publicly available" apagado).
4. Copia la **Postgres URL (internal)**: `postgres://family:…@<uuid-de-coolify>:5432/family_menu`.
   Debe estar en el mismo servidor/red de Coolify que la app.
5. **Backups:** en la BD → *Backups* → programa un backup diario (p. ej. `0 4 * * *`) y activa
   **S3 storage** con R2:
   - En Coolify → *S3 Storages* → nuevo: endpoint `https://481c4380225c2cbcc9c65b58a75f9744.r2.cloudflarestorage.com`,
     bucket `rafaymon-bucket`, región `auto`, llaves de un token R2 con *Object Read & Write*.
   - Coolify sube los `pg_dump` al bucket; define cuántos conservar (p. ej. 14 locales / 30 en S3).
   - Restaurar: *Backups → Restore*, o `pg_restore` / `psql` con el archivo descargado.

## 2. Aplicación

1. **+ New → Application → GitHub** (o *Public/Private Repository*) → `rafaremo/family-menu`, rama `main`.
2. **Build pack: Dockerfile** (no Nixpacks, no Docker Compose).
3. **Ports Exposes:** `3000`.
4. **Domains:** `https://menu.rafaymon.com` (Coolify emite el certificado).
5. **Health check:** path `/health`, puerto `3000` (la imagen también trae `HEALTHCHECK`).
6. **Variables de entorno** (marca como *secret* las sensibles):

| Variable | Valor |
|---|---|
| `DATABASE_URL` | URL **interna** de la BD del paso 1 |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (mín. 32 caracteres; no la cambies después o se cierran todas las sesiones) |
| `BETTER_AUTH_URL` | `https://menu.rafaymon.com` |
| `PUBLIC_URL` | `https://menu.rafaymon.com` (opcional; default = `BETTER_AUTH_URL`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | primer admin (solo se usa si aún no hay admin) |
| `R2_ACCOUNT_ID` | `481c4380225c2cbcc9c65b58a75f9744` |
| `R2_BUCKET` | `rafaymon-bucket` |
| `R2_PREFIX` | `family-menu` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | token R2 *Object Read & Write* limitado al bucket |
| `MCP_ALLOW_PATH_TOKEN` | `true` (Claude.ai / ChatGPT) o `false` |
| `APP_TIMEZONE` | `America/Mexico_City` (default) |

   La imagen ya define `NODE_ENV=production`, `PORT=3000` y `TRUST_PROXY=true`.
   Sin variables `R2_*` las fotos se guardan en disco: en ese caso agrega un **Persistent Storage**
   montado en `/data/uploads`.

7. **Deploy.** Al arrancar, el contenedor corre `scripts/release.ts` antes del servidor:
   - valida la configuración (falla con mensaje claro si falta algo, y el deploy queda en rojo),
   - espera a la BD, aplica migraciones de `drizzle/`,
   - carga catálogos iniciales si están vacíos,
   - crea el admin de `ADMIN_EMAIL` si no hay ninguno.

   En los logs del deploy debe verse:
   ```
   [release] archivos: R2 rafaymon-bucket/family-menu/
   [release] ✓ migraciones al día
   [release] ✓ Catálogos cargados: …
   [release] ✓ Admin creado desde ADMIN_EMAIL.
   Server listening on http://localhost:3000
   ```
8. Después del primer deploy puedes quitar `ADMIN_PASSWORD` de las variables (ya no se usa).

## 3. DNS (Cloudflare, zona `rafaymon.com`)

Registro **A** `menu` → IP del servidor de Coolify, **DNS only** (nube gris), igual que `auth`/`books`.
Con el proxy de Cloudflare apagado, Coolify emite el certificado de Let's Encrypt por HTTP.
(Si lo quieres "proxied", pon SSL/TLS de Cloudflare en *Full (strict)*.)

## 4. Verificación

- `https://menu.rafaymon.com/health` → `{"ok":true,"db":true}`
- Entra con el admin, crea una receta con foto (debe quedar en `family-menu/recetas/` del bucket).
- *Mi cuenta → Tokens* → crea un token y conecta Claude Code:
  `claude mcp add --transport http family-menu https://menu.rafaymon.com/mcp --header "Authorization: Bearer fm_…"`

## Actualizaciones

`git push` a `main` → Coolify reconstruye (activa *Auto Deploy* / webhook de GitHub). Las migraciones
nuevas se aplican solas al arrancar. Para revertir, *Rollback* en Coolify a la imagen anterior
(las migraciones son aditivas; revisa antes si una versión borró columnas).

## Notas de seguridad

- El contenedor solo debe ser accesible a través de Traefik (`TRUST_PROXY=true` confía en `X-Forwarded-*`).
- Cookies de sesión `__Secure-…`, `HttpOnly`, `SameSite=Lax`; formularios protegidos contra CSRF (`cop`).
- Sin registro público: los miembros los crea el admin en `/admin/miembros`.
- Los tokens MCP se pueden revocar en *Mi cuenta*; cada llamada queda en `audit_log`.
