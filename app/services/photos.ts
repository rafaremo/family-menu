import { and, asc, eq, max } from 'drizzle-orm'
import type { FileStorage } from 'remix/file-storage'

import { db } from '../db/client.ts'
import { recipe, recipePhoto } from '../db/schema/index.ts'
import { UserFacingError } from '../lib/errors.ts'
import { sniffImage } from '../lib/image.ts'
import { safeFetch } from '../lib/safe-fetch.ts'
import { namespacedStorage } from '../lib/storage.ts'
import { audit, type ServiceActor } from './audit.ts'

/**
 * Fotos de recetas en el storage de la app (R2 o disco, ver `lib/storage.ts`), bajo `recetas/`.
 * Las llaves las genera el servidor; el nombre que manda el navegador nunca se usa como ruta.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_PHOTOS_PER_RECIPE = 12
export const PHOTO_KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/

let storage: FileStorage | undefined

export function photoStorage(): FileStorage {
  storage ??= namespacedStorage('recetas')
  return storage
}

export type RecipePhoto = typeof recipePhoto.$inferSelect

export async function listRecipePhotos(recipeId: number): Promise<RecipePhoto[]> {
  return db.select().from(recipePhoto).where(eq(recipePhoto.recipeId, recipeId)).orderBy(asc(recipePhoto.position), asc(recipePhoto.id))
}

/** Archivos vacíos (input sin elegir) se ignoran. */
export function realFiles(values: FormDataEntryValue[]): File[] {
  return values.filter((v): v is File => typeof v !== 'string' && v.size > 0)
}

/** Valida y guarda fotos. La primera foto de una receta sin portada se vuelve portada. */
export async function addRecipePhotos(actor: ServiceActor, recipeId: number, files: File[]): Promise<RecipePhoto[]> {
  if (!files.length) return []
  let [current] = await db
    .select({ coverPhotoId: recipe.coverPhotoId })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .limit(1)
  if (!current) throw new UserFacingError('Esa receta no existe.', 404)

  let existing = await listRecipePhotos(recipeId)
  if (existing.length + files.length > MAX_PHOTOS_PER_RECIPE) {
    throw new UserFacingError(`Máximo ${MAX_PHOTOS_PER_RECIPE} fotos por receta.`)
  }

  // Valida todo antes de guardar nada.
  let prepared = []
  for (let file of files) {
    if (file.size > MAX_PHOTO_BYTES) throw new UserFacingError(`"${file.name}" pesa más de 10 MB.`, 413)
    let bytes = new Uint8Array(await file.arrayBuffer())
    let info = sniffImage(bytes)
    if (!info) throw new UserFacingError(`"${file.name}" no es una imagen JPG, PNG, WEBP o GIF.`)
    prepared.push({ bytes, info })
  }

  let [{ top } = { top: null }] = await db
    .select({ top: max(recipePhoto.position) })
    .from(recipePhoto)
    .where(eq(recipePhoto.recipeId, recipeId))
  let position = (top ?? -1) + 1

  let saved: RecipePhoto[] = []
  for (let { bytes, info } of prepared) {
    let key = `${crypto.randomUUID()}.${info.ext}`
    await photoStorage().set(key, new File([bytes], key, { type: info.type }))
    let [row] = await db
      .insert(recipePhoto)
      .values({
        recipeId,
        storageKey: key,
        contentType: info.type,
        size: bytes.byteLength,
        width: info.width,
        height: info.height,
        position: position++,
        createdBy: actor.userId,
      })
      .returning()
    saved.push(row!)
  }

  if (!current.coverPhotoId) {
    await db.update(recipe).set({ coverPhotoId: saved[0]!.id }).where(eq(recipe.id, recipeId))
  }
  await audit({ ...actor, action: 'add_photos', entity: 'recipe', entityId: String(recipeId), details: { count: saved.length } })
  return saved
}

async function getPhoto(recipeId: number, photoId: number): Promise<RecipePhoto> {
  let [row] = await db
    .select()
    .from(recipePhoto)
    .where(and(eq(recipePhoto.id, photoId), eq(recipePhoto.recipeId, recipeId)))
    .limit(1)
  if (!row) throw new UserFacingError('Esa foto no existe.', 404)
  return row
}

export async function setCoverPhoto(actor: ServiceActor, recipeId: number, photoId: number): Promise<void> {
  await getPhoto(recipeId, photoId)
  await db.update(recipe).set({ coverPhotoId: photoId }).where(eq(recipe.id, recipeId))
  await audit({ ...actor, action: 'set_cover', entity: 'recipe', entityId: String(recipeId), details: { photoId } })
}

export async function removeRecipePhoto(actor: ServiceActor, recipeId: number, photoId: number): Promise<void> {
  let photo = await getPhoto(recipeId, photoId)
  await db.delete(recipePhoto).where(eq(recipePhoto.id, photoId))

  let [r] = await db.select({ coverPhotoId: recipe.coverPhotoId }).from(recipe).where(eq(recipe.id, recipeId))
  if (r?.coverPhotoId === photoId) {
    let [next] = await listRecipePhotos(recipeId)
    await db.update(recipe).set({ coverPhotoId: next?.id ?? null }).where(eq(recipe.id, recipeId))
  }
  await removeStoredFiles([photo.storageKey])
  await audit({ ...actor, action: 'remove_photo', entity: 'recipe', entityId: String(recipeId), details: { photoId } })
}

/** Borra archivos del almacenamiento (sin fallar si ya no existen). */
export async function removeStoredFiles(keys: string[]): Promise<void> {
  for (let key of keys) {
    try {
      await photoStorage().remove(key)
    } catch (error) {
      console.error('No se pudo borrar la foto', key, error)
    }
  }
}

export async function getPhotoFile(key: string): Promise<File | null> {
  if (!PHOTO_KEY_PATTERN.test(key)) return null
  let [row] = await db.select({ id: recipePhoto.id }).from(recipePhoto).where(eq(recipePhoto.storageKey, key)).limit(1)
  if (!row) return null
  return (await photoStorage().get(key)) ?? null
}

/** Descarga una foto de internet (p. ej. la de una receta importada) y la agrega a la receta. */
export async function addRecipePhotoFromUrl(actor: ServiceActor, recipeId: number, url: string): Promise<RecipePhoto> {
  let res = await safeFetch(url, { maxBytes: MAX_PHOTO_BYTES, accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' })
  let name = new URL(res.url).pathname.split('/').pop() || 'foto'
  let [photo] = await addRecipePhotos(actor, recipeId, [new File([new Uint8Array(res.body)], name, { type: res.contentType })])
  return photo!
}
