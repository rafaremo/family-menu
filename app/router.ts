import { cop } from 'remix/middleware/cop'
import { render } from 'remix/middleware/render'
import { staticFiles } from 'remix/middleware/static'
import { createRouter, type RouterContext } from 'remix/router'

import accountController from './actions/account/controller.tsx'
import membersController from './actions/admin/members/controller.tsx'
import controller from './actions/controller.tsx'
import dashboardController from './actions/dashboard/controller.tsx'
import loginController from './actions/login/controller.tsx'
import { assets } from './assets.ts'
import { routes } from './routes.ts'

export const router = createRouter({
  middleware: [
    staticFiles('./public', { index: false }),
    // Rechaza POST/PUT/DELETE cross-site desde navegadores (CSRF sin tokens).
    // Las cookies de Better Auth además son SameSite=Lax.
    cop(),
    render({ assets }),
  ],
})

export type AppContext = RouterContext<typeof router>

declare module 'remix' {
  interface RouterTypes {
    context: AppContext
  }
}

router.map(routes, controller)
router.map(routes.dashboard, dashboardController)
router.map(routes.login, loginController)
router.map(routes.account, accountController)
router.map(routes.admin.members, membersController)
