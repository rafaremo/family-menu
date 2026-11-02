/**
 * Verifica el almacenamiento configurado (R2 o disco): escribe, lee, lista y borra un archivo de prueba.
 * Uso: npm run storage:check
 */
import { appStorageConfig, namespacedStorage } from '../app/lib/storage.ts'

let config = appStorageConfig()
console.log(`Almacenamiento: ${config.description}`)

let storage = namespacedStorage('_check')
let key = `${crypto.randomUUID()}.txt`
let content = `family-menu storage check ${new Date().toISOString()}`

try {
  await storage.set(key, new File([content], 'check.txt', { type: 'text/plain' }))
  console.log('✓ escribir')

  let file = await storage.get(key)
  if (!file || (await file.text()) !== content) throw new Error('El archivo leído no coincide.')
  console.log(`✓ leer (${file.type}, ${file.size} bytes)`)

  let listed = await storage.list({ limit: 10 })
  if (!listed.files.some((f) => f.key === key)) throw new Error('El archivo no aparece al listar.')
  console.log('✓ listar')

  await storage.remove(key)
  if (await storage.has(key)) throw new Error('El archivo sigue existiendo después de borrarlo.')
  console.log('✓ borrar')
  console.log('Todo bien.')
} catch (error) {
  console.error('✗', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
