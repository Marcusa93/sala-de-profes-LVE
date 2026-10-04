-- ---------------------------------------------------------------------------
-- Descuento de stock con modificadores + costo real por venta
-- ---------------------------------------------------------------------------
-- Problema original: deduct_stock_on_sale solo miraba recipe_id (sistema
-- viejo). Ignora consumo_modo y no procesa los sub-ítems elegidos dentro de
-- cada venta (grupos modificadores de Fudo).
--
-- Resultado: si una Milanesa se vende con "Puré" como modificador, el puré
-- nunca se descontaba. Si el Clásico es 'combo', tampoco se descontaba nada.
--
-- Solución en dos partes:
--   1. deduct_stock_on_sale reescrita: respeta consumo_modo y además procesa
--      cada sub-ítem (fudo_sale_subitems) aplicando SU propio consumo_modo.
--      El orden de inserción del sync garantiza que los sub-ítems ya están en
--      la base cuando el trigger dispara (subitems → upsert, sales → insert).
--
--   2. fn_menu_item_unit_cost + fn_sale_real_cost: calculan el costo real de
--      una venta incluyendo los modificadores elegidos. Fudo no suma este
--      costo; la app lo computa desde recipe_ingredients × cost_per_unit.
-- ---------------------------------------------------------------------------


-- ============================================================================
-- 1. deduct_stock_on_sale — reescritura completa
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deduct_stock_on_sale(p_sale_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale          record;
  v_item          record;
  v_ing           record;
  v_sub           record;
  v_sub_item      record;
  v_qty           numeric;
  v_count         int := 0;

  -- Bloque reutilizable: descuenta los ingredientes de una receta
  -- (no puede ser una función anidada en PL/pgSQL; se duplica para
  -- ítem principal y sub-ítems)
BEGIN
  -- 1. Obtener la venta
  SELECT id, fudo_sale_item_id, fudo_product_id, quantity
  INTO v_sale
  FROM public.fudo_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Venta %s no encontrada', p_sale_id));
  END IF;

  -- 2. Buscar el menu_item correspondiente
  SELECT id, name, consumo_modo, recipe_id, consumo_stock_item_id, consumo_qty
  INTO v_item
  FROM public.menu_items
  WHERE fudo_product_id = v_sale.fudo_product_id
  ORDER BY is_active DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'message', 'Producto Fudo no mapeado', 'ingredients_affected', 0);
  END IF;

  -- 3. Descontar el ítem principal según su consumo_modo
  --    'combo' y 'sin_consumo' no descuentan nada propio (el combo vive
  --    en sus sub-ítems; sin_consumo es un ítem sin insumos).
  --    NULL / legacy: si tiene recipe_id directo, se trata como 'receta'.
  IF v_item.consumo_modo = 'receta'
     OR (v_item.consumo_modo IS NULL AND v_item.recipe_id IS NOT NULL) THEN

    FOR v_ing IN
      SELECT ri.stock_item_id, ri.qty_per_portion
      FROM public.recipe_ingredients ri
      WHERE ri.recipe_id = v_item.recipe_id
    LOOP
      v_qty := v_ing.qty_per_portion * v_sale.quantity;
      PERFORM public.register_stock_movement(
        p_stock_item_id  := v_ing.stock_item_id,
        p_change         := -v_qty,
        p_reason         := 'sale',
        p_reference_type := 'fudo_sale',
        p_reference_id   := p_sale_id::text
      );
      v_count := v_count + 1;
    END LOOP;

  ELSIF v_item.consumo_modo = 'insumo'
        AND v_item.consumo_stock_item_id IS NOT NULL
        AND v_item.consumo_qty > 0 THEN

    v_qty := v_item.consumo_qty * v_sale.quantity;
    PERFORM public.register_stock_movement(
      p_stock_item_id  := v_item.consumo_stock_item_id,
      p_change         := -v_qty,
      p_reason         := 'sale',
      p_reference_type := 'fudo_sale',
      p_reference_id   := p_sale_id::text
    );
    v_count := v_count + 1;

  END IF;

  -- 4. Procesar sub-ítems (grupos modificadores elegidos por el cliente).
  --    Aplica a 'receta', 'combo' e 'insumo' (no a 'sin_consumo').
  --    Requiere fudo_sale_item_id para joinear con fudo_sale_subitems.
  IF v_item.consumo_modo IN ('receta', 'combo', 'insumo')
     AND v_sale.fudo_sale_item_id IS NOT NULL THEN

    FOR v_sub IN
      SELECT ss.fudo_product_id, ss.quantity
      FROM public.fudo_sale_subitems ss
      WHERE ss.fudo_sale_item_id = v_sale.fudo_sale_item_id
    LOOP
      SELECT id, consumo_modo, recipe_id, consumo_stock_item_id, consumo_qty
      INTO v_sub_item
      FROM public.menu_items
      WHERE fudo_product_id = v_sub.fudo_product_id
      ORDER BY is_active DESC
      LIMIT 1;

      IF NOT FOUND
         OR v_sub_item.consumo_modo IS NULL
         OR v_sub_item.consumo_modo IN ('sin_consumo', 'combo') THEN
        CONTINUE;
      END IF;

      IF v_sub_item.consumo_modo = 'receta' AND v_sub_item.recipe_id IS NOT NULL THEN
        FOR v_ing IN
          SELECT ri.stock_item_id, ri.qty_per_portion
          FROM public.recipe_ingredients ri
          WHERE ri.recipe_id = v_sub_item.recipe_id
        LOOP
          v_qty := v_ing.qty_per_portion * v_sub.quantity;
          PERFORM public.register_stock_movement(
            p_stock_item_id  := v_ing.stock_item_id,
            p_change         := -v_qty,
            p_reason         := 'sale',
            p_reference_type := 'fudo_sale',
            p_reference_id   := p_sale_id::text
          );
          v_count := v_count + 1;
        END LOOP;

      ELSIF v_sub_item.consumo_modo = 'insumo'
            AND v_sub_item.consumo_stock_item_id IS NOT NULL
            AND v_sub_item.consumo_qty > 0 THEN
        v_qty := v_sub_item.consumo_qty * v_sub.quantity;
        PERFORM public.register_stock_movement(
          p_stock_item_id  := v_sub_item.consumo_stock_item_id,
          p_change         := -v_qty,
          p_reason         := 'sale',
          p_reference_type := 'fudo_sale',
          p_reference_id   := p_sale_id::text
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'menu_item', v_item.name,
    'consumo_modo', v_item.consumo_modo,
    'ingredients_affected', v_count
  );
END;
$$;

COMMENT ON FUNCTION public.deduct_stock_on_sale IS
  'Descuenta stock al registrar una venta de Fudo. '
  'Respeta consumo_modo (receta/combo/insumo/sin_consumo) y procesa '
  'los sub-ítems de grupos modificadores usando su propio consumo_modo.';


-- ============================================================================
-- 2. fn_menu_item_unit_cost — costo de 1 unidad de un producto Fudo
-- ============================================================================
-- Calcula el costo a partir de recipe_ingredients × stock_items.cost_per_unit.
-- No incluye sub-ítems (eso lo hace fn_sale_real_cost).
-- Devuelve 0 si el ítem es 'sin_consumo', 'combo', o no tiene costos cargados.

CREATE OR REPLACE FUNCTION public.fn_menu_item_unit_cost(p_fudo_product_id text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item record;
  v_cost numeric;
BEGIN
  SELECT consumo_modo, recipe_id, consumo_stock_item_id, consumo_qty
  INTO v_item
  FROM public.menu_items
  WHERE fudo_product_id = p_fudo_product_id
  ORDER BY is_active DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_item.consumo_modo = 'receta' AND v_item.recipe_id IS NOT NULL THEN
    SELECT COALESCE(SUM(ri.qty_per_portion * si.cost_per_unit), 0)
    INTO v_cost
    FROM public.recipe_ingredients ri
    JOIN public.stock_items si ON si.id = ri.stock_item_id
    WHERE ri.recipe_id = v_item.recipe_id
      AND si.cost_per_unit IS NOT NULL
      AND si.cost_per_unit > 0;
    RETURN COALESCE(v_cost, 0);

  ELSIF v_item.consumo_modo = 'insumo'
        AND v_item.consumo_stock_item_id IS NOT NULL
        AND v_item.consumo_qty > 0 THEN
    SELECT COALESCE(v_item.consumo_qty * si.cost_per_unit, 0)
    INTO v_cost
    FROM public.stock_items si
    WHERE si.id = v_item.consumo_stock_item_id
      AND si.cost_per_unit IS NOT NULL;
    RETURN COALESCE(v_cost, 0);

  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.fn_menu_item_unit_cost IS
  'Costo unitario de un producto Fudo calculado desde sus ingredientes. '
  'No incluye modificadores; para eso usar fn_sale_real_cost.';


-- ============================================================================
-- 3. fn_sale_real_cost — costo real de una venta, con modificadores
-- ============================================================================
-- Suma el costo del ítem principal + el costo de cada sub-ítem elegido.
-- Permite calcular el margen real de "Clásico con medialuna + latte" vs
-- "Clásico con tortilla + mate" — algo que Fudo no hace.

CREATE OR REPLACE FUNCTION public.fn_sale_real_cost(p_sale_id bigint)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_sale  record;
  v_cost  numeric := 0;
  v_sub   record;
BEGIN
  SELECT id, fudo_sale_item_id, fudo_product_id, quantity
  INTO v_sale
  FROM public.fudo_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Costo del ítem principal × cantidad
  v_cost := public.fn_menu_item_unit_cost(v_sale.fudo_product_id) * v_sale.quantity;

  -- Costo de cada modificador elegido
  IF v_sale.fudo_sale_item_id IS NOT NULL THEN
    FOR v_sub IN
      SELECT ss.fudo_product_id, ss.quantity
      FROM public.fudo_sale_subitems ss
      WHERE ss.fudo_sale_item_id = v_sale.fudo_sale_item_id
    LOOP
      v_cost := v_cost
        + public.fn_menu_item_unit_cost(v_sub.fudo_product_id) * v_sub.quantity;
    END LOOP;
  END IF;

  RETURN v_cost;
END;
$$;

COMMENT ON FUNCTION public.fn_sale_real_cost IS
  'Costo real de una venta incluyendo los grupos modificadores elegidos. '
  'Ejemplo: Clásico con medialuna + latte = costo receta Clásico + costo medialuna + costo latte. '
  'Fudo no computa este costo; esta función lo resuelve desde recipe_ingredients × cost_per_unit.';


-- Permisos
GRANT EXECUTE ON FUNCTION public.fn_menu_item_unit_cost(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_real_cost(bigint) TO authenticated;
