-- Migracion del MVP existente: restaurante, cinco tablas, consumo manual.
-- No elimina registros. Los productos e historicos anteriores conservan KG.
BEGIN;
ALTER TABLE public.productos ADD COLUMN tipo varchar(10) NOT NULL DEFAULT 'INSUMO' CHECK (tipo IN ('INSUMO','PLATO','PRODUCTO'));
ALTER TABLE public.productos ADD COLUMN unidad varchar(10) NOT NULL DEFAULT 'KG' CHECK (unidad IN ('KG','UNIDAD','LITRO'));
ALTER TABLE public.productos ADD CONSTRAINT platos_sin_stock CHECK (tipo <> 'PLATO' OR (unidad='UNIDAD' AND stock=0 AND stock_minimo=0 AND precio_compra=0));
ALTER TABLE public.productos ADD CONSTRAINT stock_unidades_enteras CHECK (unidad <> 'UNIDAD' OR (stock=trunc(stock) AND stock_minimo=trunc(stock_minimo)));
ALTER TABLE public.compras ADD COLUMN unidad varchar(10) NOT NULL DEFAULT 'KG' CHECK (unidad IN ('KG','UNIDAD','LITRO'));
ALTER TABLE public.ventas ADD COLUMN unidad varchar(10) NOT NULL DEFAULT 'KG' CHECK (unidad IN ('KG','UNIDAD','LITRO'));
ALTER TABLE public.movimientos_inventario ADD COLUMN unidad varchar(10) NOT NULL DEFAULT 'KG' CHECK (unidad IN ('KG','UNIDAD','LITRO'));
ALTER TABLE public.movimientos_inventario DROP CONSTRAINT movimientos_inventario_check;
ALTER TABLE public.movimientos_inventario ADD CONSTRAINT movimientos_restaurante_check CHECK (
 (tipo_movimiento='ENTRADA' AND compra_id IS NOT NULL AND venta_id IS NULL AND cantidad>0 AND stock_nuevo=stock_anterior+cantidad)
 OR (tipo_movimiento='SALIDA' AND compra_id IS NULL AND cantidad>0 AND stock_nuevo=stock_anterior-cantidad AND (venta_id IS NOT NULL OR coalesce(btrim(observacion),'')<>''))
 OR (tipo_movimiento='AJUSTE' AND compra_id IS NULL AND venta_id IS NULL AND stock_nuevo=stock_anterior+cantidad AND coalesce(btrim(observacion),'')<>''));
GRANT INSERT(tipo,unidad),UPDATE(tipo,unidad) ON public.productos TO authenticated;

CREATE OR REPLACE FUNCTION public.proteger_unidad_producto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.unidad IS DISTINCT FROM OLD.unidad) AND
 (EXISTS(SELECT 1 FROM public.compras WHERE producto_id=OLD.producto_id) OR EXISTS(SELECT 1 FROM public.ventas WHERE producto_id=OLD.producto_id) OR EXISTS(SELECT 1 FROM public.movimientos_inventario WHERE producto_id=OLD.producto_id))
 THEN RAISE EXCEPTION 'No se puede cambiar tipo o unidad de un producto con historial; crea otro producto'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.proteger_unidad_producto() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER proteger_unidad_producto BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION public.proteger_unidad_producto();

CREATE OR REPLACE FUNCTION public.registrar_compra(p_producto_id integer,p_cantidad numeric,p_costo_unitario numeric,p_proveedor_nombre text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; nuevo numeric; costo numeric; resultado integer;
BEGIN
 IF coalesce(public.mi_rol(),'') NOT IN ('administrador','almacen') THEN RAISE EXCEPTION 'Sin permiso para registrar compras'; END IF;
 IF p_cantidad IS NULL OR NOT(p_cantidad>0 AND p_cantidad<1000000000) OR p_cantidad<>round(p_cantidad,3) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
 IF p_costo_unitario IS NULL OR NOT(p_costo_unitario>=0 AND p_costo_unitario<100000000) OR p_costo_unitario<>round(p_costo_unitario,4) THEN RAISE EXCEPTION 'Costo invalido'; END IF;
 IF coalesce(btrim(p_proveedor_nombre),'')='' THEN RAISE EXCEPTION 'Indique el proveedor'; END IF;
 SELECT * INTO p FROM public.productos WHERE producto_id=p_producto_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente'; END IF;
 IF p.tipo='PLATO' THEN RAISE EXCEPTION 'Los platos se preparan en cocina; compra insumos o productos para reventa'; END IF;
 IF p.unidad='UNIDAD' AND p_cantidad<>trunc(p_cantidad) THEN RAISE EXCEPTION 'La cantidad debe ser un numero entero para UNIDAD'; END IF;
 nuevo:=p.stock+p_cantidad;
 costo:=round((p.stock*p.precio_compra+p_cantidad*p_costo_unitario)/nuevo,4);
 INSERT INTO public.compras(producto_id,usuario_id,proveedor_nombre,cantidad,costo_unitario,unidad) VALUES(p_producto_id,auth.uid(),btrim(p_proveedor_nombre),p_cantidad,p_costo_unitario,p.unidad) RETURNING compra_id INTO resultado;
 UPDATE public.productos SET stock=nuevo,precio_compra=costo WHERE producto_id=p_producto_id;
 INSERT INTO public.movimientos_inventario(producto_id,usuario_id,compra_id,tipo_movimiento,cantidad,stock_anterior,stock_nuevo,observacion,unidad) VALUES(p_producto_id,auth.uid(),resultado,'ENTRADA',p_cantidad,p.stock,nuevo,'Compra para el restaurante',p.unidad);
 RETURN resultado;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_venta(p_producto_id integer,p_cantidad numeric,p_cliente_nombre text DEFAULT 'Consumidor final') RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; nuevo numeric; resultado integer;
BEGIN
 IF coalesce(public.mi_rol(),'') NOT IN ('administrador','vendedor') THEN RAISE EXCEPTION 'Sin permiso para registrar ventas'; END IF;
 IF p_cantidad IS NULL OR NOT(p_cantidad>0 AND p_cantidad<1000000000) OR p_cantidad<>round(p_cantidad,3) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
 SELECT * INTO p FROM public.productos WHERE producto_id=p_producto_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente'; END IF;
 IF p.tipo='INSUMO' THEN RAISE EXCEPTION 'Un insumo es de cocina y no se vende directamente; selecciona un plato o producto para reventa'; END IF;
 IF p.unidad='UNIDAD' AND p_cantidad<>trunc(p_cantidad) THEN RAISE EXCEPTION 'La cantidad debe ser un numero entero para UNIDAD'; END IF;
 IF p.tipo='PRODUCTO' AND p.stock<p_cantidad THEN RAISE EXCEPTION 'Stock insuficiente: disponible % %',p.stock,p.unidad; END IF;
 INSERT INTO public.ventas(producto_id,usuario_id,cliente_nombre,cantidad,precio_unitario,unidad) VALUES(p_producto_id,auth.uid(),coalesce(nullif(btrim(p_cliente_nombre),''),'Consumidor final'),p_cantidad,p.precio_venta,p.unidad) RETURNING venta_id INTO resultado;
 IF p.tipo='PRODUCTO' THEN
  nuevo:=p.stock-p_cantidad;
  UPDATE public.productos SET stock=nuevo WHERE producto_id=p_producto_id;
  INSERT INTO public.movimientos_inventario(producto_id,usuario_id,venta_id,tipo_movimiento,cantidad,stock_anterior,stock_nuevo,observacion,unidad) VALUES(p_producto_id,auth.uid(),resultado,'SALIDA',p_cantidad,p.stock,nuevo,'Venta de producto para reventa',p.unidad);
 END IF;
 RETURN resultado;
END $$;

CREATE OR REPLACE FUNCTION public.ajustar_inventario(p_producto_id integer,p_stock_nuevo numeric,p_motivo text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; resultado integer;
BEGIN
 IF coalesce(public.mi_rol(),'') NOT IN ('administrador','almacen') THEN RAISE EXCEPTION 'Sin permiso para ajustar inventario'; END IF;
 IF p_stock_nuevo IS NULL OR NOT(p_stock_nuevo>=0 AND p_stock_nuevo<1000000000) OR p_stock_nuevo<>round(p_stock_nuevo,3) THEN RAISE EXCEPTION 'Stock invalido'; END IF;
 IF coalesce(btrim(p_motivo),'')='' THEN RAISE EXCEPTION 'El ajuste requiere motivo'; END IF;
 SELECT * INTO p FROM public.productos WHERE producto_id=p_producto_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente'; END IF;
 IF p.tipo='PLATO' THEN RAISE EXCEPTION 'Los platos no tienen stock; ajusta los insumos o productos para reventa'; END IF;
 IF p.unidad='UNIDAD' AND p_stock_nuevo<>trunc(p_stock_nuevo) THEN RAISE EXCEPTION 'El stock debe ser entero para UNIDAD'; END IF;
 IF p_stock_nuevo=p.stock THEN RAISE EXCEPTION 'El ajuste no modifica el stock'; END IF;
 UPDATE public.productos SET stock=p_stock_nuevo WHERE producto_id=p_producto_id;
 INSERT INTO public.movimientos_inventario(producto_id,usuario_id,tipo_movimiento,cantidad,stock_anterior,stock_nuevo,observacion,unidad) VALUES(p_producto_id,auth.uid(),'AJUSTE',p_stock_nuevo-p.stock,p.stock,p_stock_nuevo,btrim(p_motivo),p.unidad) RETURNING movimiento_id INTO resultado;
 RETURN resultado;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_consumo_insumo(p_producto_id integer,p_cantidad numeric,p_motivo text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; nuevo numeric; resultado integer;
BEGIN
 IF coalesce(public.mi_rol(),'') NOT IN ('administrador','almacen') THEN RAISE EXCEPTION 'Sin permiso para registrar consumos'; END IF;
 IF p_cantidad IS NULL OR NOT(p_cantidad>0 AND p_cantidad<1000000000) OR p_cantidad<>round(p_cantidad,3) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
 IF coalesce(btrim(p_motivo),'')='' THEN RAISE EXCEPTION 'El consumo requiere un motivo'; END IF;
 SELECT * INTO p FROM public.productos WHERE producto_id=p_producto_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente'; END IF;
 IF p.tipo<>'INSUMO' THEN RAISE EXCEPTION 'El consumo de cocina solo admite insumos'; END IF;
 IF p.unidad='UNIDAD' AND p_cantidad<>trunc(p_cantidad) THEN RAISE EXCEPTION 'La cantidad debe ser un numero entero para UNIDAD'; END IF;
 IF p.stock<p_cantidad THEN RAISE EXCEPTION 'Stock insuficiente: disponible % %',p.stock,p.unidad; END IF;
 nuevo:=p.stock-p_cantidad;
 UPDATE public.productos SET stock=nuevo WHERE producto_id=p_producto_id;
 INSERT INTO public.movimientos_inventario(producto_id,usuario_id,tipo_movimiento,cantidad,stock_anterior,stock_nuevo,observacion,unidad) VALUES(p_producto_id,auth.uid(),'SALIDA',p_cantidad,p.stock,nuevo,'Consumo de cocina: '||btrim(p_motivo),p.unidad) RETURNING movimiento_id INTO resultado;
 RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.registrar_consumo_insumo(integer,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_insumo(integer,numeric,text) TO authenticated;
COMMENT ON TABLE public.productos IS 'Catalogo del restaurante: INSUMO de cocina, PLATO preparado o PRODUCTO para reventa';
COMMENT ON COLUMN public.productos.stock IS 'Stock solo para insumos y reventa. Los platos se venden por unidad sin descontar ingredientes automaticamente.';
COMMENT ON COLUMN public.productos.precio_venta IS 'Precio por la unidad declarada; en PLATO es el precio de cada plato.';
COMMENT ON COLUMN public.productos.precio_compra IS 'Costo promedio por unidad declarada; no se calcula costo de receta para platos.';
COMMIT;
SELECT 'Restaurante adaptado: cinco tablas, platos por unidad y consumo manual de insumos' AS resultado;
