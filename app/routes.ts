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

  ingredients: route('/ingredientes', {
    index: get('/'),
    new: get('/nuevo'),
    create: post('/'),
    edit: get('/:id'),
    update: post('/:id'),
    destroy: post('/:id/eliminar'),
    merge: post('/:id/fusionar'),
  }),

  recipes: route('/recetas', {
    index: get('/'),
    new: get('/nueva'),
    create: post('/'),
    show: get('/:slug'),
    edit: get('/:slug/editar'),
    update: post('/:slug/editar'),
    destroy: post('/:slug/eliminar'),
    favorite: post('/:slug/favorita'),
    photoAdd: post('/:slug/fotos'),
    photoCover: post('/:slug/fotos/:photoId/portada'),
    photoDestroy: post('/:slug/fotos/:photoId/eliminar'),
  }),

  photos: route('/fotos', {
    show: get('/*key'),
  }),

  catalogs: route('/catalogos', {
    index: get('/'),
    aisleCreate: post('/pasillos'),
    aisleUpdate: post('/pasillos/:id'),
    aisleDestroy: post('/pasillos/:id/eliminar'),
    storeCreate: post('/tiendas'),
    storeUpdate: post('/tiendas/:id'),
    storeDestroy: post('/tiendas/:id/eliminar'),
    unitCreate: post('/unidades'),
    unitUpdate: post('/unidades/:code'),
    unitDestroy: post('/unidades/:code/eliminar'),
    tagCreate: post('/etiquetas'),
    tagUpdate: post('/etiquetas/:id'),
    tagDestroy: post('/etiquetas/:id/eliminar'),
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
