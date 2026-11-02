/**
 * Copia las fotos que existan en disco (UPLOADS_DIR, formato anterior: llave = "<uuid>.<ext>")
 * al almacenamiento configurado (R2 o disco bajo "recetas/"). Idempotente: salta las que ya existen.
 *
 * Uso: npm run storage:migrate            (copia)
 *      npm run storage:migrate -- --dry   (solo reporta)
 */
import { createFsFileStorage } from 'remix/file-storage/fs'

import { db, pool } from '../app/db/client.ts'
import { recipePhoto } from '../app/db/schema/index.ts'
import { appStorageConfig } from '../app/lib/storage.ts'
import { photoStorage } from '../app/services/photos.ts'

let dry = process.argv.includes('--dry')
let legacy = createFsFileStorage(process.env.UPLOADS_DIR ?? './uploads')
let target = photoStorage()
console.log(`Destino: ${appStorageConfig().description}${dry ? ' (simulación)' : ''}`)

let copied = 0
let present = 0
let missing: string[] = []

try {
  for (let photo of await db.select().from(recipePhoto)) {
    if (await target.has(photo.storageKey)) {
      present++
      continue
    }
    let file = await legacy.get(photo.storageKey)
    if (!file) {
      missing.push(photo.storageKey)
      continue
    }
    if (!dry) await target.set(photo.storageKey, new File([await file.arrayBuffer()], photo.storageKey, { type: photo.contentType }))
    copied++
  }
  console.log(`✓ ${dry ? 'por copiar' : 'copiadas'}: ${copied} · ya estaban: ${present} · sin archivo: ${missing.length}`)
  if (missing.length) console.log(`  Sin archivo en disco: ${missing.join(', ')}`)
} finally {
  await pool.end()
}
