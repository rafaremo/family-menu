import { createFileResponse } from 'remix/response/file'
import { createController } from 'remix/router'

import { requireUser, sessionAuth } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { getPhotoFile } from '../../services/photos.ts'

/** Sirve fotos de recetas solo a miembros con sesión. Las llaves son inmutables (uuid). */
export default createController(routes.photos, {
  middleware: [sessionAuth, requireUser],
  actions: {
    async show(context) {
      let file = await getPhotoFile(context.params.key)
      if (!file) return new Response('No encontrada', { status: 404 })
      let response = await createFileResponse(file, context.request, {
        cacheControl: 'private, max-age=31536000, immutable',
      })
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('Content-Security-Policy', "default-src 'none'")
      return response
    },
  },
})
