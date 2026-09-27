-- bar_stock_items: cerrar las policies permisivas (USING/WITH CHECK true, rol public).
--
-- Tabla legacy (la barra vive en stock_items con area = 'barra'). Todas las
-- escrituras de la app pasan por el service role (bypassa RLS):
--   - src/app/api/kitchen/bar/route.ts   (update_stock, update_supplier)
--   - src/lib/ai/chatbot-actions.ts      (update de current_qty desde el chatbot)
-- Las lecturas con la sesión del usuario (proveedores, dashboard barista,
-- contexto del chatbot) siguen funcionando: select abierto a authenticated.
--
-- Resultado: anon no lee ni escribe; authenticated lee; solo encargado/socio
-- (is_encargado()) inserta o actualiza por la API pública.

DO $$
DECLARE
  pol record;
BEGIN
  -- is_encargado() existe en prod pero no está versionada en migrations/.
  -- Solo se crea si falta (DB local / reset); nunca pisa la definición de prod.
  IF to_regprocedure('public.is_encargado()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_encargado() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
        SELECT EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role::text IN ('encargado', 'socio')
        )
      $body$
    $fn$;
  END IF;

  -- Borrar TODAS las policies de la tabla (las de 20260319_fudo_sync_safe y
  -- las viejas bar_stock_* de 20260319_bar_operations, si quedaron). Las
  -- policies permisivas se combinan con OR: una sola que sobreviva con `true`
  -- dejaría la tabla abierta.
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bar_stock_items'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.bar_stock_items', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.bar_stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bar_stock_items_select ON public.bar_stock_items
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY bar_stock_items_insert ON public.bar_stock_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_encargado());

CREATE POLICY bar_stock_items_update ON public.bar_stock_items
  FOR UPDATE TO authenticated
  USING (public.is_encargado())
  WITH CHECK (public.is_encargado());

-- Sin policy de DELETE: nadie borra por la API pública (igual que antes).
