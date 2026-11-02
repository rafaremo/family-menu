import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { auth } from '../auth/auth.ts'
import { pingDb } from '../db/client.ts'
import { routes } from '../routes.ts'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },

    async health() {
      let db = await pingDb()
      return Response.json({ ok: db, db }, { status: db ? 200 : 503 })
    },

    authApi(context) {
      return auth.handler(context.request)
    },

    async logout(context) {
      let headers = new Headers()
      try {
        let result = await auth.api.signOut({ headers: context.headers, returnHeaders: true })
        for (let cookie of result.headers.getSetCookie()) headers.append('Set-Cookie', cookie)
      } catch {
        // Sin sesión válida: solo regresamos al login.
      }
      headers.set('Location', routes.login.index.href())
      return new Response(null, { status: 303, headers })
    },
  },
})
