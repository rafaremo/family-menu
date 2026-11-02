import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { TINY_JPEG, TINY_PNG } from '../../test/helpers.ts'
import { sniffImage } from './image.ts'
import { formatQuantity, parseQuantity, QuantityError } from './quantity.ts'

describe('parseQuantity', () => {
  it('parses integers, decimals (dot or comma) and fractions', () => {
    assert.equal(parseQuantity('2'), 2)
    assert.equal(parseQuantity('0.5'), 0.5)
    assert.equal(parseQuantity('0,5'), 0.5)
    assert.equal(parseQuantity('1/2'), 0.5)
    assert.equal(parseQuantity('1 1/2'), 1.5)
    assert.equal(parseQuantity('½'), 0.5)
    assert.equal(parseQuantity('1½'), 1.5)
    assert.equal(parseQuantity('1 ¼'), 1.25)
    assert.equal(parseQuantity('⅓'), 0.3333)
    assert.equal(parseQuantity(3), 3)
  })

  it('treats blanks and “al gusto” as no quantity', () => {
    assert.equal(parseQuantity(''), null)
    assert.equal(parseQuantity('  '), null)
    assert.equal(parseQuantity('al gusto'), null)
    assert.equal(parseQuantity('Al Gusto'), null)
    assert.equal(parseQuantity(null), null)
  })

  it('rejects nonsense, zero and division by zero', () => {
    for (let bad of ['mucho', '1/0', '0', '-2', '2-3', '1 2 3', 'abc 1']) {
      assert.throws(() => parseQuantity(bad), QuantityError, bad)
    }
  })
})

describe('formatQuantity', () => {
  it('formats with kitchen-friendly fractions', () => {
    assert.equal(formatQuantity(2), '2')
    assert.equal(formatQuantity(0.5), '½')
    assert.equal(formatQuantity(1.5), '1 ½')
    assert.equal(formatQuantity(0.3333), '⅓')
    assert.equal(formatQuantity(2.75), '2 ¾')
    assert.equal(formatQuantity(2.4), '2.4')
    assert.equal(formatQuantity(333.33), '333')
    assert.equal(formatQuantity(null), '')
  })

  it('has a plain mode that parseQuantity reads back', () => {
    for (let n of [0.5, 1.5, 0.25, 2.75, 0.3333, 3]) {
      let text = formatQuantity(n, { plain: true })
      assert.ok(Math.abs(parseQuantity(text)! - n) < 0.01, `${n} → ${text}`)
    }
  })
})

describe('sniffImage', () => {
  it('detects PNG and JPEG with dimensions', () => {
    assert.deepEqual(sniffImage(TINY_PNG), { type: 'image/png', ext: 'png', width: 1, height: 1 })
    assert.deepEqual(sniffImage(TINY_JPEG), { type: 'image/jpeg', ext: 'jpg', width: 64, height: 32 })
  })

  it('detects GIF and rejects non-images', () => {
    let gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0a, 0x00, 0x05, 0x00, 0, 0])
    assert.deepEqual(sniffImage(gif), { type: 'image/gif', ext: 'gif', width: 10, height: 5 })
    assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null)
    assert.equal(sniffImage(new Uint8Array()), null)
  })
})
