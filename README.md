# Solo Carnes: backend en Render + base de datos en Supabase

API REST con Node.js y Express. La documentacion Swagger se abre en `/docs/` y permite probar las operaciones desde el navegador. No se necesita el frontend ni una cuenta de ChatGPT.

## Ejecutar

Requiere Node.js 22 o 24.

1. `npm ci`
2. Copiar `.env.example` a `.env`.
3. `npm start`
4. Abrir `http://localhost:3000/docs/`.

Pruebas: `npm test`. Sintaxis: `npm run check`.

## Publicar en Render

Conectar este repositorio como **Web Service**, con runtime **Node**, plan **Free**, Build Command `npm ci` y Start Command `npm start`. Health Check: `/health`.

Variables:

- `SUPABASE_URL`: URL del proyecto.
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable del proyecto (apta para el cliente).
- `NODE_ENV`: `production`.
- `NODE_VERSION`: `22`.

Render proporciona `PORT`. El servidor escucha en `0.0.0.0`. `render.yaml` permite crear el servicio mediante un Blueprint con la misma configuracion. La clave incluida es publicable; no hay contrasenas, JWT de usuarios ni claves `service_role` en el repositorio.

## Como evalua el docente

1. Abrir el enlace de Render terminado en `/docs/`.
2. Ejecutar `POST /api/auth/login` con una cuenta del sistema.
3. Copiar `access_token` en **Authorize** (sin escribir Bearer).
4. Consultar productos, crear un producto de prueba, comprar, vender y revisar Kardex.
5. Abrir **Schemas** para revisar los campos de las cinco tablas.

Las operaciones modifican la base de datos real. Conviene usar registros identificados como prueba. El token no persiste al recargar Swagger; si vence, se obtiene otro iniciando sesion nuevamente.

## Rutas

| Metodo | Ruta | Acceso |
| --- | --- | --- |
| GET | `/health` | Publico |
| GET | `/docs/` | Publico |
| GET | `/openapi.json` | Publico |
| POST | `/api/auth/login` | Cuenta del sistema |
| GET | `/api/auth/me` | Usuario activo |
| GET | `/api/productos` y `/api/productos/:id` | Usuario activo |
| POST / PATCH | `/api/productos` / `/api/productos/:id` | Administrador / almacen |
| GET / POST | `/api/compras` | Administrador / almacen |
| GET / POST | `/api/ventas` | Administrador / vendedor |
| GET | `/api/kardex` | Administrador / almacen |
| POST | `/api/ajustes` | Administrador / almacen |
| GET / PATCH | `/api/usuarios` / `/api/usuarios/:id` | Administrador |

Las listas son paginadas (`pagina`, `limite`, maximo 100). Compras, ventas y Kardex admiten `producto_id`, `fecha_desde` y `fecha_hasta` en fecha de Bolivia. Kardex admite `tipo`. Productos permite `buscar` por nombre.

## Base de datos

Este servidor usa el proyecto Supabase Solo Carnes existente y no crea tablas adicionales:

1. `usuarios`: UUID vinculado a Auth, nombre completo, rol y estado.
2. `productos`: ID, codigo, nombre, costo promedio, precio de venta, stock y stock minimo.
3. `compras`: ID, producto, usuario, proveedor, fecha, cantidad, costo unitario y total.
4. `ventas`: ID, producto, usuario, cliente, fecha, cantidad, precio unitario y total.
5. `movimientos_inventario`: ID, producto, usuario, compra/venta asociada, fecha, tipo, cantidad, stock anterior/nuevo y observacion.

Las funciones existentes `registrar_compra`, `registrar_venta`, `ajustar_inventario` y `gestionar_usuario` ejecutan las escrituras con validacion de rol. Compras, ventas y ajustes bloquean el producto y actualizan todos los registros de manera atomica. Las tablas tienen RLS. El servidor pasa el JWT del usuario a Supabase, de modo que los permisos siguen aplicandose en PostgreSQL. El vendedor solo ve sus propias ventas.

No se permite escribir stock directamente, cambiar el costo promedio con un PATCH ni editar/eliminar operaciones confirmadas. El responsable siempre se obtiene de la sesion. Cantidades en kg (3 decimales), precios en Bs y costo de compra hasta 4 decimales.

## Verificacion

Las pruebas HTTP automatizadas verifican autenticacion, cuentas inactivas, roles, validacion, proteccion de campos, llamadas a RPC y errores. Emplean un doble de Supabase y no modifican la base real. Las funciones PostgreSQL de inventario se verificaron por separado anteriormente mediante transacciones con ROLLBACK. Las pruebas del servidor no sustituyen una comprobacion con la cuenta real en el servicio desplegado.
