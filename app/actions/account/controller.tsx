import * as z from 'zod'
import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { auth } from '../../auth/auth.ts'
import { requireUser, sessionAuth, type Identity } from '../../auth/middleware.ts'
import { toUserMessage } from '../../lib/errors.ts'
import { publicUrl } from '../../lib/url.ts'
import { parseForm, passwordField, readText } from '../../lib/validation.ts'
import { pathTokensAllowed } from '../../mcp/handler.ts'
import { routes } from '../../routes.ts'
import { audit } from '../../services/audit.ts'
import { createToken, listTokens, revokeToken } from '../../services/tokens.ts'
import { AccountPage, type AccountPageProps } from './page.tsx'

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Escribe tu contraseña actual.'),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  })

const FLASH: Record<string, string> = {
  password: 'Contraseña actualizada. Se cerraron tus otras sesiones.',
  revoked: 'Token revocado. Las apps que lo usaban ya no tienen acceso.',
}

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

async function renderAccount(
  context: Renderer,
  user: Identity,
  props: Partial<Omit<AccountPageProps, 'user' | 'tokens' | 'baseUrl' | 'pathTokensAllowed'>> = {},
  init: ResponseInit = {},
) {
  let tokens = await listTokens(user.id)
  return context.render(
    <AccountPage user={user} tokens={tokens} baseUrl={publicUrl('').replace(/\/$/, '')} pathTokensAllowed={pathTokensAllowed()} {...props} />,
    init,
  )
}

export default createController(routes.account, {
  middleware: [sessionAuth, requireUser, formData()],
  actions: {
    index(context) {
      let ok = FLASH[context.url.searchParams.get('ok') ?? ''] ?? null
      return renderAccount(context, context.auth.identity, { ok })
    },

    password: {
      async handler(context) {
        let user = context.auth.identity
        let parsed = parseForm(passwordSchema, context.formData)
        if (!parsed.ok || !parsed.data) {
          return renderAccount(context, user, { errors: parsed.errors }, { status: 400 })
        }

        try {
          let result = await auth.api.changePassword({
            body: {
              currentPassword: parsed.data.currentPassword,
              newPassword: parsed.data.newPassword,
              revokeOtherSessions: true,
            },
            headers: context.headers,
            returnHeaders: true,
          })
          await audit({ userId: user.id, via: 'web', action: 'change_password', entity: 'member', entityId: user.id })

          let headers = new Headers({ Location: `${routes.account.index.href()}?ok=password` })
          for (let cookie of result.headers.getSetCookie()) headers.append('Set-Cookie', cookie)
          return new Response(null, { status: 303, headers })
        } catch (error) {
          return renderAccount(context, user, { error: toUserMessage(error) }, { status: 400 })
        }
      },
    },

    async tokenCreate(context) {
      let user = context.auth.identity
      let days = Number(readText(context.formData, 'expiresInDays')) || null
      try {
        let token = await createToken({ userId: user.id, via: 'web' }, { name: readText(context.formData, 'name'), expiresInDays: days })
        // El token completo solo existe en esta respuesta: que nadie la guarde en caché.
        return renderAccount(context, user, { newToken: { name: token.name, key: token.key } }, { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        return renderAccount(context, user, { errors: { name: toUserMessage(error) } }, { status: 400 })
      }
    },

    async tokenRevoke(context) {
      let user = context.auth.identity
      try {
        await revokeToken({ userId: user.id, via: 'web' }, context.params.id)
        return redirect(`${routes.account.index.href()}?ok=revoked#tokens`, 303)
      } catch (error) {
        return renderAccount(context, user, { error: toUserMessage(error) }, { status: 404 })
      }
    },
  },
})
