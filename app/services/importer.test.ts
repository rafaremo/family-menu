import { readFileSync } from 'node:fs'
import * as http from 'node:http'
import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import { assertFetchableUrl, isPublicIp, safeFetch } from '../lib/safe-fetch.ts'
import { resetDb } from '../../test/helpers.ts'
import { seedCatalogs } from './catalog-seed.ts'
import { parseIngredientLine, parseIngredientLines } from './ingredient-parser.ts'
import { decodeHtml, extractRecipe, importRecipeFromUrl, isoDurationToMinutes } from './importer.ts'

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/recipes/${name}`, import.meta.url), 'utf8')

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    assert.match((error as Error).message, pattern)
    return
  }
  assert.fail(`Se esperaba un error que coincidiera con ${pattern}`)
}

function p(line: string) {
  let r = parseIngredientLine(line)
  return [r.quantity, r.unit, r.name, r.preparation, r.optional]
}

describe('parser de ingredientes (español)', () => {
  it('reads quantities: integers, decimals, fractions, unicode, mixed, ranges and words', () => {
    assert.deepEqual(p('2 tazas de harina'), [2, 'taza', 'harina', null, false])
    assert.deepEqual(p('0,5 kg de carne molida'), [0.5, 'kg', 'carne molida', null, false])
    assert.deepEqual(p('1 ½ cdas. de aceite de oliva'), [1.5, 'cda', 'aceite de oliva', null, false])
    assert.deepEqual(p('1½ tazas de arroz'), [1.5, 'taza', 'arroz', null, false])
    assert.deepEqual(p('2 1/2 tazas de agua'), [2.5, 'taza', 'agua', null, false])
    assert.deepEqual(p('2-3 dientes de ajo'), [3, 'diente', 'ajo', null, false])
    assert.deepEqual(p('3 a 4 limones'), [4, null, 'limones', null, false])
    assert.deepEqual(p('Medio kilo de carne molida'), [0.5, 'kg', 'carne molida', null, false])
    assert.deepEqual(p('Una pizca de sal'), [1, 'pizca', 'sal', null, false])
    assert.deepEqual(p('un cuarto de cebolla'), [0.25, null, 'cebolla', null, false])
    assert.deepEqual(p('1 taza y media de leche'), [1.5, 'taza', 'leche', null, false])
  })

  it('understands Spanish unit spellings, "¼ de taza" and glued units', () => {
    assert.deepEqual(p('¼ de taza de aceite'), [0.25, 'taza', 'aceite', null, false])
    assert.deepEqual(p('1/3 de taza de cebolla blanca picada'), [0.3333, 'taza', 'cebolla blanca', 'picada', false])
    assert.deepEqual(p('1 cdta. de comino'), [1, 'cdta', 'comino', null, false])
    assert.deepEqual(p('2 cucharaditas de sal'), [2, 'cdta', 'sal', null, false])
    assert.deepEqual(p('3 cucharadas soperas de mantequilla'), [3, 'cda', 'mantequilla', null, false])
    assert.deepEqual(p('200g Queso manchego'), [200, 'g', 'Queso manchego', null, false])
    assert.deepEqual(p('250ml Salsa verde'), [250, 'ml', 'Salsa verde', null, false])
    assert.deepEqual(p('200 gram de fideo corto'), [200, 'g', 'fideo corto', null, false])
    assert.deepEqual(p('1 lt de leche'), [1, 'l', 'leche', null, false])
    assert.deepEqual(p('1 manojo de cilantro picado'), [1, 'manojo', 'cilantro', 'picado', false])
    assert.deepEqual(p('2 latas de atún'), [2, 'lata', 'atún', null, false])
  })

  it('separates preparation by comma, by markers and keeps parentheses as notes', () => {
    assert.deepEqual(p('1/2 cebolla blanca, fileteada'), [0.5, null, 'cebolla blanca', 'fileteada', false])
    assert.deepEqual(p('3 jitomates picados finamente'), [3, null, 'jitomates', 'picados finamente', false])
    assert.deepEqual(p('500 gr. de pechuga de pollo cocida y deshebrada'), [500, 'g', 'pechuga de pollo', 'cocida y deshebrada', false])
    assert.deepEqual(p('1 lata (400 g) de chiles chipotles'), [1, 'lata', 'chiles chipotles', '400 g', false])
    assert.deepEqual(p('4 chiles guajillo (sin semillas)'), [4, null, 'chiles guajillo', 'sin semillas', false])
    assert.deepEqual(p('1/2 kg de jitomates maduros (cortados en 4, o una lata)'), [0.5, 'kg', 'jitomates maduros', 'cortados en 4, o una lata', false])
    assert.deepEqual(p('Tostadas de maíz'), [null, null, 'Tostadas de maíz', null, false])
    assert.deepEqual(p('Aceite para freír'), [null, null, 'Aceite', 'para freír', false])
  })

  it('handles "al gusto", optional items and site quirks', () => {
    assert.deepEqual(p('Sal al gusto'), [null, null, 'Sal', null, false])
    assert.deepEqual(p('pimienta c/n'), [null, null, 'pimienta', null, false])
    assert.deepEqual(p('200 ml de crema (opcional)'), [200, 'ml', 'crema', null, true])
    assert.deepEqual(p('2count Pechugas de pollo'), [2, null, 'Pechugas de pollo', null, false])
    assert.deepEqual(p('null ¼ cebolla'), [0.25, null, 'cebolla', null, false])
    assert.deepEqual(p('- 2 huevos'), [2, null, 'huevos', null, false])
    let both = parseIngredientLines(['Sal y pimienta al gusto', '', '   '])
    assert.deepEqual(both.map((x) => [x.name, x.quantity]), [['Sal', null], ['pimienta', null]])
    // "y" dentro de un nombre con cantidad no se parte.
    assert.equal(parseIngredientLines(['1 taza de frijoles y caldo'])[0]!.name, 'frijoles y caldo')
  })
})

describe('extracción de recetas (fixtures de sitios)', () => {
  it('reads WordPress/Yoast @graph with sections, durations, yield arrays and ImageObject', () => {
    let r = extractRecipe(fixture('wordpress-yoast.html'), 'https://ejemplo.mx/pozole/')
    assert.equal(r.title, 'Pozole rojo de la casa')
    assert.equal(r.servings, 8)
    assert.equal(r.prepMinutes, 30)
    assert.equal(r.cookMinutes, 150)
    assert.equal(r.imageUrl, 'https://ejemplo.mx/wp-content/uploads/pozole.jpg')
    assert.equal(r.siteName, 'La Cocina de Mamá Rosa')
    assert.deepEqual(r.steps, [
      'Cuece la carne con ajo, cebolla y sal durante 2 horas.',
      'Agrega el maíz y cocina 30 minutos más.',
      'Licúa los chiles remojados con un poco de caldo y cuela.',
      'Vierte la salsa a la olla y rectifica la sal.',
    ])
    assert.equal(r.ingredients.length, 8)
    assert.deepEqual(r.ingredients.at(-1), { text: 'Rábanos, orégano y limones al gusto', group: 'Para servir' })
    assert.ok(r.keywords.includes('Sopas y caldos'))
  })

  it('reads Cookpad, Directo al Paladar (HTML instructions) and NewsArticle arrays', () => {
    let c = extractRecipe(fixture('cookpad.html'), 'https://cookpad.com/mx/recetas/1')
    assert.equal(c.servings, 4)
    assert.equal(c.steps.length, 2)
    assert.equal(c.imageUrl, 'https://img-global.cpcdn.com/recipes/abc/680x482cq70/chilaquiles.jpg')

    let d = extractRecipe(fixture('directo-al-paladar.html'), 'https://www.directoalpaladar.com.mx/x')
    assert.equal(d.title, 'Enchiladas verdes tradicionales')
    assert.deepEqual(d.steps, [
      'Vamos a poner a hervir las pechugas de pollo en una olla con agua y sal por 25 minutos.',
      'Calentamos la salsa verde.',
      'Horneamos a 200°C por 12 minutos.',
    ])
    assert.equal(d.prepMinutes, 35)
    assert.equal(d.cookMinutes, 3)
  })

  it('reads the embedded recipe object when JSON-LD is built with JavaScript (Kiwilimón)', () => {
    let k = extractRecipe(fixture('kiwilimon.html'), 'https://www.kiwilimon.com/receta/x')
    assert.equal(k.title, 'Clásica Tinga de Pollo')
    assert.equal(k.servings, 5)
    assert.equal(k.prepMinutes, 20)
    assert.equal(k.cookMinutes, 30)
    assert.equal(k.ingredients.length, 6)
    assert.equal(k.steps[2], 'Freír y agregar el pollo. Text with "quotes" and {braces}.')
    assert.equal(k.imageUrl, 'https://cdn7.kiwilimon.com/recetaimagen/51028/640x640/tinga.jpg.webp')
    assert.equal(k.approximate, undefined)
  })

  it('falls back to "Ingredientes"/"Preparación" headings when there is no structured data', () => {
    let a = extractRecipe(fixture('sin-datos-estructurados.html'), 'https://www.pequerecetas.com/receta/arroz/')
    assert.equal(a.approximate, true)
    assert.equal(a.title, 'Arroz rojo (receta tradicional)')
    assert.equal(a.ingredients.length, 5)
    assert.deepEqual(a.steps, [
      'Calentamos una cucharada de aceite y añadimos el arroz.',
      'Agregamos la cebolla picada.',
      'Batimos los tomates con el caldo.',
    ])
  })

  it('explains when a page has no recipe', () => {
    assert.throws(() => extractRecipe(fixture('no-es-receta.html'), 'https://blog.mx/'), /No encontré una receta/)
  })

  it('parses ISO 8601 durations and decodes Latin-1 pages', () => {
    assert.equal(isoDurationToMinutes('PT1H30M'), 90)
    assert.equal(isoDurationToMinutes('P0DT0H45M'), 45)
    assert.equal(isoDurationToMinutes('PT0S'), null)
    assert.equal(isoDurationToMinutes('30 min'), null)
    let latin1 = Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>Jalapeño</body></html>', 'latin1')
    assert.match(decodeHtml(latin1, 'text/html'), /Jalapeño/)
  })
})

describe('borrador y empate con el catálogo', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
  })

  it('matches catalog ingredients by alias, plural and extra words; keeps the rest as preparation', async () => {
    let draft = await importRecipeFromUrl('https://ejemplo.mx/pozole/', {
      fetchHtml: async (url) => ({ url, html: fixture('wordpress-yoast.html') }),
    })
    let by = new Map(draft.ingredients.map((i) => [i.raw, i]))
    let lomo = by.get('1 kg de lomo de cerdo en trozos')!
    assert.deepEqual([lomo.ingredient, lomo.matched, lomo.quantity, lomo.unit, lomo.preparation], ['Lomo de cerdo', true, 1, 'kg', 'en trozos'])
    let guajillo = by.get('6 chiles guajillo, desvenados')!
    assert.deepEqual([guajillo.ingredient, guajillo.matched, guajillo.preparation], ['Chile guajillo', true, 'desvenados'])
    assert.equal(by.get('1/2 cebolla blanca')!.ingredient, 'Cebolla blanca')
    let maiz = by.get('1 kg de maíz pozolero precocido')!
    assert.equal(maiz.matched, false)
    assert.equal(maiz.ingredient, 'Maíz pozolero precocido')
    assert.equal(by.get('1 lechuga finamente rebanada')!.group, 'Para servir')
    assert.deepEqual(draft.tags, ['Sopas y caldos'])
    assert.equal(draft.servings, 8)
    assert.equal(draft.approximate, false)

    let kiwi = await importRecipeFromUrl('https://www.kiwilimon.com/receta/x', {
      fetchHtml: async (url) => ({ url, html: fixture('kiwilimon.html') }),
    })
    assert.deepEqual(
      kiwi.ingredients.map((i) => i.ingredient),
      ['Pechuga de pollo', 'Jitomate', 'Ajo', 'Hoja de laurel', 'Chiles chipotles adobados', 'Sal'],
    )
    assert.ok(kiwi.ingredients.every((i) => i.matched))

    let dap = await importRecipeFromUrl('https://www.directoalpaladar.com.mx/x', {
      fetchHtml: async (url) => ({ url, html: fixture('directo-al-paladar.html') }),
    })
    assert.equal(dap.ingredients[0]!.ingredient, 'Pechuga de pollo')
    assert.equal(dap.ingredients[1]!.ingredient, 'Tortilla de maíz')
  })

  it('does not confuse "pasta de achiote" with pasta', async () => {
    let html = `<script type="application/ld+json">{"@type":"Recipe","name":"Cochinita","recipeIngredient":["1 cdta de pasta de achiote","200 g de pasta corta"]}</script>`
    let d = await importRecipeFromUrl('https://x.mx/', { fetchHtml: async (url) => ({ url, html }) })
    assert.deepEqual(d.ingredients.map((i) => [i.ingredient, i.matched]), [['Pasta de achiote', false], ['Pasta', true]])
  })
})

describe('descarga segura (anti-SSRF)', () => {
  let server: http.Server | null = null
  afterEach(() => {
    server?.close()
    server = null
  })

  it('classifies private and public IPs', () => {
    for (let ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isPublicIp(ip), false, ip)
    }
    for (let ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip)
  })

  it('rejects dangerous URLs before connecting', () => {
    for (let url of [
      'file:///etc/passwd',
      'ftp://ejemplo.mx/x',
      'http://localhost:3010/health',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data',
      'http://usuario:clave@ejemplo.mx/',
      'http://ejemplo.mx:8080/',
      'http://servidor.internal/',
      'no es url',
    ]) {
      assert.throws(() => assertFetchableUrl(url), Error, url)
    }
    assert.equal(assertFetchableUrl('https://www.kiwilimon.com/receta/x').hostname, 'www.kiwilimon.com')
  })

  it('never reaches a local server, even on the default port', async () => {
    let hits = 0
    server = http.createServer((_, res) => {
      hits++
      res.end('secreto')
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    let port = (server.address() as { port: number }).port
    await rejectsWith(safeFetch(`http://127.0.0.1:${port}/`), /no está permitida|puertos/)
    await rejectsWith(safeFetch('http://127.0.0.1/'), /no está permitida/)
    assert.equal(hits, 0)
  })
})
