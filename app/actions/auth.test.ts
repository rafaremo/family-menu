import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { auditLog, user } from '../db/schema/index.ts'
import { router } from '../router.ts'
import { cookieFrom, createUser, login, ORIGIN, request, resetDb } from '../../test/helpers.ts'

const ADMIN = { email: 'admin@test.local', password: 'admin-secreto-1', name: 'Rafa Admin', role: 'admin' as const }
const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }

describe('login / logout', () => {
  beforeEach(async () => {
    await resetDb()
    await createUser(ADMIN)
  })

  it('redirects anonymous users to /login', async () => {
    let response = await request('/')
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), '/login')

    let deep = await request('/admin/miembros')
    assert.equal(deep.headers.get('Location'), '/login?redirectTo=%2Fadmin%2Fmiembros')
  })

  it('renders the login page in Spanish', async () => {
    let response = await request('/login')
    let html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /<html lang="es"/)
    assert.match(html, /Inicia sesión/)
  })

  it('rejects a wrong password', async () => {
    let response = await request('/login', { form: { email: ADMIN.email, password: 'incorrecta' } })
    assert.equal(response.status, 401)
    assert.match(await response.text(), /Correo o contraseña incorrectos/)
  })

  it('validates the form', async () => {
    let response = await request('/login', { form: { email: 'no-es-correo', password: '' } })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Escribe un correo válido/)
  })

  it('logs in, shows the dashboard and logs out', async () => {
    let response = await request('/login', { form: { email: ADMIN.email, password: ADMIN.password } })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), '/')
    let cookie = cookieFrom(response)
    assert.ok(cookie.includes('family-menu.session_token'))

    let home = await request('/', { cookie })
    assert.equal(home.status, 200)
    assert.match(await home.text(), /Hola, Rafa/)

    let logout = await request('/logout', { form: {}, cookie })
    assert.equal(logout.status, 303)
    assert.equal(logout.headers.get('Location'), '/login')

    let after = await request('/', { cookie })
    assert.equal(after.status, 303)
  })

  it('honors a safe redirectTo and ignores external ones', async () => {
    let ok = await request('/login', { form: { email: ADMIN.email, password: ADMIN.password, redirectTo: '/cuenta' } })
    assert.equal(ok.headers.get('Location'), '/cuenta')

    let evil = await request('/login', {
      form: { email: ADMIN.email, password: ADMIN.password, redirectTo: '//evil.example' },
    })
    assert.equal(evil.headers.get('Location'), '/')
  })

  it('has no public sign-up', async () => {
    let response = await router.fetch(
      new Request(new URL('/api/auth/sign-up/email', ORIGIN), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email: 'intruso@test.local', password: 'intruso-123456', name: 'Intruso' }),
      }),
    )
    // Better Auth responde con error; nunca crea el usuario.
    assert.ok(response.status >= 400)
    let rows = await db.select().from(user)
    assert.equal(rows.length, 1)
  })

  it('blocks cross-site form posts (CSRF)', async () => {
    let response = await request('/login', {
      form: { email: ADMIN.email, password: ADMIN.password },
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(response.status, 403)
  })
})

describe('admin: miembros', () => {
  let adminCookie = ''

  beforeEach(async () => {
    await resetDb()
    await createUser(ADMIN)
    adminCookie = await login(ADMIN.email, ADMIN.password)
  })

  it('admin creates a member who can then log in, but cannot see admin pages', async () => {
    let created = await request('/admin/miembros', { form: { ...MEMBER }, cookie: adminCookie })
    assert.equal(created.status, 303)
    assert.equal(created.headers.get('Location'), '/admin/miembros?ok=created')

    let list = await request('/admin/miembros?ok=created', { cookie: adminCookie })
    let html = await list.text()
    assert.match(html, /Mon Miembro/)
    assert.match(html, /Miembro agregado/)

    let memberCookie = await login(MEMBER.email, MEMBER.password)
    let forbidden = await request('/admin/miembros', { cookie: memberCookie })
    assert.equal(forbidden.status, 403)

    let forbiddenPost = await request('/admin/miembros', {
      form: { name: 'X', email: 'x@test.local', password: '12345678', role: 'admin' },
      cookie: memberCookie,
    })
    assert.equal(forbiddenPost.status, 403)

    let home = await request('/', { cookie: memberCookie })
    assert.doesNotMatch(await home.text(), /href="\/admin\/miembros"/)

    let [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'create'))
    assert.equal(audit?.entity, 'member')
  })

  it('shows validation and duplicate errors', async () => {
    let invalid = await request('/admin/miembros', {
      form: { name: '', email: 'malo', password: '123', role: 'member' },
      cookie: adminCookie,
    })
    assert.equal(invalid.status, 400)
    let html = await invalid.text()
    assert.match(html, /Escribe un nombre/)
    assert.match(html, /Mínimo 8 caracteres/)

    await createUser(MEMBER)
    let dup = await request('/admin/miembros', { form: { ...MEMBER }, cookie: adminCookie })
    assert.equal(dup.status, 400)
    assert.match(await dup.text(), /Ya existe un miembro con ese correo/)
  })

  it('changes roles, but never the admin’s own', async () => {
    let member = await createUser(MEMBER)

    let promote = await request(`/admin/miembros/${member.id}/rol`, { form: { role: 'admin' }, cookie: adminCookie })
    assert.equal(promote.status, 303)
    let [row] = await db.select().from(user).where(eq(user.id, member.id))
    assert.equal(row?.role, 'admin')

    let [me] = await db.select().from(user).where(eq(user.email, ADMIN.email))
    let self = await request(`/admin/miembros/${me!.id}/rol`, { form: { role: 'member' }, cookie: adminCookie })
    assert.equal(self.status, 400)
    assert.match(await self.text(), /No puedes cambiar tu propio rol/)
  })

  it('bans and unbans a member', async () => {
    let member = await createUser(MEMBER)
    let memberCookie = await login(MEMBER.email, MEMBER.password)

    let ban = await request(`/admin/miembros/${member.id}/desactivar`, { form: {}, cookie: adminCookie })
    assert.equal(ban.status, 303)

    // Sus sesiones se cierran y ya no puede entrar.
    assert.equal((await request('/', { cookie: memberCookie })).status, 303)
    let relogin = await request('/login', { form: { email: MEMBER.email, password: MEMBER.password } })
    assert.equal(relogin.status, 401)
    assert.match(await relogin.text(), /desactivada/)

    let unban = await request(`/admin/miembros/${member.id}/activar`, { form: {}, cookie: adminCookie })
    assert.equal(unban.status, 303)
    await login(MEMBER.email, MEMBER.password)
  })

  it('cannot ban or delete themselves', async () => {
    let [me] = await db.select().from(user).where(eq(user.email, ADMIN.email))
    let ban = await request(`/admin/miembros/${me!.id}/desactivar`, { form: {}, cookie: adminCookie })
    assert.equal(ban.status, 400)
    let del = await request(`/admin/miembros/${me!.id}/eliminar`, { form: {}, cookie: adminCookie })
    assert.equal(del.status, 400)
  })

  it('fixes a member name and email; they log in with the new email', async () => {
    let member = await createUser(MEMBER)
    let res = await request(`/admin/miembros/${member.id}/datos`, {
      form: { name: '  Monse Corregida ', email: 'Monse@Test.local' },
      cookie: adminCookie,
    })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('Location'), '/admin/miembros?ok=updated')
    let [row] = await db.select().from(user).where(eq(user.id, member.id))
    assert.equal(row?.name, 'Monse Corregida')
    assert.equal(row?.email, 'monse@test.local')
    await login('monse@test.local', MEMBER.password)
    let old = await request('/login', { form: { email: MEMBER.email, password: MEMBER.password } })
    assert.equal(old.status, 401)

    let [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'update'))
    assert.equal(entry?.entity, 'member')

    // Correo ya usado por otro miembro, y validación.
    let dup = await request(`/admin/miembros/${member.id}/datos`, { form: { name: 'Monse', email: ADMIN.email }, cookie: adminCookie })
    assert.equal(dup.status, 400)
    assert.match(await dup.text(), /Ya existe un miembro con ese correo/)
    let empty = await request(`/admin/miembros/${member.id}/datos`, { form: { name: ' ', email: 'monse@test.local' }, cookie: adminCookie })
    assert.equal(empty.status, 400)
    assert.match(await empty.text(), /Escribe un nombre/)

    // Un miembro normal no puede editar a nadie.
    let memberCookie = await login('monse@test.local', MEMBER.password)
    let forbidden = await request(`/admin/miembros/${member.id}/datos`, { form: { name: 'X', email: 'x@test.local' }, cookie: memberCookie })
    assert.equal(forbidden.status, 403)
  })

  it('shows the MCP server URL to copy on the home page and in Mi cuenta', async () => {
    let home = await (await request('/', { cookie: adminCookie })).text()
    assert.match(home, /id="mcp-url"[^>]*value="https?:\/\/[^"]+\/mcp"|value="https?:\/\/[^"]+\/mcp"[^>]*id="mcp-url"/)
    assert.match(home, /href="\/cuenta#tokens"/)
    let account = await (await request('/cuenta', { cookie: adminCookie })).text()
    assert.match(account, /URL del servidor MCP/)
  })

  it('resets a member password and deletes a member', async () => {
    let member = await createUser(MEMBER)
    let reset = await request(`/admin/miembros/${member.id}/password`, {
      form: { password: 'nueva-clave-123' },
      cookie: adminCookie,
    })
    assert.equal(reset.status, 303)
    await login(MEMBER.email, 'nueva-clave-123')

    let del = await request(`/admin/miembros/${member.id}/eliminar`, { form: {}, cookie: adminCookie })
    assert.equal(del.status, 303)
    let rows = await db.select().from(user).where(eq(user.id, member.id))
    assert.equal(rows.length, 0)
  })
})

describe('mi cuenta', () => {
  beforeEach(async () => {
    await resetDb()
    await createUser(MEMBER)
  })

  it('changes own password', async () => {
    let cookie = await login(MEMBER.email, MEMBER.password)

    let wrong = await request('/cuenta/password', {
      form: { currentPassword: 'mala', newPassword: 'otra-clave-123', confirmPassword: 'otra-clave-123' },
      cookie,
    })
    assert.equal(wrong.status, 400)

    let mismatch = await request('/cuenta/password', {
      form: { currentPassword: MEMBER.password, newPassword: 'otra-clave-123', confirmPassword: 'distinta-123' },
      cookie,
    })
    assert.equal(mismatch.status, 400)
    assert.match(await mismatch.text(), /no coinciden/)

    let ok = await request('/cuenta/password', {
      form: { currentPassword: MEMBER.password, newPassword: 'otra-clave-123', confirmPassword: 'otra-clave-123' },
      cookie,
    })
    assert.equal(ok.status, 303)
    assert.equal(ok.headers.get('Location'), '/cuenta?ok=password')

    await login(MEMBER.email, 'otra-clave-123')
  })
})
