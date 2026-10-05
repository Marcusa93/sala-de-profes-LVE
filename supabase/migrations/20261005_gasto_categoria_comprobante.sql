-- ---------------------------------------------------------------------------
-- Datos del gasto en cada recibo de compra (stock_receipts)
-- ---------------------------------------------------------------------------
-- Al confirmar una compra ("Llegó" / "Llegó todo") se elige la categoría del
-- gasto (análisis de fin de mes) y el comprobante. Categoría, tipo y número
-- van también a Fudo; IVA e IIBB (Factura A) solo quedan acá: la API de Fudo
-- no permite cargar impuestos en un gasto.
--
-- Solo AGREGA columnas, todas opcionales: no toca datos existentes. Se puede
-- correr más de una vez. Hasta que se corra, la app sigue funcionando igual
-- (manda los datos a Fudo y no los guarda acá).
-- ---------------------------------------------------------------------------

alter table public.stock_receipts
  add column if not exists expense_category_id   text,
  add column if not exists expense_category_name text,
  add column if not exists comprobante_tipo      text,
  add column if not exists comprobante_numero    text,
  add column if not exists iva                   numeric(14,2),
  add column if not exists iibb                  numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_receipts_comprobante_tipo_check') then
    alter table public.stock_receipts
      add constraint stock_receipts_comprobante_tipo_check
      check (comprobante_tipo is null or comprobante_tipo in ('sin_comprobante', 'ticket', 'factura_a', 'factura_b', 'factura_c'));
  end if;
end $$;

comment on column public.stock_receipts.expense_category_id is 'Id de la categoría de gasto en Fudo (ExpenseCategory)';
comment on column public.stock_receipts.iva  is 'IVA de la factura A. En compras de varios productos va solo en el primer recibo del lote.';
comment on column public.stock_receipts.iibb is 'IIBB de la factura A. En compras de varios productos va solo en el primer recibo del lote.';

-- Para "última categoría usada con este proveedor"
create index if not exists stock_receipts_supplier_categoria
  on public.stock_receipts (supplier_id, id desc)
  where expense_category_id is not null;
