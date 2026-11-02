import type { Handle, RemixNode } from 'remix/component'

import { Document } from '../actions/document.tsx'
import type { Identity } from '../auth/middleware.ts'
import { routes } from '../routes.ts'

export type Section = 'home' | 'recetas' | 'ingredientes' | 'menus' | 'listas' | 'catalogos' | 'admin' | 'cuenta'

export interface LayoutProps {
  title: string
  user: Identity
  section?: Section
  children?: RemixNode
}

interface NavItem {
  section: Section
  label: string
  href?: string
  adminOnly?: boolean
}

export function Layout(handle: Handle<LayoutProps>) {
  return () => {
    let { title, user, section, children } = handle.props

    let items: NavItem[] = [
      { section: 'home', label: 'Inicio', href: routes.dashboard.home.href() },
      { section: 'recetas', label: 'Recetas', href: routes.recipes.index.href() },
      { section: 'ingredientes', label: 'Ingredientes', href: routes.ingredients.index.href() },
      { section: 'menus', label: 'Menús', href: routes.menus.index.href() },
      { section: 'listas', label: 'Listas', href: routes.lists.index.href() },
      { section: 'catalogos', label: 'Catálogos', href: routes.catalogs.index.href(), adminOnly: true },
      { section: 'admin', label: 'Miembros', href: routes.admin.members.index.href(), adminOnly: true },
    ]

    return (
      <Document title={title}>
        <header class="topbar">
          <a class="brand" href={routes.dashboard.home.href()}>
            🍲 Family Menu
          </a>
          <nav class="nav" aria-label="Principal">
            {items
              .filter((item) => !item.adminOnly || user.role === 'admin')
              .map((item) =>
                item.href ? (
                  <a
                    key={item.section}
                    href={item.href}
                    aria-current={item.section === section ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                ) : (
                  <span key={item.section} class="soon" title="Próximamente">
                    {item.label}
                  </span>
                ),
              )}
          </nav>
          <div class="userbox">
            <a href={routes.account.index.href()} aria-current={section === 'cuenta' ? 'page' : undefined}>
              {user.name}
            </a>
            <form class="inline" method="post" action={routes.logout.href()}>
              <button type="submit" class="secondary small">
                Salir
              </button>
            </form>
          </div>
        </header>
        <main class="container">{children}</main>
      </Document>
    )
  }
}

/** Mensaje de resultado (?ok=... / ?error=...) tras un redirect. */
export function Flash(handle: Handle<{ ok?: string | null; error?: string | null }>) {
  return () => {
    let { ok, error } = handle.props
    return (
      <>
        {ok ? (
          <p class="alert ok" role="status">
            {ok}
          </p>
        ) : null}
        {error ? (
          <p class="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    )
  }
}

/** Página 404 dentro del layout. */
export function NotFound(handle: Handle<{ user: Identity; message?: string; backHref?: string; backLabel?: string }>) {
  return () => {
    let { user, message, backHref, backLabel } = handle.props
    return (
      <Layout title="No encontrado" user={user}>
        <h1>No encontrado</h1>
        <p class="muted">{message ?? 'Lo que buscas no existe o fue eliminado.'}</p>
        {backHref ? (
          <p>
            <a class="button secondary" href={backHref}>
              {backLabel ?? 'Regresar'}
            </a>
          </p>
        ) : null}
      </Layout>
    )
  }
}
