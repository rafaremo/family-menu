/**
 * Datos iniciales de catálogos. Se insertan solo si la tabla correspondiente está vacía,
 * así el seed nunca revive algo que la familia borró o renombró.
 */

export const SEED_AISLES = [
  'Frutas y verduras',
  'Carnes y pescados',
  'Salchichonería',
  'Lácteos y huevo',
  'Panadería y tortillas',
  'Abarrotes',
  'Especias y condimentos',
  'Enlatados',
  'Congelados',
  'Bebidas',
  'Limpieza',
  'Otros',
] as const

export const SEED_STORES = ['Costco', 'City Market', 'Amazon', 'Tiendita', 'Otros'] as const

type Dimension = 'mass' | 'volume' | 'count' | 'other'

/** [code, nombre, plural, dimensión, equivalencia a g / ml / pz] */
export const SEED_UNITS: [string, string, string, Dimension, number | null][] = [
  ['g', 'gramo', 'gramos', 'mass', 1],
  ['kg', 'kilo', 'kilos', 'mass', 1000],
  ['lb', 'libra', 'libras', 'mass', 453.592],
  ['oz', 'onza', 'onzas', 'mass', 28.3495],
  ['ml', 'mililitro', 'mililitros', 'volume', 1],
  ['l', 'litro', 'litros', 'volume', 1000],
  ['taza', 'taza', 'tazas', 'volume', 240],
  ['cda', 'cucharada', 'cucharadas', 'volume', 15],
  ['cdta', 'cucharadita', 'cucharaditas', 'volume', 5],
  ['pz', 'pieza', 'piezas', 'count', 1],
  ['docena', 'docena', 'docenas', 'count', 12],
  ['diente', 'diente', 'dientes', 'other', null],
  ['manojo', 'manojo', 'manojos', 'other', null],
  ['rama', 'rama', 'ramas', 'other', null],
  ['hoja', 'hoja', 'hojas', 'other', null],
  ['rebanada', 'rebanada', 'rebanadas', 'other', null],
  ['lata', 'lata', 'latas', 'other', null],
  ['paquete', 'paquete', 'paquetes', 'other', null],
  ['sobre', 'sobre', 'sobres', 'other', null],
  ['frasco', 'frasco', 'frascos', 'other', null],
  ['pizca', 'pizca', 'pizcas', 'other', null],
]

type TagKind = 'category' | 'diet' | 'occasion' | 'free'

export const SEED_TAGS: [string, TagKind][] = [
  ['Desayunos', 'category'],
  ['Platos fuertes', 'category'],
  ['Sopas y caldos', 'category'],
  ['Ensaladas', 'category'],
  ['Guarniciones', 'category'],
  ['Salsas', 'category'],
  ['Postres', 'category'],
  ['Bebidas', 'category'],
  ['Botanas', 'category'],
  ['Panes', 'category'],
  ['Vegetariana', 'diet'],
  ['Vegana', 'diet'],
  ['Sin gluten', 'diet'],
  ['Saludable', 'diet'],
  ['Entre semana', 'occasion'],
  ['Fin de semana', 'occasion'],
  ['Cumpleaños', 'occasion'],
  ['Navidad', 'occasion'],
]

export interface SeedIngredient {
  name: string
  aisle: (typeof SEED_AISLES)[number]
  unit: string
  aliases?: string[]
  /** g por ml (para convertir tazas/cucharadas a gramos). */
  density?: number
  /** g por pieza (para convertir piezas a gramos). */
  gpp?: number
}

export const SEED_INGREDIENTS: SeedIngredient[] = [
  // Frutas y verduras
  { name: 'Jitomate', aisle: 'Frutas y verduras', unit: 'g', aliases: ['tomate', 'tomate rojo', 'jitomate saladet'], gpp: 120 },
  { name: 'Tomate verde', aisle: 'Frutas y verduras', unit: 'g', aliases: ['tomatillo', 'tomate de cáscara'], gpp: 40 },
  { name: 'Cebolla blanca', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['cebolla'], gpp: 220 },
  { name: 'Cebolla morada', aisle: 'Frutas y verduras', unit: 'pz', gpp: 200 },
  { name: 'Ajo', aisle: 'Frutas y verduras', unit: 'diente', aliases: ['dientes de ajo', 'ajos'] },
  { name: 'Chile serrano', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['chiles serranos', 'serrano'], gpp: 6 },
  { name: 'Chile jalapeño', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['jalapeño', 'chiles jalapeños'], gpp: 40 },
  { name: 'Chile poblano', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['poblano', 'chiles poblanos'], gpp: 120 },
  { name: 'Aguacate', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['aguacates'], gpp: 200 },
  { name: 'Limón', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['limones', 'limón verde'], gpp: 40 },
  { name: 'Cilantro', aisle: 'Frutas y verduras', unit: 'manojo' },
  { name: 'Perejil', aisle: 'Frutas y verduras', unit: 'manojo' },
  { name: 'Epazote', aisle: 'Frutas y verduras', unit: 'rama' },
  { name: 'Papa', aisle: 'Frutas y verduras', unit: 'g', aliases: ['papas'], gpp: 170 },
  { name: 'Zanahoria', aisle: 'Frutas y verduras', unit: 'g', aliases: ['zanahorias'], gpp: 70 },
  { name: 'Calabacita', aisle: 'Frutas y verduras', unit: 'g', aliases: ['calabacitas', 'calabaza italiana'], gpp: 200 },
  { name: 'Chayote', aisle: 'Frutas y verduras', unit: 'pz', gpp: 300 },
  { name: 'Elote', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['mazorca'], gpp: 250 },
  { name: 'Lechuga', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['lechuga romana'] },
  { name: 'Espinaca', aisle: 'Frutas y verduras', unit: 'g', aliases: ['espinacas'] },
  { name: 'Brócoli', aisle: 'Frutas y verduras', unit: 'g', gpp: 300 },
  { name: 'Champiñones', aisle: 'Frutas y verduras', unit: 'g', aliases: ['champiñón', 'hongos'] },
  { name: 'Plátano', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['plátanos', 'banana'], gpp: 120 },
  { name: 'Plátano macho', aisle: 'Frutas y verduras', unit: 'pz', gpp: 300 },
  { name: 'Manzana', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['manzanas'], gpp: 180 },
  { name: 'Naranja', aisle: 'Frutas y verduras', unit: 'pz', aliases: ['naranjas'], gpp: 200 },
  { name: 'Fresa', aisle: 'Frutas y verduras', unit: 'g', aliases: ['fresas'] },

  // Carnes y pescados
  { name: 'Pechuga de pollo', aisle: 'Carnes y pescados', unit: 'g', aliases: ['pechuga', 'pechugas de pollo'] },
  { name: 'Muslo de pollo', aisle: 'Carnes y pescados', unit: 'g', aliases: ['muslos de pollo', 'pierna y muslo'] },
  { name: 'Carne molida de res', aisle: 'Carnes y pescados', unit: 'g', aliases: ['carne molida', 'molida de res'] },
  { name: 'Bistec de res', aisle: 'Carnes y pescados', unit: 'g', aliases: ['bistec', 'bisteces'] },
  { name: 'Lomo de cerdo', aisle: 'Carnes y pescados', unit: 'g', aliases: ['lomo de puerco'] },
  { name: 'Chorizo', aisle: 'Carnes y pescados', unit: 'g' },
  { name: 'Filete de pescado', aisle: 'Carnes y pescados', unit: 'g', aliases: ['pescado', 'filete de tilapia'] },
  { name: 'Camarón', aisle: 'Carnes y pescados', unit: 'g', aliases: ['camarones'] },

  // Salchichonería
  { name: 'Jamón', aisle: 'Salchichonería', unit: 'g', aliases: ['jamón de pavo'] },
  { name: 'Tocino', aisle: 'Salchichonería', unit: 'g' },
  { name: 'Salchicha', aisle: 'Salchichonería', unit: 'pz', aliases: ['salchichas'], gpp: 40 },
  { name: 'Queso manchego', aisle: 'Salchichonería', unit: 'g' },
  { name: 'Queso Oaxaca', aisle: 'Salchichonería', unit: 'g', aliases: ['quesillo'] },

  // Lácteos y huevo
  { name: 'Huevo', aisle: 'Lácteos y huevo', unit: 'pz', aliases: ['huevos', 'blanquillo'], gpp: 50 },
  { name: 'Leche', aisle: 'Lácteos y huevo', unit: 'ml', aliases: ['leche entera'], density: 1.03 },
  { name: 'Crema', aisle: 'Lácteos y huevo', unit: 'ml', aliases: ['crema ácida', 'crema de vaca'], density: 1.0 },
  { name: 'Mantequilla', aisle: 'Lácteos y huevo', unit: 'g', density: 0.91 },
  { name: 'Queso fresco', aisle: 'Lácteos y huevo', unit: 'g' },
  { name: 'Queso panela', aisle: 'Lácteos y huevo', unit: 'g', aliases: ['panela'] },
  { name: 'Yogur natural', aisle: 'Lácteos y huevo', unit: 'g', aliases: ['yogurt', 'yogur'], density: 1.03 },

  // Panadería y tortillas
  { name: 'Tortilla de maíz', aisle: 'Panadería y tortillas', unit: 'pz', aliases: ['tortillas', 'tortillas de maíz'], gpp: 30 },
  { name: 'Tortilla de harina', aisle: 'Panadería y tortillas', unit: 'pz', aliases: ['tortillas de harina'], gpp: 40 },
  { name: 'Bolillo', aisle: 'Panadería y tortillas', unit: 'pz', aliases: ['bolillos', 'pan bolillo'], gpp: 70 },
  { name: 'Pan de caja', aisle: 'Panadería y tortillas', unit: 'rebanada', aliases: ['pan blanco', 'pan de molde'] },
  { name: 'Tostadas', aisle: 'Panadería y tortillas', unit: 'pz', aliases: ['tostada'], gpp: 15 },

  // Abarrotes
  { name: 'Arroz', aisle: 'Abarrotes', unit: 'g', aliases: ['arroz blanco'], density: 0.85 },
  { name: 'Frijol negro', aisle: 'Abarrotes', unit: 'g', aliases: ['frijoles', 'frijoles negros'], density: 0.8 },
  { name: 'Lenteja', aisle: 'Abarrotes', unit: 'g', aliases: ['lentejas'], density: 0.85 },
  { name: 'Pasta', aisle: 'Abarrotes', unit: 'g', aliases: ['espagueti', 'spaghetti', 'sopa de pasta', 'fideo'] },
  { name: 'Harina de trigo', aisle: 'Abarrotes', unit: 'g', aliases: ['harina'], density: 0.53 },
  { name: 'Masa de maíz', aisle: 'Abarrotes', unit: 'g', aliases: ['masa', 'maseca'] },
  { name: 'Azúcar', aisle: 'Abarrotes', unit: 'g', aliases: ['azúcar blanca'], density: 0.85 },
  { name: 'Avena', aisle: 'Abarrotes', unit: 'g', aliases: ['hojuelas de avena'], density: 0.38 },
  { name: 'Aceite vegetal', aisle: 'Abarrotes', unit: 'ml', aliases: ['aceite'], density: 0.92 },
  { name: 'Aceite de oliva', aisle: 'Abarrotes', unit: 'ml', density: 0.91 },
  { name: 'Vinagre', aisle: 'Abarrotes', unit: 'ml', aliases: ['vinagre blanco'], density: 1.01 },
  { name: 'Caldo de pollo', aisle: 'Abarrotes', unit: 'ml', aliases: ['consomé de pollo', 'caldo'] },
  { name: 'Mayonesa', aisle: 'Abarrotes', unit: 'g', density: 0.91 },
  { name: 'Chocolate de mesa', aisle: 'Abarrotes', unit: 'pz', aliases: ['tableta de chocolate'] },

  // Especias y condimentos
  { name: 'Sal', aisle: 'Especias y condimentos', unit: 'g', aliases: ['sal de mesa'], density: 1.2 },
  { name: 'Pimienta negra', aisle: 'Especias y condimentos', unit: 'g', aliases: ['pimienta'], density: 0.5 },
  { name: 'Comino', aisle: 'Especias y condimentos', unit: 'g', density: 0.45 },
  { name: 'Orégano', aisle: 'Especias y condimentos', unit: 'g', aliases: ['orégano seco'], density: 0.2 },
  { name: 'Canela', aisle: 'Especias y condimentos', unit: 'rama', aliases: ['raja de canela', 'canela en rama'] },
  { name: 'Hoja de laurel', aisle: 'Especias y condimentos', unit: 'hoja', aliases: ['laurel', 'hojas de laurel'] },
  { name: 'Consomé en polvo', aisle: 'Especias y condimentos', unit: 'g', aliases: ['consomé', 'caldo en polvo'] },
  { name: 'Chile guajillo', aisle: 'Especias y condimentos', unit: 'pz', aliases: ['guajillo', 'chiles guajillo'], gpp: 6 },
  { name: 'Chile ancho', aisle: 'Especias y condimentos', unit: 'pz', aliases: ['chiles anchos'], gpp: 12 },
  { name: 'Vainilla', aisle: 'Especias y condimentos', unit: 'ml', aliases: ['extracto de vainilla'] },

  // Enlatados
  { name: 'Chiles chipotles adobados', aisle: 'Enlatados', unit: 'lata', aliases: ['chipotle', 'chile chipotle', 'chipotles'] },
  { name: 'Atún en lata', aisle: 'Enlatados', unit: 'lata', aliases: ['atún'] },
  { name: 'Puré de tomate', aisle: 'Enlatados', unit: 'g', aliases: ['puré', 'salsa de tomate'] },
  { name: 'Granos de elote', aisle: 'Enlatados', unit: 'lata', aliases: ['elote en lata', 'granos de maíz'] },
  { name: 'Leche condensada', aisle: 'Enlatados', unit: 'lata' },
  { name: 'Leche evaporada', aisle: 'Enlatados', unit: 'lata' },

  // Congelados
  { name: 'Verduras mixtas congeladas', aisle: 'Congelados', unit: 'g', aliases: ['mix de verduras', 'verduras congeladas'] },

  // Bebidas
  { name: 'Agua mineral', aisle: 'Bebidas', unit: 'ml' },
]
