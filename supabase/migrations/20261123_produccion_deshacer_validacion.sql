-- Deshacer la validación de una producción (23/11/2026)
-- ---------------------------------------------------------------------------
-- Pedido de cocina: quien valida una producción tiene que poder corregirse si
-- se equivocó (confirmó un duplicado, un número mal cargado, etc.).
--
-- revert_production_order deshace lo que hizo complete_production_order:
--   · Stock: por cada insumo/elaborado, el neto que movió ESTA confirmación
--     (movimientos de la orden desde completed_at, incluido el ajuste de
--     "ya estaba en el conteo") se vuelve atrás con un movimiento
--     'produccion_revertida'. Los insumos vuelven, lo producido sale.
--   · Lo que se contó DESPUÉS de confirmar no se toca: el conteo ya dejó el
--     número real (se devuelve en 'no_tocados').
--   · Costo del elaborado: si nadie lo cambió desde la confirmación, se
--     deshace el promedio ponderado con los números de ese movimiento.
--   · Lotes de la producción: se borran (al volver a confirmar se crean de
--     nuevo; sin esto el ON CONFLICT no los recrearía).
--   · La orden vuelve a 'pending_review' (para corregir con «Falta algo» y
--     confirmar, o rechazar) y queda marcada con validacion_deshecha_at/_por.
-- Fudo lo actualiza la API con los 'movements' que devuelve (igual que al
-- confirmar). Quién puede y hasta cuándo (2 días) lo decide la API.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS validacion_deshecha_at  timestamptz,
  ADD COLUMN IF NOT EXISTS validacion_deshecha_por uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.production_orders.validacion_deshecha_at IS
  'Última vez que se deshizo la validación (revert_production_order). Los movimientos de stock anteriores a esta fecha ya quedaron compensados.';
COMMENT ON COLUMN public.production_orders.validacion_deshecha_por IS
  'Quién deshizo la validación por última vez.';

CREATE OR REPLACE FUNCTION public.revert_production_order(p_order_id bigint, p_user_id uuid, p_nota text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order        production_orders%ROWTYPE;
  v_item         RECORD;
  v_main         RECORD;
  v_prev         numeric;
  v_new          numeric;
  v_mov_id       uuid;
  v_n_main       int;
  v_cost_now     numeric;
  v_cost_upd     timestamptz;
  v_restored     numeric;
  v_costo        text := 'sin_cambio';
  v_lotes        int := 0;
  v_movements    jsonb := '[]'::jsonb;
  v_no_tocados   jsonb := '[]'::jsonb;
  v_negativos    jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM production_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producción no encontrada');
  END IF;
  IF v_order.status <> 'completed' OR v_order.completed_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_confirmada', 'error', 'Esta producción no está confirmada');
  END IF;

  -- ── 1) Costo del elaborado principal ──
  -- complete_production_order lo dejó en (antes·costo_antes + producido·costo_tanda) / después
  -- y selló cost_updated_at = completed_at. Si sigue igual (nadie lo tocó
  -- después) se despeja costo_antes. Con más de un renglón del mismo elaborado
  -- o sin stock previo no se puede despejar: queda como está.
  IF v_order.main_output_stock_item_id IS NOT NULL AND COALESCE(v_order.cost_per_output_unit, 0) > 0 THEN
    SELECT count(*) INTO v_n_main
    FROM stock_movements
    WHERE production_order_id = p_order_id
      AND reason = 'produccion_output'
      AND stock_item_id = v_order.main_output_stock_item_id
      AND created_at = v_order.completed_at;

    IF v_n_main = 1 THEN
      SELECT previous_qty, new_qty, qty INTO v_main
      FROM stock_movements
      WHERE production_order_id = p_order_id
        AND reason = 'produccion_output'
        AND stock_item_id = v_order.main_output_stock_item_id
        AND created_at = v_order.completed_at;

      SELECT cost_per_unit, cost_updated_at INTO v_cost_now, v_cost_upd
      FROM stock_items WHERE id = v_order.main_output_stock_item_id FOR UPDATE;

      IF v_cost_upd = v_order.completed_at AND COALESCE(v_cost_now, 0) > 0 AND COALESCE(v_main.previous_qty, 0) > 0 THEN
        v_restored := round((v_cost_now * v_main.new_qty - v_main.qty * v_order.cost_per_output_unit) / v_main.previous_qty, 2);
        IF v_restored > 0 THEN
          UPDATE stock_items
          SET cost_per_unit = v_restored, cost_updated_at = now(), updated_at = now()
          WHERE id = v_order.main_output_stock_item_id;
          v_costo := 'restaurado';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── 2) Stock: lo que movió esta confirmación, neto por item ──
  FOR v_item IN
    SELECT sm.stock_item_id, si.name, si.unit, si.last_counted_at,
           SUM(sm.new_qty - sm.previous_qty) AS neto
    FROM stock_movements sm
    JOIN stock_items si ON si.id = sm.stock_item_id
    WHERE sm.production_order_id = p_order_id
      AND sm.created_at >= v_order.completed_at
      AND sm.previous_qty IS NOT NULL
      AND sm.new_qty IS NOT NULL
    GROUP BY sm.stock_item_id, si.name, si.unit, si.last_counted_at
    HAVING abs(SUM(sm.new_qty - sm.previous_qty)) >= 0.0005
    ORDER BY si.name
  LOOP
    -- Se contó después de confirmar: el conteo ya dejó el número real
    IF v_item.last_counted_at IS NOT NULL AND v_item.last_counted_at > v_order.completed_at THEN
      v_no_tocados := v_no_tocados || jsonb_build_object(
        'stock_item_id', v_item.stock_item_id,
        'nombre',        v_item.name
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(current_qty, 0) INTO v_prev
    FROM stock_items WHERE id = v_item.stock_item_id FOR UPDATE;
    v_new := v_prev - v_item.neto;

    UPDATE stock_items
    SET current_qty = v_new, updated_at = now()
    WHERE id = v_item.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by,
       production_order_id, note)
    VALUES
      (v_item.stock_item_id, abs(v_item.neto),
       CASE WHEN v_item.neto > 0 THEN 'uso' ELSE 'entrada' END,
       'produccion_revertida', v_prev, v_new, p_user_id, p_order_id,
       'Producción #' || p_order_id || ': ' || v_order.name || ' · se deshizo la validación ('
         || CASE WHEN v_item.neto > 0 THEN 'sale lo producido' ELSE 'vuelve lo usado' END || ')')
    RETURNING id INTO v_mov_id;

    v_movements := v_movements || jsonb_build_object(
      'stock_item_id', v_item.stock_item_id,
      'change',        -v_item.neto,
      'movement_id',   v_mov_id
    );

    IF v_new < 0 THEN
      v_negativos := v_negativos || jsonb_build_object(
        'stock_item_id', v_item.stock_item_id,
        'nombre',        v_item.name,
        'unidad',        v_item.unit,
        'cantidad',      round(v_new::numeric, 3)
      );
    END IF;
  END LOOP;

  -- ── 3) Lotes de esta producción ──
  DELETE FROM stock_lots WHERE production_order_id = p_order_id;
  GET DIAGNOSTICS v_lotes = ROW_COUNT;

  UPDATE production_inputs  SET movement_uuid = NULL WHERE production_order_id = p_order_id;
  UPDATE production_outputs SET movement_uuid = NULL WHERE production_order_id = p_order_id;

  -- ── 4) La orden vuelve a "para confirmar" ──
  UPDATE production_orders SET
    status                    = 'pending_review',
    completed_at              = NULL,
    efficiency_pct            = NULL,
    total_cost                = NULL,
    cost_per_output_unit      = NULL,
    main_output_stock_item_id = NULL,
    reviewed_by               = NULL,
    reviewed_at               = NULL,
    review_notes              = COALESCE(left(p_nota, 1000), review_notes),
    validacion_deshecha_at    = now(),
    validacion_deshecha_por   = p_user_id,
    updated_at                = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success',        true,
    'order_id',       p_order_id,
    'movements',      v_movements,
    'no_tocados',     v_no_tocados,
    'negativos',      v_negativos,
    'costo',          v_costo,
    'lotes_borrados', v_lotes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_production_order(bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_production_order(bigint, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_production_order(bigint, uuid, text) TO service_role;

COMMENT ON FUNCTION public.revert_production_order(bigint, uuid, text) IS
  'Deshace complete_production_order: devuelve el stock que movió esa confirmación (salvo lo contado después), restaura el costo del elaborado si nadie lo tocó, borra los lotes y deja la orden en pending_review.';

COMMIT;

NOTIFY pgrst, 'reload schema';
