import { get, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  health: get('/health'),
  home: '/',
})
