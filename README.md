# Restaurante Solo Carnes: backend en Render + base de datos en Supabase

API REST de compras, ventas e inventario del restaurante Solo Carnes, con Node.js y Express. Gestiona insumos de cocina, platos a la parrilla y productos para reventa. La documentacion Swagger se abre en `/docs/` y permite probar las operaciones desde el navegador. No se necesita el frontend ni una cuenta de ChatGPT.

## Procedimiento del restaurante (cinco tablas)

- **INSUMO:** carne, papa, aceite, condimentos. Se compra y se controla en KG, LITRO o UNIDAD. No se vende directamente.
- **PLATO:** parrillada individual, churrasco con guarnicion. Se vende por UNIDAD entera. No se compra ni se lleva stock de platos preparados; stock y stock minimo quedan en cero.
- **PRODUCTO:** bebidas u otros articulos para reventa. Se compran, se almacenan y su venta descuenta stock automaticamente.

El encargado registra manualmente el consumo de cocina en `POST /api/consumos`: producto insumo, cantidad utilizada y motivo. Esta operacion descuenta el insumo y deja una SALIDA en Kardex. **Vender un plato no descuenta ingredientes automaticamente.** Este MVP no incluye recetas ni costeo automatico de platos, para conservar las cinco tablas.

Ejemplo: comprar 10 KG de carne; vender dos parrilladas a Bs 60 cada una (total Bs 120); registrar por separado 0.6 KG de carne utilizados en cocina. Quedan 9.4 KG del insumo. Una bebida de reventa se vende y descuenta por su unidad, sin requerir un consumo manual.

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
4. Crear un INSUMO en KG y un PLATO en UNIDAD. Comprar el insumo, vender platos y registrar por separado el consumo en cocina. Consultar Kardex.
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
| POST | `/api/consumos` | Administrador / almacen |
| GET / PATCH | `/api/usuarios` / `/api/usuarios/:id` | Administrador |

Las listas son paginadas (`pagina`, `limite`, maximo 100). Compras, ventas y Kardex admiten `producto_id`, `fecha_desde` y `fecha_hasta` en fecha de Bolivia. Kardex admite `tipo`. Productos permite `buscar` por nombre.

## Base de datos

Este servidor usa el proyecto Supabase Solo Carnes existente y no crea tablas adicionales:

1. `usuarios`: UUID vinculado a Auth, nombre completo, rol y estado.
2. `productos`: ID, codigo, nombre, tipo (INSUMO/PLATO/PRODUCTO), unidad (KG/UNIDAD/LITRO), costo promedio, precio de venta, stock y stock minimo.
3. `compras`: ID, producto, usuario, proveedor, fecha, cantidad, unidad, costo unitario y total.
4. `ventas`: ID, producto, usuario, cliente, fecha, cantidad, unidad, precio unitario y total.
5. `movimientos_inventario`: ID, producto, usuario, compra/venta asociada, fecha, tipo, cantidad, unidad, stock anterior/nuevo y observacion.

Las funciones `registrar_compra`, `registrar_venta`, `registrar_consumo_insumo`, `ajustar_inventario` y `gestionar_usuario` ejecutan las escrituras con validacion de rol. Las operaciones bloquean el producto y actualizan sus registros de manera atomica. Las tablas tienen RLS. El servidor pasa el JWT del usuario a Supabase, de modo que los permisos siguen aplicandose en PostgreSQL. El vendedor solo ve sus propias ventas.

No se permite escribir stock directamente, cambiar el costo promedio con un PATCH ni editar/eliminar operaciones confirmadas. El responsable siempre se obtiene de la sesion. KG y LITRO admiten 3 decimales; UNIDAD solo numeros enteros. Precios en Bs por la unidad declarada y costo de compra hasta 4 decimales. El tipo y la unidad no se pueden cambiar si existe historial, para no reinterpretar cantidades anteriores.

`restaurante.sql` contiene la migracion aplicada sobre las cinco tablas existentes. Conserva los registros previos como insumos en KG y sus unidades historicas; no es un esquema completo para una base vacia. La interfaz antigua del primer prototipo no corresponde a este nuevo flujo; la entrega actual es la API de restaurante documentada en Swagger.

## Verificacion

Las pruebas HTTP automatizadas verifican autenticacion, cuentas inactivas, roles, validacion, proteccion de campos, llamadas a RPC y errores. Emplean un doble de Supabase y no modifican la base real. Las funciones PostgreSQL de inventario se verificaron por separado anteriormente mediante transacciones con ROLLBACK. Las pruebas del servidor no sustituyen una comprobacion con la cuenta real en el servicio desplegado.
