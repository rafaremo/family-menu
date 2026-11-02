import { createController } from 'remix/router'

import { requireUser, sessionAuth } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { recentRecipes } from '../../services/recipes.ts'
import { HomePage } from './home-page.tsx'

export default createController(routes.dashboard, {
  middleware: [sessionAuth, requireUser],
  actions: {
    async home(context) {
      let user = context.auth.identity
      let recent = await recentRecipes(6, user.id)
      return context.render(<HomePage user={user} recent={recent} />)
    },
  },
})
