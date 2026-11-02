import { createController } from 'remix/router'

import { requireUser, sessionAuth } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { todayIso } from '../../lib/dates.ts'
import { menuForWeek } from '../../services/menus.ts'
import { recentRecipes } from '../../services/recipes.ts'
import { HomePage } from './home-page.tsx'

export default createController(routes.dashboard, {
  middleware: [sessionAuth, requireUser],
  actions: {
    async home(context) {
      let user = context.auth.identity
      let today = todayIso()
      let [recent, week] = await Promise.all([recentRecipes(6, user.id), menuForWeek(today)])
      return context.render(<HomePage user={user} recent={recent} week={week} today={today} />)
    },
  },
})
