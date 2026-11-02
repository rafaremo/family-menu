import { createController } from 'remix/router'

import { handleMcpRequest } from '../../mcp/handler.ts'
import { routes } from '../../routes.ts'

/** /mcp (Bearer) y /mcp/t/:token (token en la ruta). Sin sesión de navegador: solo tokens. */
export default createController(routes.mcp, {
  actions: {
    endpoint(context) {
      return handleMcpRequest(context.request)
    },
    withToken(context) {
      return handleMcpRequest(context.request, context.params.token)
    },
  },
})
