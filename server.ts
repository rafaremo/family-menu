import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { appStorageConfig } from './app/lib/storage.ts'
import { router } from './app/router.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3010
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null
const isHmr = process.env.REMIX_NODE_HMR === '1'
// Detrás de un proxy (Coolify/Traefik) usamos X-Forwarded-Proto/Host para que request.url sea
// la URL pública (https). Solo es seguro si el contenedor no es accesible sin pasar por el proxy.
const trustProxy = isHmr || (process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true'

// Falla al arrancar (no al subir la primera foto) si el almacenamiento está mal configurado.
const storage = appStorageConfig()

const server = http.createServer(createRequestListener(router.fetch, { trustProxy }))

server.listen(port, () => {
  if (isHmr) {
    import('remix/node-hmr/runtime').then((nodeHmr) => nodeHmr.emitServerReady())
  }

  console.log(`Server listening on http://localhost:${hmrProxyPort ?? port}`)
  console.log(`Archivos: ${storage.description}`)
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
