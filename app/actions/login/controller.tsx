import * as z from 'zod'
import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { auth } from '../../auth/auth.ts'
import { safeRedirectTo, sessionAuth } from '../../auth/middleware.ts'
import { toUserMessage } from '../../lib/errors.ts'
import { emailField, parseForm, readText } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { LoginPage } from './page.tsx'

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Escribe tu contraseña.'),
  redirectTo: z.string().optional(),
})

export default createController(routes.login, {
  middleware: [sessionAuth, formData()],
  actions: {
    index: {
      handler(context) {
        let redirectTo = safeRedirectTo(context.url.searchParams.get('redirectTo'))
        if (context.auth.ok) return redirect(redirectTo, 303)
        return context.render(<LoginPage redirectTo={redirectTo} />)
      },
    },

    action: {
      async handler(context) {
        let email = readText(context.formData, 'email')
        let redirectTo = safeRedirectTo(readText(context.formData, 'redirectTo'))
        let parsed = parseForm(loginSchema, context.formData)

        if (!parsed.ok || !parsed.data) {
          return context.render(<LoginPage email={email} redirectTo={redirectTo} errors={parsed.errors} />, {
            status: 400,
          })
        }

        try {
          let result = await auth.api.signInEmail({
            body: { email: parsed.data.email, password: parsed.data.password, rememberMe: true },
            headers: context.headers,
            returnHeaders: true,
          })

          let headers = new Headers({ Location: redirectTo })
          for (let cookie of result.headers.getSetCookie()) headers.append('Set-Cookie', cookie)
          return new Response(null, { status: 303, headers })
        } catch (error) {
          return context.render(
            <LoginPage email={email} redirectTo={redirectTo} error={toUserMessage(error, 'No se pudo iniciar sesión.')} />,
            { status: 401 },
          )
        }
      },
    },
  },
})
