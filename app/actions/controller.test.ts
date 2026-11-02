import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { request } from '../../test/helpers.ts'

describe('root controller', () => {
  it('GET /health reports database status', async () => {
    let response = await request('/health')
    let body = (await response.json()) as { ok: boolean; db: boolean }

    assert.equal(response.status, 200)
    assert.equal(body.db, true)
  })

  it('serves the stylesheet', async () => {
    let response = await request('/styles.css')
    assert.equal(response.status, 200)
  })
})
