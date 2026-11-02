/**
 * Identifica imágenes por sus bytes (no confiamos en el Content-Type ni en el nombre del cliente)
 * y lee sus dimensiones sin dependencias nativas.
 */

export interface ImageInfo {
  type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  ext: 'jpg' | 'png' | 'webp' | 'gif'
  width: number | null
  height: number | null
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR con ancho/alto en 16..24
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { type: 'image/png', ext: 'png', width: view.getUint32(16), height: view.getUint32(20) }
  }

  // GIF87a / GIF89a
  if (bytes.length >= 10 && ascii(0, 4) === 'GIF8') {
    return { type: 'image/gif', ext: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }

  // WEBP: RIFF....WEBP
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    let chunk = ascii(12, 4)
    let width: number | null = null
    let height: number | null = null
    if (chunk === 'VP8X') {
      width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
      height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
    } else if (chunk === 'VP8 ') {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (chunk === 'VP8L') {
      let b = view.getUint32(21, true)
      width = (b & 0x3fff) + 1
      height = ((b >> 14) & 0x3fff) + 1
    }
    return { type: 'image/webp', ext: 'webp', width, height }
  }

  // JPEG: FF D8 FF; recorre segmentos hasta un SOFn
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      let marker = bytes[offset + 1]!
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      let length = view.getUint16(offset + 2)
      let isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { type: 'image/jpeg', ext: 'jpg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
      }
      offset += 2 + length
    }
    return { type: 'image/jpeg', ext: 'jpg', width: null, height: null }
  }

  return null
}
