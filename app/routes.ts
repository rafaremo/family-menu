import { form, get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  health: get('/health'),
  dashboard: { home: get('/') },

  // Better Auth (cualquier método)
  authApi: '/api/auth/*path',

  login: form('/login'),
  logout: post('/logout'),

  account: route('/cuenta', {
    index: get('/'),
    password: post('/password'),
  }),

  admin: {
    members: route('/admin/miembros', {
      index: get('/'),
      create: post('/'),
      role: post('/:id/rol'),
      password: post('/:id/password'),
      ban: post('/:id/desactivar'),
      unban: post('/:id/activar'),
      destroy: post('/:id/eliminar'),
    }),
  },
})
