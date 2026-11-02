import { createController } from 'remix/router'

import { requireUser, sessionAuth } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { HomePage } from './home-page.tsx'

export default createController(routes.dashboard, {
  middleware: [sessionAuth, requireUser],
  actions: {
    home(context) {
      return context.render(<HomePage user={context.auth.identity} />)
    },
  },
})
