import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import * as zlib from 'node:zlib'

import { UserFacingError } from './errors.ts'

/**
 * Descarga una URL de internet de forma segura (para importar recetas y sus fotos):
 * - Solo http/https, puertos 80/443.
 * - Bloquea IPs privadas, loopback, link-local, metadata de nubes, etc. (anti-SSRF). La validación
 *   ocurre en el `lookup` del socket, así que también cubre DNS rebinding y cada redirección.
 * - Timeout total y límite de tamaño; descomprime gzip/br/deflate.
 */

export interface SafeFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  accept?: string
}

export interface SafeFetchResult {
  url: string
  status: number
  contentType: string
  body: Buffer
}

export const USER_AGENT = 'Mozilla/5.0 (compatible; FamilyMenu/1.0; recetario familiar) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

/** ¿La IP es pública? (rechaza rangos privados, reservados y especiales). */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    let [a, b] = ip.split('.').map(Number) as [number, number, number, number]
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a === 169 && b === 254) return false // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a >= 224) return false // multicast / reservado
    return true
  }
  if (net.isIPv6(ip)) {
    let lower = ip.toLowerCase()
    let mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPublicIp(mapped[1]!)
    if (lower === '::' || lower === '::1') return false
    if (/^f[cd]/.test(lower)) return false // ULA
    if (/^fe[89ab]/.test(lower)) return false // link-local
    if (/^ff/.test(lower)) return false // multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')) return false
    return true
  }
  return false
}

/** `lookup` que solo deja conectar a IPs públicas. */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error)
    let list = addresses as dns.LookupAddress[]
    let blocked = list.find((a) => !isPublicIp(a.address))
    if (blocked || !list.length) {
      return callback(Object.assign(new Error(`Dirección no permitida: ${hostname}`), { code: 'EBLOCKED' }))
    }
    if (options.all) callback(null, list)
    else callback(null, list[0]!.address, list[0]!.family)
  })
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new UserFacingError('Esa no parece una URL válida.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserFacingError('Solo se aceptan URLs http o https.')
  if (url.username || url.password) throw new UserFacingError('La URL no puede llevar usuario ni contraseña.')
  if (url.port && url.port !== '80' && url.port !== '443') throw new UserFacingError('Solo se aceptan los puertos 80 y 443.')
  let host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && !isPublicIp(host)) throw new UserFacingError('Esa dirección no está permitida.')
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UserFacingError('Esa dirección no está permitida.')
  return url
}

function requestOnce(url: URL, options: Required<SafeFetchOptions>, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let client = url.protocol === 'https:' ? https : http
    let remaining = Math.max(1, deadline - Date.now())
    let req = client.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup as unknown as typeof dns.lookup,
        timeout: remaining,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept,
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        let status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
        }
        let declared = Number(res.headers['content-length'])
        if (declared && declared > options.maxBytes) {
          res.destroy()
          return reject(new UserFacingError('El archivo es demasiado grande.', 413))
        }
        let encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
        let stream: NodeJS.ReadableStream = res
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip())
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress())

        let chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > options.maxBytes) {
            req.destroy()
            reject(new UserFacingError('El archivo es demasiado grande.', 413))
            return
          }
          chunks.push(chunk)
        })
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
        stream.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    req.end()
  })
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  let options: Required<SafeFetchOptions> = {
    maxBytes: opts.maxBytes ?? 5 * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? 12_000,
    maxRedirects: opts.maxRedirects ?? 5,
    accept: opts.accept ?? 'text/html,application/xhtml+xml',
  }
  let deadline = Date.now() + options.timeoutMs
  let url = assertFetchableUrl(raw)

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    let result
    try {
      result = await requestOnce(url, options, deadline)
    } catch (error) {
      if (error instanceof UserFacingError) throw error
      let code = (error as { code?: string }).code
      if (code === 'EBLOCKED') throw new UserFacingError('Esa dirección no está permitida.')
      if (code === 'ETIMEDOUT') throw new UserFacingError('La página tardó demasiado en responder.')
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new UserFacingError('No encontré ese sitio. Revisa la URL.')
      throw new UserFacingError('No se pudo descargar la página.')
    }
    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      url = assertFetchableUrl(new URL(String(result.headers.location), url).href)
      continue
    }
    if (result.status === 401 || result.status === 403 || result.status === 429) {
      throw new UserFacingError(`El sitio no dejó descargar la página (${result.status}). Algunos sitios bloquean descargas automáticas.`)
    }
    if (result.status === 404 || result.status === 410) throw new UserFacingError('Esa página no existe (404).')
    if (result.status < 200 || result.status >= 300) throw new UserFacingError(`El sitio respondió con error ${result.status}.`)
    return {
      url: url.href,
      status: result.status,
      contentType: String(result.headers['content-type'] ?? ''),
      body: result.body,
    }
  }
  throw new UserFacingError('Demasiadas redirecciones.')
}
