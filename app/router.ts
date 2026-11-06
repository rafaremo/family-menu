import { cop } from 'remix/middleware/cop'
import { render } from 'remix/middleware/render'
import { staticFiles } from 'remix/middleware/static'
import { createRouter, type RouterContext } from 'remix/router'

import accountController from './actions/account/controller.tsx'
import apiController from './actions/api/controller.ts'
import membersController from './actions/admin/members/controller.tsx'
import catalogsController from './actions/catalogs/controller.tsx'
import ingredientsController from './actions/ingredients/controller.tsx'
import listsController from './actions/lists/controller.tsx'
import menusController from './actions/menus/controller.tsx'
import photosController from './actions/photos/controller.tsx'
import recipesController from './actions/recipes/controller.tsx'
import controller from './actions/controller.tsx'
import dashboardController from './actions/dashboard/controller.tsx'
import loginController from './actions/login/controller.tsx'
import mcpController from './actions/mcp/controller.ts'
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
router.map(routes.mcp, mcpController)
router.map(routes.api, apiController)
router.map(routes.account, accountController)
router.map(routes.ingredients, ingredientsController)
router.map(routes.recipes, recipesController)
router.map(routes.photos, photosController)
router.map(routes.menus, menusController)
router.map(routes.lists, listsController)
router.map(routes.catalogs, catalogsController)
router.map(routes.admin.members, membersController)
