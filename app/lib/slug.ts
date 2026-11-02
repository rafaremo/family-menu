/** Quita acentos/diacríticos ("Limón" → "Limon"). La ñ se conserva como n. */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '')
}

/** Clave para comparar nombres: minúsculas, sin acentos, espacios colapsados. */
export function normalizeKey(value: string): string {
  return stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** "Chile poblano (grande)" → "chile-poblano-grande" */
export function slugify(value: string): string {
  return (
    stripAccents(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  )
}

/** Recorta y colapsa espacios internos. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
