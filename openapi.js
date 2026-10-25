const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ 'application/json': { schema } });
const body = name => ({ required: true, content: json(ref(name)) });
const response = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const errors = { 400: response('Datos invalidos', ref('Error')), 401: response('Falta iniciar sesion o el token vencio', ref('Error')), 403: response('Sin permiso o cuenta inactiva', ref('Error')), 409: response('Stock insuficiente o codigo duplicado', ref('Error')), 429: response('Limite de solicitudes alcanzado', ref('Error')), 502: response('Supabase no disponible', ref('Error')) };
const query = (name, description, schema) => ({ name, in: 'query', description, schema });
const paging = [query('pagina', 'Pagina a consultar', { type: 'integer', minimum: 1, default: 1 }), query('limite', 'Registros por pagina, maximo 100', { type: 'integer', minimum: 1, maximum: 100, default: 25 })];
const filters = [query('producto_id', 'Filtrar por un producto', { type: 'integer', minimum: 1 }), query('fecha_desde', 'Fecha inicial en Bolivia (incluida)', { type: 'string', format: 'date' }), query('fecha_hasta', 'Fecha final en Bolivia (incluida)', { type: 'string', format: 'date' })];
const pathId = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const kg = { type: 'number', minimum: 0.001, multipleOf: 0.001, example: 2.5, description: 'Cantidad en la unidad del producto. KG y LITRO: hasta 3 decimales. UNIDAD y platos: solo enteros.' };
const stock = { type: 'number', minimum: 0, multipleOf: 0.001, example: 5 };
const money = { type: 'number', minimum: 0, multipleOf: 0.01, example: 45, description: 'Bolivianos por la unidad declarada. En PLATO, precio por plato.' };
const unit = { type: 'string', enum: ['KG', 'UNIDAD', 'LITRO'], example: 'UNIDAD' };
const productType = { type: 'string', enum: ['INSUMO', 'PLATO', 'PRODUCTO'], description: 'INSUMO: ingrediente de cocina. PLATO: preparado que se vende por unidad. PRODUCTO: articulo para reventa, como bebidas.' };
const integer = { type: 'integer', example: 1 };
const uuid = { type: 'string', format: 'uuid' };
const stamp = { type: 'string', format: 'date-time' };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const page = name => obj({ datos: { type: 'array', items: ref(name) }, pagina: integer, limite: integer, total: integer });
const getList = (tag, name, title, extra = []) => ({ tags: [tag], summary: title, parameters: [...paging, ...extra], responses: { 200: response('Listado paginado', page(name)), ...errors } });
const post = (tag, title, input, output, description) => ({ tags: [tag], summary: title, description, requestBody: body(input), responses: { 201: response('Operacion registrada', output), ...errors } });

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Restaurante Solo Carnes · API Wilfredo', version: '1.2.0',
    description: `API de compras, ventas e inventario del restaurante Solo Carnes. Permite gestionar sus productos, registrar compras a proveedores, registrar ventas y consultar los movimientos del inventario. Servidor Node.js + Express y base de datos PostgreSQL en Supabase.

## Como probar el proyecto
1. Abre **Autenticacion → POST /api/auth/login → Try it out** e ingresa una cuenta del sistema. Pulsa **Execute**.
2. Copia el valor de **access_token** de la respuesta, sin comillas.
3. Pulsa **Authorize** y pega solamente el token. No agregues la palabra Bearer: Swagger la agrega automaticamente.
4. Crea un **INSUMO**, por ejemplo carne de res en KG, y un **PLATO**, por ejemplo parrillada individual en UNIDAD. Consulta **GET /api/productos** para obtener sus IDs reales.
5. Registra una compra del insumo con **POST /api/compras**. Vende platos con **POST /api/ventas**: cantidad 2 significa dos platos.
6. Registra los ingredientes del plato en **Recetas → POST /api/recetas**; por ejemplo 0.3 KG de carne para una parrillada. Al vender el plato, sus insumos se descuentan y se registran automáticamente en Kardex.

Las operaciones modifican la base de datos real. Usa productos de prueba identificados para la evaluacion. No se requiere una cuenta de ChatGPT para abrir esta documentacion.

## Reglas del proyecto
- Tipos: **INSUMO**, **PLATO** y **PRODUCTO** para reventa. Unidades: **KG**, **LITRO** y **UNIDAD**. Precios en **bolivianos** por la unidad declarada.
- Los platos a la parrilla se venden por **unidades enteras**, con stock y stock minimo en cero. No se lleva inventario de platos preparados.
- Las compras ingresan insumos o productos para reventa; no se compran platos preparados. Los insumos no se venden directamente.
- Cada compra o venta corresponde a un producto.
- Las compras actualizan el costo promedio ponderado del insumo o producto. Las ventas toman el precio actual del plato o producto.
- **Recetas automáticas:** cada plato debe tener al menos un insumo configurado en **/api/recetas** antes de venderse. La venta valida existencias, descuenta las cantidades de cada ingrediente y crea sus salidas en Kardex dentro de la misma transacción.
- Al vender un PRODUCTO para reventa (por ejemplo, una gaseosa), se valida y descuenta su stock automaticamente.
- Las funciones de PostgreSQL validan permisos y bloquean el producto durante la actualizacion de stock.
- Operaciones confirmadas y Kardex no se editan ni eliminan. Los ajustes requieren motivo.
- Roles: **administrador**, **vendedor**, **almacen**. El vendedor solo consulta sus propias ventas.
- El token vence; si recibes 401, inicia sesion otra vez. No pegues la clave secreta de Supabase en Authorize.

## Las 5 tablas
Abre **Schemas** al final para revisar los campos de **Usuario**, **Producto**, **Compra**, **Venta** y **MovimientoInventario**. Las contrasenas se administran en Supabase Auth, no se guardan en estas tablas.`,
  },
  servers: [{ url: '/', description: 'Este servidor' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Estado', description: 'Comprobacion publica del servidor.' },
    { name: 'Autenticacion', description: 'Inicia sesion con una cuenta de Solo Carnes.' },
    { name: 'Productos', description: 'Catalogo de productos, precios y existencias del restaurante.' },
    { name: 'Compras', description: 'Administrador y almacen. Entradas de mercancia.' },
    { name: 'Ventas', description: 'Administrador y vendedor. Platos por unidad y productos para reventa.' },
    { name: 'Recetas', description: 'Administrador y almacen. Ingredientes requeridos por cada plato.' },
    { name: 'Kardex', description: 'Administrador y almacen. Consumos manuales de cocina, historial y ajustes.' },
    { name: 'Usuarios', description: 'Solo administrador. Cuentas del personal y roles de acceso.' },
  ],
  paths: {
    '/health': { get: { tags: ['Estado'], summary: 'Verificar que el backend esta en linea', security: [], responses: { 200: response('Servidor disponible', obj({ estado: { type: 'string', example: 'ok' }, servicio: { type: 'string', example: 'Restaurante Solo Carnes API Wilfredo' }, version: { type: 'string', example: '1.1.0' } })) } } },
    '/api/auth/login': { post: { tags: ['Autenticacion'], summary: 'Obtener token de acceso', security: [], requestBody: body('Login'), responses: { 200: response('Copia access_token y utilizalo en Authorize', obj({ access_token: { type: 'string' }, token_type: { type: 'string', example: 'Bearer' }, expires_in: { type: 'integer', example: 3600 }, usuario: ref('Usuario') })), ...errors } } },
    '/api/auth/me': { get: { tags: ['Autenticacion'], summary: 'Consultar tu perfil y rol', responses: { 200: response('Perfil del usuario autenticado', obj({ usuario: ref('Usuario') })), ...errors } } },
    '/api/productos': {
      get: getList('Productos', 'Producto', 'Listar productos', [query('buscar', 'Buscar por nombre del corte', { type: 'string' }), query('producto_id', 'Filtrar por ID', { type: 'integer' })]),
      post: post('Productos', 'Crear insumo, plato o producto para reventa', 'ProductoEntrada', obj({ datos: ref('Producto') }), 'Administrador y almacen. En PLATO usa unidad UNIDAD y stock_minimo 0. En INSUMO o PRODUCTO registra una compra para ingresar existencias.'),
    },
    '/api/productos/{id}': {
      get: { tags: ['Productos'], summary: 'Consultar un producto', parameters: [pathId], responses: { 200: response('Producto encontrado', obj({ datos: ref('Producto') })), 404: response('Producto inexistente'), ...errors } },
      patch: { tags: ['Productos'], summary: 'Editar datos del catalogo', description: 'Administrador y almacen. Envia al menos un campo. No se puede cambiar tipo o unidad si el producto ya tiene historial. Stock y costo se modifican mediante operaciones de inventario.', parameters: [pathId], requestBody: body('ProductoEdicion'), responses: { 200: response('Producto actualizado', obj({ datos: ref('Producto') })), 404: response('Producto inexistente'), ...errors } },
    },
    '/api/compras': {
      get: getList('Compras', 'Compra', 'Consultar compras', filters),
      post: post('Compras', 'Comprar insumos o productos para reventa', 'CompraEntrada', obj({ compra_id: integer, mensaje: { type: 'string' } }), 'No admite PLATO. Aumenta stock en la unidad declarada, actualiza costo promedio y genera una entrada en Kardex. Todo se confirma en una transaccion.'),
    },
    '/api/recetas': {
      get: getList('Recetas', 'RecetaDetalle', 'Listar ingredientes de recetas', [query('plato_id', 'Filtrar por plato', { type: 'integer', minimum: 1 })]),
      post: post('Recetas', 'Agregar un insumo a un plato', 'RecetaEntrada', obj({ datos: ref('RecetaDetalle'), mensaje: { type: 'string' } }), 'Solo administrador y almacen. El producto principal debe ser PLATO y el ingrediente debe ser INSUMO.'),
    },
    '/api/recetas/{id}': { delete: { tags: ['Recetas'], summary: 'Quitar ingrediente de una receta', parameters: [pathId], responses: { 204: response('Ingrediente eliminado'), ...errors } } },
    '/api/ventas': {
      get: getList('Ventas', 'Venta', 'Consultar ventas segun tu rol', filters),
      post: post('Ventas', 'Vender platos preparados o productos para reventa', 'VentaEntrada', obj({ venta_id: integer, mensaje: { type: 'string' } }), 'PLATO: cantidad entera. La receta valida y descuenta automáticamente cada insumo, dejando una salida por ingrediente en Kardex. PRODUCTO: descuenta su propio stock. No admite INSUMO.'),
    },
    '/api/kardex': { get: getList('Kardex', 'MovimientoInventario', 'Consultar entradas, salidas y ajustes', [...filters, query('tipo', 'Tipo de movimiento', { type: 'string', enum: ['ENTRADA', 'SALIDA', 'AJUSTE'] })]) },
    '/api/ajustes': { post: post('Kardex', 'Ajustar existencias segun conteo fisico', 'AjusteEntrada', obj({ movimiento_id: integer, mensaje: { type: 'string' } }), 'Solo INSUMO o PRODUCTO. Indica el stock final real, no una cantidad a sumar. El motivo es obligatorio. Registra la diferencia con signo en el Kardex.') },
    '/api/consumos': { post: post('Kardex', 'Registrar consumo manual de insumos de cocina', 'ConsumoEntrada', obj({ movimiento_id: integer, mensaje: { type: 'string' } }), 'Solo INSUMO. Descuenta la cantidad consumida y genera SALIDA en Kardex con motivo, responsable y unidad. Si falta stock devuelve 409. No se liga automaticamente a una venta ni a una receta.') },
    '/api/usuarios': {
      get: getList('Usuarios', 'Usuario', 'Listar perfiles del personal'),
      post: post('Usuarios', 'Crear una cuenta del personal', 'UsuarioNuevo', obj({ usuario: ref('Usuario'), requiere_confirmacion: { type: 'boolean' }, mensaje: { type: 'string' } }), 'Solo administrador. Crea la cuenta en Supabase Auth y su perfil de personal. Si la confirmación de correo está activa, el usuario deberá confirmarlo antes de iniciar sesión.'),
    },
    '/api/usuarios/{id}': {
      delete: { tags: ['Usuarios'], summary: 'Eliminar una cuenta de prueba sin historial', description: 'Solo administrador. Elimina el acceso y su perfil. No permite eliminar la propia cuenta ni usuarios con operaciones registradas.', parameters: [{ ...pathId, schema: uuid }], responses: { 204: response('Cuenta eliminada'), ...errors } },
      patch: { tags: ['Usuarios'], summary: 'Cambiar nombre, rol y estado de una cuenta', description: 'Solo administrador. No permite quitar tu propio acceso de administrador. No cambia correos ni contrasenas.', parameters: [{ ...pathId, schema: uuid }], requestBody: body('UsuarioEdicion'), responses: { 200: response('Perfil actualizado', obj({ mensaje: { type: 'string' } })), ...errors } },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Pega el access_token obtenido en POST /api/auth/login.' } },
    schemas: {
      Error: obj({ error: { type: 'string' }, detalles: { type: 'array', items: obj({ campo: { type: 'string' }, mensaje: { type: 'string' } }) } }),
      Login: obj({ email: { type: 'string', format: 'email', example: 'docente@ejemplo.com' }, password: { type: 'string', format: 'password', writeOnly: true, example: 'Ingresa la contrasena de tu cuenta' } }, ['email', 'password']),
      Usuario: obj({ usuario_id: uuid, nombre_completo: { type: 'string', maxLength: 120 }, rol: { type: 'string', enum: ['administrador', 'vendedor', 'almacen'] }, estado: { type: 'boolean' } }),
      UsuarioNuevo: obj({ nombre_completo: { type: 'string', maxLength: 120, example: 'Ana Pérez' }, email: { type: 'string', format: 'email', example: 'ana@solocarnes.com' }, password: { type: 'string', format: 'password', minLength: 8, writeOnly: true, example: 'Clave inicial segura' }, rol: { type: 'string', enum: ['administrador', 'vendedor', 'almacen'], example: 'vendedor' } }, ['nombre_completo', 'email', 'password', 'rol']),
      UsuarioEdicion: obj({ nombre_completo: { type: 'string', maxLength: 120, example: 'Personal de prueba' }, rol: { type: 'string', enum: ['administrador', 'vendedor', 'almacen'], example: 'vendedor' }, estado: { type: 'boolean', example: true } }, ['nombre_completo', 'rol', 'estado']),
      Producto: obj({ producto_id: integer, codigo: { type: 'string', maxLength: 30 }, nombre: { type: 'string', maxLength: 150 }, tipo: productType, unidad: unit, precio_compra: { type: 'number', description: 'Costo promedio por unidad, hasta 4 decimales. En PLATO es cero: no hay costeo por receta.' }, precio_venta: money, stock: { ...stock, description: 'Solo INSUMO y PRODUCTO. En PLATO siempre cero.' }, stock_minimo: stock }),
      ProductoEntrada: obj({ codigo: { type: 'string', example: 'PLATO-001', maxLength: 30 }, nombre: { type: 'string', example: 'Parrillada individual', maxLength: 150 }, tipo: { ...productType, example: 'PLATO' }, unidad: unit, precio_venta: money, stock_minimo: { ...stock, example: 0 } }, ['codigo', 'nombre', 'tipo', 'unidad', 'precio_venta', 'stock_minimo']),
      ProductoEdicion: obj({ codigo: { type: 'string', maxLength: 30 }, nombre: { type: 'string', maxLength: 150 }, tipo: productType, unidad: unit, precio_venta: money, stock_minimo: stock }),
      Compra: obj({ compra_id: integer, producto_id: integer, usuario_id: uuid, proveedor_nombre: { type: 'string' }, fecha: stamp, cantidad: kg, unidad: unit, costo_unitario: { type: 'number' }, total: { type: 'number', description: 'Cantidad x costo, redondeado a 2 decimales por PostgreSQL.' } }),
      CompraEntrada: obj({ producto_id: integer, proveedor_nombre: { type: 'string', example: 'Proveedor de prueba', maxLength: 150 }, cantidad: kg, costo_unitario: { type: 'number', minimum: 0, multipleOf: 0.0001, example: 30 } }, ['producto_id', 'proveedor_nombre', 'cantidad', 'costo_unitario']),
      RecetaDetalle: obj({ receta_id: integer, plato_id: integer, insumo_id: integer, cantidad: kg }),
      RecetaEntrada: obj({ plato_id: integer, insumo_id: integer, cantidad: kg }, ['plato_id', 'insumo_id', 'cantidad']),
      Venta: obj({ venta_id: integer, producto_id: integer, usuario_id: uuid, cliente_nombre: { type: 'string' }, fecha: stamp, cantidad: kg, unidad: unit, precio_unitario: money, total: { type: 'number' } }),
      VentaEntrada: obj({ producto_id: integer, cliente_nombre: { type: 'string', default: 'Consumidor final', maxLength: 150 }, cantidad: { ...kg, example: 2, description: 'Para PLATO: numero entero de platos. Para PRODUCTO: cantidad en su unidad.' } }, ['producto_id', 'cantidad']),
      MovimientoInventario: obj({ movimiento_id: integer, producto_id: integer, usuario_id: uuid, compra_id: { ...integer, nullable: true }, venta_id: { ...integer, nullable: true }, fecha: stamp, tipo_movimiento: { type: 'string', enum: ['ENTRADA', 'SALIDA', 'AJUSTE'] }, cantidad: { type: 'number', description: 'Positiva para entradas y salidas; diferencia con signo para ajustes.' }, unidad: unit, stock_anterior: stock, stock_nuevo: stock, observacion: { type: 'string', nullable: true } }),
      AjusteEntrada: obj({ producto_id: integer, stock_nuevo: stock, motivo: { type: 'string', maxLength: 500, example: 'Conteo fisico de evaluacion' } }, ['producto_id', 'stock_nuevo', 'motivo']),
      ConsumoEntrada: obj({ producto_id: integer, cantidad: { ...kg, example: 0.6 }, motivo: { type: 'string', maxLength: 500, example: 'Carne utilizada en parrilladas del turno de almuerzo' } }, ['producto_id', 'cantidad', 'motivo']),
    },
  },
};
