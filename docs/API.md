# API REST (solo lectura) — listas del súper

Para pantallas, tablets o widgets que solo **muestran** las listas (p. ej. la pantalla táctil de la entrada).
Para editar cosas usa el dashboard o el MCP.

## Autenticación

`Authorization: Bearer <token>`. Crea el token en **Mi cuenta → Tokens** con tipo **Solo leer listas**:
no puede cambiar nada ni usarse en el MCP. (Los tokens "MCP completo" también pueden leer esta API.)

- Sin token / token inválido o revocado / dueño desactivado → `401`
- Más de 120 peticiones por minuto con el mismo token → `429` (`Retry-After: 60`)
- Métodos distintos de `GET`/`OPTIONS` → `405`
- Los errores son JSON: `{ "error": "mensaje en español" }`
- Todas las respuestas llevan `Cache-Control: no-store`. Las consultas **no** se registran en la bitácora
  (una pantalla consulta seguido); el "Último uso" del token sí se actualiza.

## CORS

`API_CORS_ORIGINS`: orígenes permitidos separados por coma (`https://casa.example,https://otra.example`)
o `*` (default). `*` es seguro aquí porque la API no usa cookies: sin el token no se lee nada.
El preflight (`OPTIONS`) responde `204` y permite el header `Authorization`.

## Endpoints

### `GET /api/v1/listas`

Todas las listas (máx. 100): primero las abiertas y luego las completadas, de la más reciente a la más vieja.
Filtro opcional: `?estado=abierta` o `?estado=completada` (también `abiertas`, `cerrada(s)`, `completadas`).

```json
{
  "lists": [
    {
      "id": 7,
      "name": "Súper semana 45",
      "status": "abierta",
      "open": true,
      "menu": { "id": 3, "name": "Semana 45" },
      "total": 24,
      "checked": 10,
      "pending": 14,
      "generatedAt": "2026-11-02T18:00:00.000Z",
      "updatedAt": "2026-11-06T15:21:00.000Z"
    }
  ]
}
```

`status` es `"abierta"` o `"completada"`; `open` es el mismo dato como booleano.

### `GET /api/v1/listas/actual`

La lista **abierta** más reciente (`404` si no hay ninguna). Misma respuesta que `/listas/:id`.

### `GET /api/v1/listas/:id`

```json
{
  "id": 7,
  "name": "Súper semana 45",
  "status": "abierta",
  "open": true,
  "menu": { "id": 3, "name": "Semana 45" },
  "total": 24, "checked": 10, "pending": 14,
  "generatedAt": "…", "updatedAt": "…",
  "items": [
    {
      "id": 101,
      "label": "Leche",
      "amount": "2 l",
      "quantity": 2,
      "unit": "l",
      "checked": true,
      "store": "Súper",
      "aisle": "Lácteos",
      "notes": null,
      "source": "generated",
      "recipes": [{ "recipe": "Hot cakes", "amount": "1 l" }]
    }
  ],
  "sections": [
    { "store": "Súper", "aisles": [{ "aisle": "Lácteos", "items": [ /* mismos objetos que items */ ] }] }
  ]
}
```

- `items`: lista plana, ya ordenada por tienda → pasillo → nombre.
- `sections`: lo mismo agrupado por tienda y pasillo (como en la app). `store`/`aisle` pueden ser `null`.
- `amount`: cantidad lista para mostrar (`"½ taza"`, `"3 pz"`); `null` si no tiene cantidad.
- `checked`: `true` = ya se compró.

## Ejemplo (dashboard web)

```js
const API = 'https://menu.rafaymon.com/api/v1'
const TOKEN = 'fm_…' // token "Solo leer listas"

async function cargarLista() {
  const res = await fetch(`${API}/listas/actual`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (res.status === 404) return null // no hay listas abiertas
  if (!res.ok) throw new Error((await res.json()).error)
  return res.json()
}

// Refrescar cada minuto (muy por debajo del límite de 120/min)
setInterval(cargarLista, 60_000)
```
