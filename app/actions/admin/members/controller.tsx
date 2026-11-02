import * as z from 'zod'
import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { requireAdmin, requireUser, sessionAuth, type Identity } from '../../../auth/middleware.ts'
import { toUserMessage } from '../../../lib/errors.ts'
import { emailField, nameField, parseForm, passwordField, readText, roleField } from '../../../lib/validation.ts'
import { routes } from '../../../routes.ts'
import {
  banMember,
  createMember,
  listMembers,
  removeMember,
  setMemberPassword,
  setMemberRole,
  unbanMember,
  type Actor,
} from '../../../services/members.ts'
import { MembersPage, type MembersPageProps } from './page.tsx'

const createSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  role: roleField,
})

const roleSchema = z.object({ role: roleField })
const passwordSchema = z.object({ password: passwordField })

const FLASH: Record<string, string> = {
  created: 'Miembro agregado. Compártele su correo y contraseña.',
  role: 'Rol actualizado.',
  password: 'Contraseña restablecida y sesiones del miembro cerradas.',
  banned: 'Miembro desactivado.',
  unbanned: 'Miembro reactivado.',
  deleted: 'Miembro eliminado.',
}

const membersIndex = () => routes.admin.members.index.href()
const done = (code: keyof typeof FLASH) => redirect(`${membersIndex()}?ok=${code}`, 303)

async function renderPage(
  context: { render: (node: any, init?: ResponseInit) => Response | Promise<Response> },
  user: Identity,
  props: Partial<MembersPageProps> = {},
  status = 200,
) {
  let members = await listMembers()
  return context.render(<MembersPage user={user} members={members} {...props} />, { status })
}

function actorFrom(context: { auth: { identity: Identity }; headers: Headers }): Actor {
  return { identity: context.auth.identity, headers: context.headers, via: 'web' }
}

export default createController(routes.admin.members, {
  middleware: [sessionAuth, requireUser, requireAdmin(), formData()],
  actions: {
    async index(context) {
      let ok = FLASH[context.url.searchParams.get('ok') ?? ''] ?? null
      return renderPage(context, context.auth.identity, { ok })
    },

    async create(context) {
      let user = context.auth.identity
      let values = {
        name: readText(context.formData, 'name'),
        email: readText(context.formData, 'email'),
        role: readText(context.formData, 'role') || 'member',
      }
      let parsed = parseForm(createSchema, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderPage(context, user, { values, errors: parsed.errors }, 400)
      }
      try {
        await createMember(actorFrom(context), parsed.data)
        return done('created')
      } catch (error) {
        return renderPage(context, user, { values, error: toUserMessage(error) }, 400)
      }
    },

    async role(context) {
      let parsed = parseForm(roleSchema, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderPage(context, context.auth.identity, { error: 'Rol inválido.' }, 400)
      }
      try {
        await setMemberRole(actorFrom(context), context.params.id, parsed.data.role)
        return done('role')
      } catch (error) {
        return renderPage(context, context.auth.identity, { error: toUserMessage(error) }, 400)
      }
    },

    async password(context) {
      let parsed = parseForm(passwordSchema, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderPage(context, context.auth.identity, { error: parsed.errors.password ?? 'Contraseña inválida.' }, 400)
      }
      try {
        await setMemberPassword(actorFrom(context), context.params.id, parsed.data.password)
        return done('password')
      } catch (error) {
        return renderPage(context, context.auth.identity, { error: toUserMessage(error) }, 400)
      }
    },

    async ban(context) {
      try {
        await banMember(actorFrom(context), context.params.id)
        return done('banned')
      } catch (error) {
        return renderPage(context, context.auth.identity, { error: toUserMessage(error) }, 400)
      }
    },

    async unban(context) {
      try {
        await unbanMember(actorFrom(context), context.params.id)
        return done('unbanned')
      } catch (error) {
        return renderPage(context, context.auth.identity, { error: toUserMessage(error) }, 400)
      }
    },

    async destroy(context) {
      try {
        await removeMember(actorFrom(context), context.params.id)
        return done('deleted')
      } catch (error) {
        return renderPage(context, context.auth.identity, { error: toUserMessage(error) }, 400)
      }
    },
  },
})
