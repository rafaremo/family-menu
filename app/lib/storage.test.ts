import * as assert from 'remix/assert'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { describe, it } from 'remix/test'

import { createAppStorage, normalizePrefix, prefixedStorage, storageDriver } from './storage.ts'

const R2_ENV = {
  NODE_ENV: 'production',
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'rafaymon-bucket',
}

describe('storage', () => {
  it('picks the driver from the environment', () => {
    assert.equal(storageDriver({ NODE_ENV: 'test', R2_BUCKET: 'x' }), 'memory')
    assert.equal(storageDriver({ NODE_ENV: 'production', R2_BUCKET: 'x' }), 'r2')
    assert.equal(storageDriver({ NODE_ENV: 'production' }), 'fs')
  })

  it('normalizes prefixes and rejects odd ones', () => {
    assert.equal(normalizePrefix('family-menu'), 'family-menu/')
    assert.equal(normalizePrefix('/family-menu/'), 'family-menu/')
    assert.equal(normalizePrefix(''), '')
    assert.throws(() => normalizePrefix('../x?y'))
  })

  it('namespaces keys under a prefix (and strips it when listing)', async () => {
    let base = createMemoryFileStorage()
    let scoped = prefixedStorage(prefixedStorage(base, 'family-menu'), 'recetas')
    await scoped.set('a.jpg', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    await base.set('otra-app/b.jpg', new File(['y'], 'b.jpg'))

    assert.ok(await base.has('family-menu/recetas/a.jpg'))
    assert.ok(await scoped.has('a.jpg'))
    assert.equal(await (await scoped.get('a.jpg'))!.text(), 'x')
    assert.deepEqual((await scoped.list()).files.map((f) => f.key), ['a.jpg'])
    await scoped.remove('a.jpg')
    assert.equal(await base.has('family-menu/recetas/a.jpg'), false)
    assert.ok(await base.has('otra-app/b.jpg'))
  })

  it('requires every R2 variable', () => {
    assert.throws(() => createAppStorage({ NODE_ENV: 'production', R2_BUCKET: 'b' }), /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/)
  })

  it('talks to the R2 S3 endpoint under the prefix, signed', async () => {
    let requests: Request[] = []
    let fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return new Response(null, { status: 200 })
    }) as typeof fetch

    let { storage, config } = createAppStorage(R2_ENV, { fetch: fakeFetch })
    assert.equal(config.description, 'R2 rafaymon-bucket/family-menu/')
    await prefixedStorage(storage, 'recetas').set('abc.jpg', new File(['hola'], 'abc.jpg', { type: 'image/jpeg' }))

    let put = requests.find((r) => r.method === 'PUT')!
    assert.equal(put.url, 'https://acct123.r2.cloudflarestorage.com/rafaymon-bucket/family-menu/recetas/abc.jpg')
    assert.match(put.headers.get('Authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\//)

    let custom = createAppStorage({ ...R2_ENV, R2_PREFIX: 'fm', R2_ENDPOINT: 'https://acct123.eu.r2.cloudflarestorage.com' }, { fetch: fakeFetch })
    await custom.storage.remove('x.jpg')
    assert.equal(requests.at(-1)!.url, 'https://acct123.eu.r2.cloudflarestorage.com/rafaymon-bucket/fm/x.jpg')
  })
})
