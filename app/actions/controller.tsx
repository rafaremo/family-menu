import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { pingDb } from '../db/client.ts'
import { routes } from '../routes.ts'
import { HomePage } from './home-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    async health() {
      let db = await pingDb()
      return Response.json({ ok: db, db }, { status: db ? 200 : 503 })
    },
    home(context) {
      return context.render(<HomePage />)
    },
  },
})
