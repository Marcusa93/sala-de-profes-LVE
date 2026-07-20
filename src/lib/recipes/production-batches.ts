// ---------------------------------------------------------------------------
// Recetario de producción — La Vieja Escuela
// ---------------------------------------------------------------------------
// Fuente: recetario físico de cocina. Estas son recetas de producción (mise en place),
// no platos finales. Se usan en el wizard de producción para pre-llenar insumos
// de forma proporcional al lote que se va a hacer.
//
// baseQty + baseUnit definen el lote de referencia.
// Todos los insumos secondarios se escalan: real_qty = base_qty × (entered / baseQty)
// ---------------------------------------------------------------------------

export type BatchIngredient = {
  /** Nombre de pantalla — usado también para fuzzy-match con stock_items */
  name: string
  /** Cantidad para el lote base */
  qty: number
  /** Unidad: 'g', 'ml', 'u', 'kg', 'lt' */
  unit: string
  /** Nota opcional (ej. "brunoise", "en juliana") */
  note?: string
}

export type ProductionBatch = {
  slug: string
  /** Nombre visible en el selector */
  displayName: string
  /** Nombre del insumo principal que define la escala */
  mainIngredientName: string
  /** Cantidad de insumo principal para este lote base */
  baseQty: number
  baseUnit: string
  /** Ingredientes secundarios — todos escalan proporcionalmente */
  secondary: BatchIngredient[]
  /** Qué sale de esta producción (el elaborado). Se autocarga como salida. */
  output?: {
    /** Nombre del elaborado — se fuzzy-matchea con stock_items */
    name: string
    unit: string
    /** Cuántas unidades salen del lote base (baseQty) */
    yieldPerBase: number
  }
  /** Info de rendimiento para mostrar al usuario */
  yieldNote?: string
}

export const PRODUCTION_BATCHES: ProductionBatch[] = [
  {
    slug: 'milanesa-nalga',
    displayName: 'Milanesa de Nalga',
    mainIngredientName: 'Nalga',
    baseQty: 2,
    baseUnit: 'kg',
    secondary: [
      { name: 'Ajo picado',      qty: 30,  unit: 'g' },
      { name: 'Perejil picado',  qty: 90,  unit: 'g' },
      { name: 'Huevo',           qty: 600, unit: 'g',  note: '12 huevos' },
      { name: 'Leche',           qty: 180, unit: 'ml' },
      { name: 'Mostaza',         qty: 20,  unit: 'g' },
      { name: 'Sal',             qty: 40,  unit: 'g' },
      { name: 'Pimienta blanca', qty: 20,  unit: 'g' },
      { name: 'Orégano',         qty: 15,  unit: 'g' },
    ],
    output: { name: 'Milanesa cruda', unit: 'unidad', yieldPerBase: 13 },
    yieldNote: 'Filet 150g crudo. Cada 2kg de nalga ≈ 13 milanesas',
  },

  {
    slug: 'albondiga',
    displayName: 'Albóndigas',
    mainIngredientName: 'Carne molida',
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Cebolla',          qty: 90,  unit: 'g',  note: 'sofrita en brunoise' },
      { name: 'Ajo',              qty: 10,  unit: 'g',  note: '2 dientes' },
      { name: 'Perejil picado',   qty: 20,  unit: 'g' },
      { name: 'Sal',              qty: 18,  unit: 'g' },
      { name: 'Pimienta',         qty: 10,  unit: 'g' },
      { name: 'Orégano',          qty: 5,   unit: 'g' },
      { name: 'Pimentón',         qty: 10,  unit: 'g' },
      { name: 'Salsa inglesa',    qty: 7,   unit: 'g' },
      { name: 'Salsa soja',       qty: 7,   unit: 'g' },
      { name: 'Pan rallado',      qty: 100, unit: 'g' },
      { name: 'Huevo',            qty: 100, unit: 'g',  note: '2 huevos' },
    ],
    yieldNote: '70g en crudo → 60-65g cocido. Por 1kg salen 19 albóndigas / 6 porciones x3u',
  },

  {
    slug: 'salsa-portuguesa',
    displayName: 'Salsa Portuguesa',
    mainIngredientName: 'Tomate triturado',
    baseQty: 3,
    baseUnit: 'lt',
    secondary: [
      { name: 'Cebolla',    qty: 500, unit: 'g',  note: 'juliana fina' },
      { name: 'Zanahoria',  qty: 250, unit: 'g',  note: 'en rodajas' },
      { name: 'Morrón',     qty: 500, unit: 'g',  note: 'juliana' },
      { name: 'Ajo',        qty: 15,  unit: 'g',  note: 'en lonjas' },
      { name: 'Vino tinto', qty: 200, unit: 'ml' },
      { name: 'Sal',        qty: 20,  unit: 'g' },
      { name: 'Pimienta',   qty: 12,  unit: 'g' },
      { name: 'Romero',     qty: 3,   unit: 'g' },
      { name: 'Orégano',    qty: 3,   unit: 'g' },
      { name: 'Pimentón',   qty: 8,   unit: 'g' },
    ],
    yieldNote: 'Porcionar en bolsitas de 170g. Por 3lt de tomate ≈ 18 porciones',
  },

  {
    slug: 'cajón-pollo',
    displayName: 'Porcionado de Cajón de Pollo',
    mainIngredientName: 'Pollo',
    baseQty: 15,
    baseUnit: 'kg',
    secondary: [],
    yieldNote: 'Filetear y porcionar en bolsitas de 200g. 15kg → 68 porciones',
  },

  {
    slug: 'bastones-dambo',
    displayName: 'Bastones de Dambo / Mozzarella',
    mainIngredientName: 'Queso dambo',
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Huevo',          qty: 400, unit: 'g',  note: '8 huevos — para menjunje' },
      { name: 'Sal',            qty: 15,  unit: 'g' },
      { name: 'Pimienta',       qty: 10,  unit: 'g' },
      { name: 'Romero',         qty: 1,   unit: 'g',  note: '1 pizca' },
      { name: 'Ají molido',     qty: 6,   unit: 'g' },
      { name: 'Salsa inglesa',  qty: 4,   unit: 'ml' },
      { name: 'Provenzal',      qty: 5,   unit: 'g' },
      { name: 'Orégano',        qty: 5,   unit: 'g' },
      { name: 'Pan rallado',    qty: 1000, unit: 'g' },
      { name: 'Pimentón',       qty: 40,  unit: 'g',  note: 'se mezcla en el pan rallado' },
      { name: 'Cereal triturado', qty: 150, unit: 'g', note: 'se mezcla en el pan rallado' },
    ],
    yieldNote: 'Bastones de 40g (4 bastones = 1 porción). Sin rebozar: 6 porciones / 1kg. Rebozado: bastón de 70g, porción 280g',
  },

  {
    slug: 'pre-pizza-porteña',
    displayName: 'Pre Pizza Porteña',
    mainIngredientName: 'Harina 000',
    baseQty: 1150,
    baseUnit: 'g',
    secondary: [
      { name: 'Levadura',        qty: 34, unit: 'g' },
      { name: 'Aceite girasol',  qty: 35, unit: 'ml' },
      { name: 'Aceite de oliva', qty: 15, unit: 'ml' },
      { name: 'Manteca',         qty: 20, unit: 'g' },
      { name: 'Sal',             qty: 22, unit: 'g' },
      { name: 'Agua',            qty: 688, unit: 'ml' },
    ],
    yieldNote: '3 pre pizzas de 650g. Armado: 400g mozzarella + 150g salsa para las 3',
  },

  {
    slug: 'arroz-leche',
    displayName: 'Arroz con Leche',
    mainIngredientName: 'Leche',
    baseQty: 1300,
    baseUnit: 'ml',
    secondary: [
      { name: 'Arroz doble carolina', qty: 180, unit: 'g' },
      { name: 'Azúcar',              qty: 170, unit: 'g' },
      { name: 'Canela',              qty: 3,   unit: 'g' },
    ],
    yieldNote: 'Rinde 1,1kg cocido. Porción 150g → 7 porciones',
  },

  {
    slug: 'masa-wraps',
    displayName: 'Masa de Wraps',
    mainIngredientName: 'Harina 0000',
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Aceite girasol', qty: 100, unit: 'ml' },
      { name: 'Agua',           qty: 550, unit: 'ml' },
      { name: 'Sal',            qty: 20,  unit: 'g' },
    ],
    yieldNote: 'Masa base para wraps. Wrap individual: 125g',
  },

  {
    slug: 'bondiola',
    displayName: 'Bondiola Braseada',
    mainIngredientName: 'Bondiola',
    baseQty: 5,
    baseUnit: 'kg',
    secondary: [
      { name: 'Cebolla',           qty: 1200, unit: 'g', note: 'juliana' },
      { name: 'Morrón',            qty: 1000, unit: 'g' },
      { name: 'Zanahoria',         qty: 500,  unit: 'g', note: 'rallada' },
      { name: 'Ketchup',           qty: 1000, unit: 'g' },
      { name: 'Cerveza negra',     qty: 1100, unit: 'ml', note: '3 latas' },
      { name: 'Caldo de vegetales', qty: 1500, unit: 'ml' },
      { name: 'Sal',               qty: 20,   unit: 'g' },
    ],
    yieldNote: 'Se deshebra. Wrap: 180g de bondiola',
  },

  {
    slug: 'hamburguesa',
    displayName: 'Hamburguesas',
    mainIngredientName: 'Carne molida',
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Sal',      qty: 20, unit: 'g' },
      { name: 'Pimienta', qty: 12, unit: 'g' },
      { name: 'Orégano',  qty: 5,  unit: 'g' },
    ],
    yieldNote: 'Bollos de 100g. Por 1kg salen 10 medallones',
  },
]

/**
 * Fuzzy-match un nombre de ingrediente contra la lista de nombres de stock.
 * Retorna el stock item si hay coincidencia suficientemente buena.
 */
export function matchIngredientToStock<T extends { name: string }>(
  ingredientName: string,
  stockItems: T[],
): T | null {
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()

  const needle = normalize(ingredientName)

  // Exact match first
  const exact = stockItems.find(item => normalize(item.name) === needle)
  if (exact) return exact

  // Contained match (ingredient name inside stock name or vice versa)
  const contained = stockItems.find(item => {
    const hay = normalize(item.name)
    return hay.includes(needle) || needle.includes(hay)
  })
  return contained ?? null
}
