-- Ejecutar una vez en Supabase SQL Editor.
-- Elimina solo cuentas sin operaciones para conservar la trazabilidad.
BEGIN;

CREATE OR REPLACE FUNCTION public.eliminar_usuario(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(public.mi_rol(), '') <> 'administrador' THEN
    RAISE EXCEPTION 'Sin permiso para eliminar usuarios';
  END IF;
  IF p_usuario_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE usuario_id = p_usuario_id) THEN
    RAISE EXCEPTION 'Usuario inexistente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.compras WHERE usuario_id = p_usuario_id)
     OR EXISTS (SELECT 1 FROM public.ventas WHERE usuario_id = p_usuario_id)
     OR EXISTS (SELECT 1 FROM public.movimientos_inventario WHERE usuario_id = p_usuario_id) THEN
    RAISE EXCEPTION 'No se puede eliminar un usuario con operaciones registradas';
  END IF;
  DELETE FROM auth.users WHERE id = p_usuario_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_usuario(uuid) TO authenticated;
COMMIT;
