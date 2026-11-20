-- Confirmar una producción aunque falte stock de un insumo (20/11/2026)
-- ---------------------------------------------------------------------------
-- Hasta ahora complete_production_order frenaba si un insumo tenía menos stock
-- en la app que lo usado (ej. bondiola: figura 4 kg, se usaron 10,6 kg porque
-- no se cargó una compra). La producción quedaba trabada.
--
-- v8:
--   · Nuevo parámetro p_permitir_faltante (por defecto false = igual que antes).
--   · Sin permiso: devuelve TODOS los insumos que faltan en 'faltantes'
--     (no solo el primero) y code = 'stock_insuficiente'.
--   · Con permiso: confirma igual, el insumo queda en negativo y el
--     movimiento lo anota ("confirmada con faltante de stock (había X)").
--   · El chequeo suma los renglones repetidos del mismo insumo.
-- Se borra la versión de 2 parámetros para que no queden dos funciones con el
-- mismo nombre (las llamadas con 2 parámetros siguen andando por el default).
-- ---------------------------------------------------------------------------

BEGIN;

DROP FUNCTION IF EXISTS public.complete_production_order(bigint, uuid);

CREATE FUNCTION public.complete_production_order(p_order_id bigint, p_user_id uuid, p_permitir_faltante boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order            production_orders%ROWTYPE;
  v_input            RECORD;
  v_output           RECORD;
  v_prev_qty         numeric;
  v_new_qty          numeric;
  v_mov_id           uuid;
  v_lot_id           bigint;
  v_lot_code         text;
  v_produced_at      timestamptz;
  v_expires_at       timestamptz;
  v_shelf_life_days  int;
  v_unit_cost        numeric;
  v_total_cost       numeric := 0;
  v_mass_input       numeric := 0;   -- kg/l equivalentes de insumos convertibles
  v_mass_waste       numeric := 0;   -- kg/l equivalentes de merma convertible
  v_total_input      numeric := 0;
  v_total_output_net numeric := 0;
  v_total_waste      numeric := 0;
  v_efficiency       numeric := NULL;
  v_main_item        uuid := NULL;
  v_main_qty         numeric := 0;
  v_main_prev_qty    numeric := 0;
  v_cost_per_unit    numeric := NULL;
  v_prev_cost        numeric;
  v_movements        jsonb := '[]'::jsonb;
  v_input_count      int;
  v_output_count     int;
  v_inputs_confiables boolean := false;  -- v7: ¿todos los insumos con costo real?
  v_falta            RECORD;
  v_faltantes        jsonb := '[]'::jsonb; -- v8: insumos con menos stock que lo usado
  v_detalle_falta    text;
BEGIN
  SELECT * INTO v_order FROM production_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Orden no encontrada');
  END IF;
  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden ya fue completada');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden fue cancelada');
  END IF;

  SELECT COUNT(*) INTO v_input_count FROM production_inputs WHERE production_order_id = p_order_id;
  IF v_input_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene insumos registrados');
  END IF;

  SELECT COUNT(*) INTO v_output_count FROM production_outputs WHERE production_order_id = p_order_id;
  IF v_output_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene productos registrados');
  END IF;

  -- Stock suficiente antes de tocar nada (v8: suma los renglones del mismo
  -- insumo y junta TODOS los que faltan, no solo el primero).
  FOR v_falta IN
    SELECT si.id, si.name, si.unit, COALESCE(si.current_qty, 0) AS disponible, SUM(pi.qty_used) AS usado
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
    GROUP BY si.id, si.name, si.unit, si.current_qty
    HAVING COALESCE(si.current_qty, 0) < SUM(pi.qty_used)
    ORDER BY si.name
  LOOP
    v_faltantes := v_faltantes || jsonb_build_object(
      'stock_item_id', v_falta.id,
      'nombre',        v_falta.name,
      'unidad',        v_falta.unit,
      'disponible',    round(v_falta.disponible::numeric, 3),
      'usado',         round(v_falta.usado::numeric, 3),
      'falta',         round((v_falta.usado - v_falta.disponible)::numeric, 3)
    );
    v_detalle_falta := COALESCE(v_detalle_falta || '; ', '')
      || '"' || v_falta.name || '": disponible ' || round(v_falta.disponible::numeric, 3)
      || ', requerido ' || round(v_falta.usado::numeric, 3);
  END LOOP;

  -- Sin permiso explícito se frena como siempre (protege de errores de carga,
  -- ej. 105 kg de levadura). Con permiso (lo confirma otra persona que vio los
  -- números) se registra igual y el insumo queda en negativo hasta que se
  -- cargue la compra que falta.
  IF jsonb_array_length(v_faltantes) > 0 AND NOT COALESCE(p_permitir_faltante, false) THEN
    RETURN jsonb_build_object(
      'success',   false,
      'code',      'stock_insuficiente',
      'error',     'Stock insuficiente de ' || v_detalle_falta,
      'faltantes', v_faltantes
    );
  END IF;

  -- v7: la fuente del costo del elaborado depende de la de sus insumos.
  -- 'produccion' solo si TODOS tienen cost_source confiable y costo > 0.
  SELECT COALESCE(
    bool_and(
      COALESCE(si.cost_source, '') IN ('compra', 'manual', 'produccion')
      AND COALESCE(si.cost_per_unit, 0) > 0
    ),
    false
  )
  INTO v_inputs_confiables
  FROM production_inputs pi
  JOIN stock_items si ON si.id = pi.stock_item_id
  WHERE pi.production_order_id = p_order_id;

  -- ── Insumos: descontar, congelar costo, kardex ──
  FOR v_input IN
    SELECT pi.*, si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
    ORDER BY pi.id
  LOOP
    -- Se relee dentro del loop: si el mismo insumo aparece en dos renglones,
    -- el segundo tiene que partir de lo que dejó el primero (con el valor
    -- fotografiado por el cursor, el segundo pisaba al primero).
    SELECT current_qty INTO v_prev_qty
    FROM stock_items WHERE id = v_input.stock_item_id FOR UPDATE;
    v_new_qty := v_prev_qty - v_input.qty_used;
    v_unit_cost := COALESCE(v_input.cost_per_unit, v_input.item_cost, 0);

    UPDATE stock_items
    SET current_qty = v_new_qty, updated_at = now()
    WHERE id = v_input.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by,
       production_order_id, cost_per_unit, note)
    VALUES
      (v_input.stock_item_id, v_input.qty_used, 'uso', 'produccion_input', v_prev_qty, v_new_qty, p_user_id,
       p_order_id, NULLIF(v_unit_cost, 0), 'Producción #' || p_order_id || ': ' || v_order.name
         || CASE WHEN v_new_qty < 0 THEN ' · confirmada con faltante de stock (había ' || round(v_prev_qty::numeric, 3) || ')' ELSE '' END)
    RETURNING id INTO v_mov_id;

    UPDATE production_inputs
    SET movement_uuid = v_mov_id,
        cost_per_unit = COALESCE(cost_per_unit, NULLIF(v_unit_cost, 0))
    WHERE id = v_input.id;

    v_total_cost  := v_total_cost + (v_input.qty_used * v_unit_cost);
    v_total_input := v_total_input + v_input.qty_used;

    -- Eficiencia solo con unidades convertibles a masa/volumen
    IF lower(COALESCE(v_input.unit, v_input.item_unit, '')) IN ('kg', 'l', 'lt', 'litro') THEN
      v_mass_input := v_mass_input + v_input.qty_used;
    ELSIF lower(COALESCE(v_input.unit, v_input.item_unit, '')) IN ('g', 'ml') THEN
      v_mass_input := v_mass_input + (v_input.qty_used / 1000);
    END IF;

    v_movements := v_movements || jsonb_build_object(
      'type', 'input',
      'stock_item_id', v_input.stock_item_id,
      'change', -v_input.qty_used,
      'movement_id', v_mov_id
    );
  END LOOP;

  -- ── Salida principal (para el costo por unidad) ──
  SELECT po.stock_item_id, po.qty_produced
  INTO v_main_item, v_main_qty
  FROM production_outputs po
  WHERE po.production_order_id = p_order_id
    AND NOT po.is_waste
    AND po.stock_item_id IS NOT NULL
  ORDER BY po.qty_produced DESC
  LIMIT 1;

  IF v_main_item IS NOT NULL AND v_main_qty > 0 AND v_total_cost > 0 THEN
    v_cost_per_unit := round(v_total_cost / v_main_qty, 2);
  END IF;

  -- ── Salidas: sumar, lotes, kardex, costo del elaborado ──
  FOR v_output IN
    SELECT po.*, si.shelf_life_days AS item_shelf_life,
           si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_outputs po
    LEFT JOIN stock_items si ON si.id = po.stock_item_id
    WHERE po.production_order_id = p_order_id
    ORDER BY po.id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      IF lower(COALESCE(v_output.unit, v_output.item_unit, '')) IN ('kg', 'l', 'lt', 'litro') THEN
        v_mass_waste := v_mass_waste + v_output.qty_produced;
      ELSIF lower(COALESCE(v_output.unit, v_output.item_unit, '')) IN ('g', 'ml') THEN
        v_mass_waste := v_mass_waste + (v_output.qty_produced / 1000);
      END IF;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
      v_total_output_net := v_total_output_net + v_output.qty_produced;
      CONTINUE;
    END IF;

    -- Igual que con los insumos: releer para soportar el mismo elaborado en
    -- más de un renglón de salida.
    SELECT COALESCE(current_qty, 0) INTO v_prev_qty
    FROM stock_items WHERE id = v_output.stock_item_id FOR UPDATE;
    v_new_qty := v_prev_qty + v_output.qty_produced;

    -- Costo del elaborado: promedio ponderado entre lo que había y lo producido.
    -- Solo para la salida principal (las secundarias no tienen costo imputable).
    v_prev_cost := v_output.item_cost;
    IF v_output.stock_item_id = v_main_item AND v_cost_per_unit IS NOT NULL THEN
      IF v_prev_qty > 0 AND COALESCE(v_prev_cost, 0) > 0 THEN
        v_prev_cost := round((v_prev_qty * v_prev_cost + v_output.qty_produced * v_cost_per_unit) / v_new_qty, 2);
      ELSE
        v_prev_cost := v_cost_per_unit;
      END IF;
      -- v7: sellar fuente y fecha del costo del elaborado.
      UPDATE stock_items
      SET current_qty = v_new_qty,
          cost_per_unit = v_prev_cost,
          cost_source = CASE WHEN v_inputs_confiables THEN 'produccion' ELSE 'estimado' END,
          cost_updated_at = now(),
          updated_at = now()
      WHERE id = v_output.stock_item_id;
    ELSE
      UPDATE stock_items
      SET current_qty = v_new_qty, updated_at = now()
      WHERE id = v_output.stock_item_id;
    END IF;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by,
       production_order_id, cost_per_unit, note)
    VALUES
      (v_output.stock_item_id, v_output.qty_produced, 'entrada', 'produccion_output', v_prev_qty, v_new_qty, p_user_id,
       p_order_id,
       CASE WHEN v_output.stock_item_id = v_main_item THEN v_cost_per_unit ELSE NULL END,
       'Producción #' || p_order_id || ': ' || v_order.name)
    RETURNING id INTO v_mov_id;

    -- Lote: vencimiento explícito o por vida útil del item
    v_produced_at := COALESCE(v_output.produced_at, now());
    v_expires_at  := v_output.expires_at;
    v_shelf_life_days := v_output.item_shelf_life;
    IF v_expires_at IS NULL AND v_shelf_life_days IS NOT NULL THEN
      v_expires_at := v_produced_at + make_interval(days => v_shelf_life_days);
    END IF;
    v_lot_code := COALESCE(
      NULLIF(v_output.lot_code, ''),
      format('LOT-%s-%s-%s', to_char(v_produced_at AT TIME ZONE 'America/Argentina/Tucuman', 'YYMMDD'), p_order_id, v_output.id)
    );

    UPDATE production_outputs
    SET movement_uuid = v_mov_id,
        produced_at   = COALESCE(production_outputs.produced_at, v_produced_at),
        expires_at    = COALESCE(production_outputs.expires_at, v_expires_at),
        lot_code      = COALESCE(NULLIF(production_outputs.lot_code, ''), v_lot_code)
    WHERE id = v_output.id;

    v_lot_id := NULL;
    IF v_output.qty_produced > 0 THEN
      INSERT INTO stock_lots (
        stock_item_id, production_order_id, production_output_id, lot_code,
        qty_original, qty_remaining, unit, produced_at, expires_at, status, notes, created_by
      ) VALUES (
        v_output.stock_item_id, p_order_id, v_output.id, v_lot_code,
        v_output.qty_produced, v_output.qty_produced, COALESCE(v_output.unit, v_output.item_unit, 'unidad'),
        v_produced_at, v_expires_at,
        CASE WHEN v_expires_at IS NOT NULL AND v_expires_at < now() THEN 'expired' ELSE 'active' END,
        v_output.notes, p_user_id
      )
      ON CONFLICT (production_output_id) WHERE production_output_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_lot_id;
    END IF;

    v_total_output_net := v_total_output_net + v_output.qty_produced;
    v_movements := v_movements || jsonb_build_object(
      'type', 'output',
      'stock_item_id', v_output.stock_item_id,
      'change', v_output.qty_produced,
      'movement_id', v_mov_id,
      'lot_id', v_lot_id,
      'lot_code', v_lot_code,
      'expires_at', v_expires_at
    );
  END LOOP;

  IF v_mass_input > 0 THEN
    v_efficiency := round(((v_mass_input - v_mass_waste) / v_mass_input) * 100, 1);
  END IF;

  UPDATE production_orders SET
    status                    = 'completed',
    completed_at              = now(),
    started_at                = COALESCE(started_at, now()),
    updated_at                = now(),
    efficiency_pct            = v_efficiency,
    total_cost                = round(v_total_cost, 2),
    cost_per_output_unit      = v_cost_per_unit,
    main_output_stock_item_id = v_main_item
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success',              true,
    'order_id',             p_order_id,
    'total_input_qty',      v_total_input,
    'total_output_qty',     v_total_output_net,
    'waste_qty',            v_total_waste,
    'efficiency_pct',       v_efficiency,
    'total_cost',           round(v_total_cost, 2),
    'cost_per_output_unit', v_cost_per_unit,
    'main_output_stock_item_id', v_main_item,
    'movements',            v_movements,
    'faltantes',            v_faltantes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_production_order(bigint, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_production_order(bigint, uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production_order(bigint, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.complete_production_order(bigint, uuid, boolean) IS
  'v8: confirma una producción (descuenta insumos, suma elaborados, lotes, costo). p_permitir_faltante=true deja confirmar con insumos sin stock suficiente (quedan en negativo).';

COMMIT;

NOTIFY pgrst, 'reload schema';
