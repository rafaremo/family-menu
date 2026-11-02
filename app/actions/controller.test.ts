import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { router } from '../router.ts'
import { routes } from '../routes.ts'

describe('root controller', () => {
  it('GET / returns the home page', async () => {
    let response = await router.fetch(new URL(routes.home.href(), 'http://localhost'))

    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type') ?? '', /text\/html/)
    assert.match(await response.text(), /<html[\s>]/)
  })

  it('GET /health reports database status', async () => {
    let response = await router.fetch(new URL(routes.health.href(), 'http://localhost'))
    let body = (await response.json()) as { ok: boolean; db: boolean }

    assert.equal(response.status, body.db ? 200 : 503)
    assert.equal(typeof body.db, 'boolean')
  })
})
