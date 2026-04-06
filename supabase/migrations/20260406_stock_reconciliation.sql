-- ============================================================================
-- MIGRACIÓN: Sistema de reconciliación de stock
-- Fecha: 2026-04-06
-- Depende de: stock_items, stock_movements, menu_items, fudo_sales,
--             production_outputs, production_orders,
--             mise_en_place_items, mise_en_place_records, recipes
-- ============================================================================

-- ============================================================================
-- 0) Índice para acelerar consultas por item + rango de fecha
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date
ON stock_movements (stock_item_id, created_at);

-- ============================================================================
-- 1) RPC: stock_reconciliation
-- ============================================================================
-- Para cada stock_item activo, calcula el balance de un periodo:
--   opening_qty (stock al inicio del periodo)
--   + received  (entradas por compras/recepción)
--   + prod_in   (entradas por producción)
--   - prod_out  (salidas por consumo en producción)
--   - sales     (salidas por ventas)
--   - waste     (salidas por merma/vencimiento)
--   ± manual    (ajustes manuales)
--   = expected_closing
--   vs actual_closing (current_qty real)
--   → variance (diferencia; debería ser 0 si no hay ediciones directas)
-- ============================================================================

CREATE OR REPLACE FUNCTION stock_reconciliation(
  p_from timestamptz DEFAULT (CURRENT_DATE)::timestamptz,
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE (
  stock_item_id    bigint,
  name             text,
  unit             text,
  opening_qty      numeric,
  received         numeric,
  prod_in          numeric,
  prod_out         numeric,
  sales            numeric,
  waste            numeric,
  manual_adj       numeric,
  expected_closing numeric,
  actual_closing   numeric,
  variance         numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH period_movements AS (
    SELECT
      sm.stock_item_id,
      -- Total de todos los movimientos en el periodo
      SUM(sm.change)
        AS total_change,
      -- Desglose por categoría
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason = 'received'), 0)
        AS received,
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason = 'produccion_output' AND sm.change > 0), 0)
        AS prod_in,
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason IN ('production', 'produccion_input')), 0)
        AS prod_out,
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason = 'sale'), 0)
        AS sales,
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason IN ('waste', 'expired')), 0)
        AS waste,
      COALESCE(SUM(sm.change) FILTER (WHERE sm.reason = 'manual_adjustment'), 0)
        AS manual_adj
    FROM stock_movements sm
    WHERE sm.created_at >= p_from
      AND sm.created_at <= p_to
    GROUP BY sm.stock_item_id
  )
  SELECT
    si.id                                          AS stock_item_id,
    si.name,
    si.unit,
    -- opening = current_qty menos todos los movimientos del periodo
    si.current_qty - COALESCE(pm.total_change, 0)  AS opening_qty,
    COALESCE(pm.received, 0)                        AS received,
    COALESCE(pm.prod_in, 0)                         AS prod_in,
    COALESCE(pm.prod_out, 0)                        AS prod_out,
    COALESCE(pm.sales, 0)                           AS sales,
    COALESCE(pm.waste, 0)                           AS waste,
    COALESCE(pm.manual_adj, 0)                      AS manual_adj,
    -- expected = opening + all categorized movements
    (si.current_qty - COALESCE(pm.total_change, 0))
      + COALESCE(pm.received, 0)
      + COALESCE(pm.prod_in, 0)
      + COALESCE(pm.prod_out, 0)
      + COALESCE(pm.sales, 0)
      + COALESCE(pm.waste, 0)
      + COALESCE(pm.manual_adj, 0)                  AS expected_closing,
    si.current_qty                                   AS actual_closing,
    -- variance = actual - expected
    -- Si todos los reasons están cubiertos, esto debería ser 0
    si.current_qty - (
      (si.current_qty - COALESCE(pm.total_change, 0))
        + COALESCE(pm.received, 0)
        + COALESCE(pm.prod_in, 0)
        + COALESCE(pm.prod_out, 0)
        + COALESCE(pm.sales, 0)
        + COALESCE(pm.waste, 0)
        + COALESCE(pm.manual_adj, 0)
    )                                                AS variance
  FROM stock_items si
  LEFT JOIN period_movements pm ON pm.stock_item_id = si.id
  WHERE si.is_active = true
  ORDER BY
    -- Items con varianza primero, luego por movimiento total descendente
    ABS(
      si.current_qty - (
        (si.current_qty - COALESCE(pm.total_change, 0))
          + COALESCE(pm.received, 0)
          + COALESCE(pm.prod_in, 0)
          + COALESCE(pm.prod_out, 0)
          + COALESCE(pm.sales, 0)
          + COALESCE(pm.waste, 0)
          + COALESCE(pm.manual_adj, 0)
      )
    ) DESC,
    ABS(COALESCE(pm.total_change, 0)) DESC;
$$;

COMMENT ON FUNCTION stock_reconciliation IS
  'Reconciliación de stock por periodo: opening + entradas - salidas = expected vs actual.';

-- ============================================================================
-- 2) RPC: menu_item_reconciliation
-- ============================================================================
-- Para cada menu_item con receta, calcula:
--   qty_produced: de production_outputs (orders completadas) +
--                 mise_en_place_records (turnos de cocina)
--   qty_sold:     de fudo_sales
--   expected_remaining = produced - sold
-- ============================================================================

CREATE OR REPLACE FUNCTION menu_item_reconciliation(
  p_from timestamptz DEFAULT (CURRENT_DATE)::timestamptz,
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE (
  menu_item_id       bigint,
  menu_item_name     text,
  recipe_id          uuid,
  recipe_name        text,
  qty_produced       numeric,
  qty_sold           numeric,
  expected_remaining numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
  -- Producción desde production_outputs (ordenes completadas)
  prod_outputs AS (
    SELECT
      mi.id AS menu_item_id,
      COALESCE(SUM(po.qty_produced), 0) AS qty
    FROM menu_items mi
    JOIN recipes r ON r.id = mi.recipe_id
    -- production_outputs está vinculado a stock_items via recipe
    -- Pero para items de carta, buscamos por recipe match en la orden
    JOIN production_orders pord ON pord.status = 'completed'
      AND pord.completed_at >= p_from
      AND pord.completed_at <= p_to
    JOIN production_outputs po ON po.production_order_id = pord.id
      AND po.is_waste = false
    -- Match: el stock_item del output aparece como ingrediente de la receta
    -- O el nombre del output matchea el nombre del menu_item
    WHERE mi.recipe_id IS NOT NULL
      AND mi.is_active = true
      AND (
        po.output_name ILIKE mi.name
        OR po.stock_item_id IN (
          SELECT ri.stock_item_id FROM recipe_ingredients ri WHERE ri.recipe_id = mi.recipe_id
        )
      )
    GROUP BY mi.id
  ),
  -- Producción desde mise_en_place_records (turnos de cocina)
  mise_prod AS (
    SELECT
      mi.id AS menu_item_id,
      COALESCE(SUM(mpr.quantity_produced), 0) AS qty
    FROM menu_items mi
    JOIN mise_en_place_items mpi ON mpi.recipe_id = mi.recipe_id
      AND mpi.is_active = true
    JOIN mise_en_place_records mpr ON mpr.mise_en_place_item_id = mpi.id
      AND mpr.status = 'done'
    JOIN kitchen_shifts ks ON ks.id = mpr.kitchen_shift_id
      AND ks.date >= p_from::date
      AND ks.date <= p_to::date
    WHERE mi.recipe_id IS NOT NULL
      AND mi.is_active = true
    GROUP BY mi.id
  ),
  -- Ventas desde fudo_sales
  fudo_sold AS (
    SELECT
      mi.id AS menu_item_id,
      COALESCE(SUM(fs.quantity), 0) AS qty
    FROM menu_items mi
    JOIN fudo_sales fs ON fs.fudo_product_id = mi.fudo_product_id
      AND fs.sold_at >= p_from
      AND fs.sold_at <= p_to
    WHERE mi.fudo_product_id IS NOT NULL
      AND mi.is_active = true
    GROUP BY mi.id
  )
  SELECT
    mi.id                                                        AS menu_item_id,
    mi.name                                                      AS menu_item_name,
    mi.recipe_id,
    r.name                                                       AS recipe_name,
    COALESCE(po.qty, 0) + COALESCE(mp.qty, 0)                   AS qty_produced,
    COALESCE(fs.qty, 0)                                          AS qty_sold,
    (COALESCE(po.qty, 0) + COALESCE(mp.qty, 0)) - COALESCE(fs.qty, 0) AS expected_remaining
  FROM menu_items mi
  LEFT JOIN recipes r ON r.id = mi.recipe_id
  LEFT JOIN prod_outputs po ON po.menu_item_id = mi.id
  LEFT JOIN mise_prod mp ON mp.menu_item_id = mi.id
  LEFT JOIN fudo_sold fs ON fs.menu_item_id = mi.id
  WHERE mi.is_active = true
    AND mi.recipe_id IS NOT NULL
    -- Solo incluir items con algún movimiento
    AND (COALESCE(po.qty, 0) + COALESCE(mp.qty, 0) + COALESCE(fs.qty, 0)) > 0
  ORDER BY
    -- Items con restante negativo primero (vendimos más de lo que produjimos)
    (COALESCE(po.qty, 0) + COALESCE(mp.qty, 0)) - COALESCE(fs.qty, 0) ASC;
$$;

COMMENT ON FUNCTION menu_item_reconciliation IS
  'Reconciliación por item de carta: producido vs vendido = restante esperado.';

-- ============================================================================
-- FIN
-- ============================================================================
