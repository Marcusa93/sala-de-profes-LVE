-- Recibos de un gasto anulado en Fudo (23/11/2026)
-- ---------------------------------------------------------------------------
-- Joaquín comparó Cuentas por pagar con Fudo: Limplus #2507 está anulado en
-- Fudo y la app lo seguía sumando a la deuda (solo avisaba). Ahora la
-- sincronización de pagos (lib/compras/pagos-fudo) pasa esos recibos a
-- 'anulado_fudo': no suman a la deuda en ningún lado (todo filtra 'a_pagar')
-- y el stock no se toca (Fudo ya lo devolvió al anular, y lo contado queda).
-- Si en Fudo el gasto vuelve a estar vigente, vuelven solos a 'a_pagar'.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.stock_receipts DROP CONSTRAINT IF EXISTS stock_receipts_payment_status_check;
ALTER TABLE public.stock_receipts ADD CONSTRAINT stock_receipts_payment_status_check
  CHECK (payment_status = ANY (ARRAY['pagado'::text, 'a_pagar'::text, 'anulado_fudo'::text]));

COMMENT ON COLUMN public.stock_receipts.payment_status IS
  'a_pagar | pagado | anulado_fudo (el gasto de Fudo está anulado: no suma a la deuda; lo marca y desmarca sincronizarPagosDesdeFudo).';

COMMIT;
