import type { FileStorage, ListOptions, ListResult } from 'remix/file-storage'
import { createFsFileStorage } from 'remix/file-storage/fs'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createS3FileStorage } from 'remix/file-storage/s3'

/**
 * Almacenamiento de archivos de la app (fotos de recetas y lo que venga después).
 *
 * - **R2 (Cloudflare)** si hay `R2_BUCKET`: todo queda bajo `R2_PREFIX` (default `family-menu/`),
 *   así el bucket se puede compartir con otras cosas de la familia.
 * - **Disco** (`UPLOADS_DIR`) si no hay R2.
 * - **Memoria** en pruebas.
 *
 * Los archivos nunca se ligan directo al bucket: la app los sirve con sesión (`/fotos/...`),
 * así que da igual si el bucket tiene un dominio público.
 */

export type StorageDriver = 'r2' | 'fs' | 'memory'

export interface StorageConfig {
  driver: StorageDriver
  /** Descripción legible para logs (sin secretos). */
  description: string
}

type Env = Record<string, string | undefined>

const R2_REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

export function storageDriver(env: Env = process.env): StorageDriver {
  if (env.NODE_ENV === 'test' && !env.STORAGE_FORCE) return 'memory'
  if (env.R2_BUCKET) return 'r2'
  return 'fs'
}

/** Normaliza un prefijo: "family-menu" → "family-menu/", "" → "". */
export function normalizePrefix(prefix: string | undefined): string {
  let p = (prefix ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (p && !/^[a-zA-Z0-9._\-/]+$/.test(p)) throw new Error(`Prefijo de almacenamiento inválido: "${prefix}"`)
  return p ? `${p}/` : ''
}

/** Envuelve un storage para que todas las llaves vivan bajo `prefix`. */
export function prefixedStorage(storage: FileStorage, prefix: string): FileStorage {
  let p = normalizePrefix(prefix)
  if (!p) return storage
  let key = (k: string) => `${p}${k}`
  return {
    get: (k) => storage.get(key(k)),
    has: (k) => storage.has(key(k)),
    put: (k, file) => storage.put(key(k), file),
    remove: (k) => storage.remove(key(k)),
    set: (k, file) => storage.set(key(k), file),
    async list<T extends ListOptions>(options?: T): Promise<ListResult<T>> {
      let result = await storage.list({ ...options, prefix: key(options?.prefix ?? '') } as T)
      return { ...result, files: result.files.map((f) => ({ ...f, key: f.key.slice(p.length) })) }
    },
  }
}

export function createAppStorage(env: Env = process.env, options: { fetch?: typeof fetch } = {}): {
  storage: FileStorage
  config: StorageConfig
} {
  let driver = storageDriver(env)

  if (driver === 'memory') {
    return { storage: createMemoryFileStorage(), config: { driver, description: 'memoria (pruebas)' } }
  }

  if (driver === 'fs') {
    let dir = env.UPLOADS_DIR ?? './uploads'
    return { storage: createFsFileStorage(dir), config: { driver, description: `disco (${dir})` } }
  }

  let missing = R2_REQUIRED.filter((name) => !env[name])
  if (missing.length) {
    throw new Error(`Falta configurar R2: ${missing.join(', ')}. (Quita R2_BUCKET para usar disco.)`)
  }
  let endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  let prefix = normalizePrefix(env.R2_PREFIX ?? 'family-menu')
  let s3 = createS3FileStorage({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET!,
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    fetch: options.fetch,
  })
  return {
    storage: prefixedStorage(s3, prefix),
    config: { driver, description: `R2 ${env.R2_BUCKET}/${prefix}` },
  }
}

let shared: { storage: FileStorage; config: StorageConfig } | undefined

/** Storage compartido de la app (se crea al primer uso). */
export function appStorage(): FileStorage {
  shared ??= createAppStorage()
  return shared.storage
}

export function appStorageConfig(): StorageConfig {
  shared ??= createAppStorage()
  return shared.config
}

/** Sub-espacio dentro del storage de la app: `namespace('recetas')` → `family-menu/recetas/...` en R2. */
export function namespacedStorage(namespace: string): FileStorage {
  return prefixedStorage(appStorage(), namespace)
}
