import * as z from 'zod'
import { formData } from 'remix/middleware/form-data'
import { createController } from 'remix/router'

import { auth } from '../../auth/auth.ts'
import { requireUser, sessionAuth } from '../../auth/middleware.ts'
import { toUserMessage } from '../../lib/errors.ts'
import { parseForm, passwordField } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { audit } from '../../services/audit.ts'
import { AccountPage } from './page.tsx'

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
}

export default createController(routes.account, {
  middleware: [sessionAuth, requireUser, formData()],
  actions: {
    index(context) {
      let ok = FLASH[context.url.searchParams.get('ok') ?? ''] ?? null
      return context.render(<AccountPage user={context.auth.identity} ok={ok} />)
    },

    password: {
      async handler(context) {
        let user = context.auth.identity
        let parsed = parseForm(passwordSchema, context.formData)
        if (!parsed.ok || !parsed.data) {
          return context.render(<AccountPage user={user} errors={parsed.errors} />, { status: 400 })
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
          return context.render(<AccountPage user={user} error={toUserMessage(error)} />, { status: 400 })
        }
      },
    },
  },
})
