const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ 'application/json': { schema } });
const body = name => ({ required: true, content: json(ref(name)) });
const response = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const errors = { 400: response('Datos invalidos', ref('Error')), 401: response('Falta iniciar sesion o el token vencio', ref('Error')), 403: response('Sin permiso o cuenta inactiva', ref('Error')), 409: response('Stock insuficiente o codigo duplicado', ref('Error')), 429: response('Limite de solicitudes alcanzado', ref('Error')), 502: response('Supabase no disponible', ref('Error')) };
const query = (name, description, schema) => ({ name, in: 'query', description, schema });
const paging = [query('pagina', 'Pagina a consultar', { type: 'integer', minimum: 1, default: 1 }), query('limite', 'Registros por pagina, maximo 100', { type: 'integer', minimum: 1, maximum: 100, default: 25 })];
const filters = [query('producto_id', 'Filtrar por un producto', { type: 'integer', minimum: 1 }), query('fecha_desde', 'Fecha inicial en Bolivia (incluida)', { type: 'string', format: 'date' }), query('fecha_hasta', 'Fecha final en Bolivia (incluida)', { type: 'string', format: 'date' })];
const pathId = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const kg = { type: 'number', minimum: 0.001, multipleOf: 0.001, example: 2.5, description: 'Kilogramos. Maximo 3 decimales.' };
const stock = { type: 'number', minimum: 0, multipleOf: 0.001, example: 5 };
const money = { type: 'number', minimum: 0, multipleOf: 0.01, example: 45, description: 'Bolivianos por kilogramo.' };
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
    title: 'Restaurante Solo Carnes · Backend y base de datos', version: '1.0.0',
    description: `API de compras, ventas e inventario del restaurante Solo Carnes. Permite gestionar sus productos, registrar compras a proveedores, registrar ventas y consultar los movimientos del inventario. Servidor Node.js + Express y base de datos PostgreSQL en Supabase.

## Como probar el proyecto
1. Abre **Autenticacion → POST /api/auth/login → Try it out** e ingresa una cuenta del sistema. Pulsa **Execute**.
2. Copia el valor de **access_token** de la respuesta, sin comillas.
3. Pulsa **Authorize** y pega solamente el token. No agregues la palabra Bearer: Swagger la agrega automaticamente.
4. Consulta **GET /api/productos** para obtener los IDs reales. Si no hay productos, crea uno desde **POST /api/productos**.
5. Registra una compra y luego una venta con ese producto. Consulta **GET /api/kardex** para ver los movimientos.

Las operaciones modifican la base de datos real. Usa productos de prueba identificados para la evaluacion. No se requiere una cuenta de ChatGPT para abrir esta documentacion.

## Reglas del proyecto
- Cantidades y existencias en **kilogramos**, hasta 3 decimales. Precios en **bolivianos**.
- Cada compra o venta corresponde a un producto.
- Las compras actualizan el costo promedio ponderado. Las ventas toman el precio actual del catalogo.
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
    { name: 'Ventas', description: 'Administrador y vendedor. Salidas con control de stock.' },
    { name: 'Kardex', description: 'Administrador y almacen. Historial y ajustes.' },
    { name: 'Usuarios', description: 'Solo administrador. Cuentas nuevas desde Authentication de Supabase.' },
  ],
  paths: {
    '/health': { get: { tags: ['Estado'], summary: 'Verificar que el backend esta en linea', security: [], responses: { 200: response('Servidor disponible', obj({ estado: { type: 'string', example: 'ok' }, servicio: { type: 'string', example: 'Solo Carnes API' }, version: { type: 'string', example: '1.0.0' } })) } } },
    '/api/auth/login': { post: { tags: ['Autenticacion'], summary: 'Obtener token de acceso', security: [], requestBody: body('Login'), responses: { 200: response('Copia access_token y utilizalo en Authorize', obj({ access_token: { type: 'string' }, token_type: { type: 'string', example: 'Bearer' }, expires_in: { type: 'integer', example: 3600 }, usuario: ref('Usuario') })), ...errors } } },
    '/api/auth/me': { get: { tags: ['Autenticacion'], summary: 'Consultar tu perfil y rol', responses: { 200: response('Perfil del usuario autenticado', obj({ usuario: ref('Usuario') })), ...errors } } },
    '/api/productos': {
      get: getList('Productos', 'Producto', 'Listar productos', [query('buscar', 'Buscar por nombre del corte', { type: 'string' }), query('producto_id', 'Filtrar por ID', { type: 'integer' })]),
      post: post('Productos', 'Crear producto', 'ProductoEntrada', obj({ datos: ref('Producto') }), 'Administrador y almacen. El stock y costo iniciales son cero; registra una compra para ingresar existencias.'),
    },
    '/api/productos/{id}': {
      get: { tags: ['Productos'], summary: 'Consultar un producto', parameters: [pathId], responses: { 200: response('Producto encontrado', obj({ datos: ref('Producto') })), 404: response('Producto inexistente'), ...errors } },
      patch: { tags: ['Productos'], summary: 'Editar nombre, codigo, precio de venta o stock minimo', description: 'Administrador y almacen. Envia al menos un campo. Stock y costo se modifican mediante operaciones de inventario.', parameters: [pathId], requestBody: body('ProductoEdicion'), responses: { 200: response('Producto actualizado', obj({ datos: ref('Producto') })), 404: response('Producto inexistente'), ...errors } },
    },
    '/api/compras': {
      get: getList('Compras', 'Compra', 'Consultar compras', filters),
      post: post('Compras', 'Registrar compra y entrada al inventario', 'CompraEntrada', obj({ compra_id: integer, mensaje: { type: 'string' } }), 'Aumenta stock, actualiza el costo promedio ponderado y genera una entrada en el Kardex. Todo se confirma en una transaccion.'),
    },
    '/api/ventas': {
      get: getList('Ventas', 'Venta', 'Consultar ventas segun tu rol', filters),
      post: post('Ventas', 'Registrar venta y salida del inventario', 'VentaEntrada', obj({ venta_id: integer, mensaje: { type: 'string' } }), 'Valida stock y usa el precio de venta del producto. No se recibe precio ni usuario desde el cliente. Si falta stock, devuelve 409 sin registrar la venta.'),
    },
    '/api/kardex': { get: getList('Kardex', 'MovimientoInventario', 'Consultar entradas, salidas y ajustes', [...filters, query('tipo', 'Tipo de movimiento', { type: 'string', enum: ['ENTRADA', 'SALIDA', 'AJUSTE'] })]) },
    '/api/ajustes': { post: post('Kardex', 'Ajustar existencias segun conteo fisico', 'AjusteEntrada', obj({ movimiento_id: integer, mensaje: { type: 'string' } }), 'Indica el stock final real, no una cantidad a sumar. El motivo es obligatorio. Registra la diferencia con signo en el Kardex.') },
    '/api/usuarios': { get: getList('Usuarios', 'Usuario', 'Listar perfiles del personal') },
    '/api/usuarios/{id}': { patch: { tags: ['Usuarios'], summary: 'Cambiar nombre, rol y estado de una cuenta', description: 'Solo administrador. No permite quitar tu propio acceso de administrador. No cambia correos ni contrasenas.', parameters: [{ ...pathId, schema: uuid }], requestBody: body('UsuarioEdicion'), responses: { 200: response('Perfil actualizado', obj({ mensaje: { type: 'string' } })), ...errors } } },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Pega el access_token obtenido en POST /api/auth/login.' } },
    schemas: {
      Error: obj({ error: { type: 'string' }, detalles: { type: 'array', items: obj({ campo: { type: 'string' }, mensaje: { type: 'string' } }) } }),
      Login: obj({ email: { type: 'string', format: 'email', example: 'docente@ejemplo.com' }, password: { type: 'string', format: 'password', writeOnly: true, example: 'Ingresa la contrasena de tu cuenta' } }, ['email', 'password']),
      Usuario: obj({ usuario_id: uuid, nombre_completo: { type: 'string', maxLength: 120 }, rol: { type: 'string', enum: ['administrador', 'vendedor', 'almacen'] }, estado: { type: 'boolean' } }),
      UsuarioEdicion: obj({ nombre_completo: { type: 'string', maxLength: 120, example: 'Personal de prueba' }, rol: { type: 'string', enum: ['administrador', 'vendedor', 'almacen'], example: 'vendedor' }, estado: { type: 'boolean', example: true } }, ['nombre_completo', 'rol', 'estado']),
      Producto: obj({ producto_id: integer, codigo: { type: 'string', maxLength: 30 }, nombre: { type: 'string', maxLength: 150 }, precio_compra: { type: 'number', description: 'Costo promedio vigente, Bs/kg, hasta 4 decimales.' }, precio_venta: money, stock, stock_minimo: stock }),
      ProductoEntrada: obj({ codigo: { type: 'string', example: 'PRUEBA-001', maxLength: 30 }, nombre: { type: 'string', example: 'Lomo de res - prueba', maxLength: 150 }, precio_venta: money, stock_minimo: stock }, ['codigo', 'nombre', 'precio_venta', 'stock_minimo']),
      ProductoEdicion: obj({ codigo: { type: 'string', maxLength: 30 }, nombre: { type: 'string', maxLength: 150 }, precio_venta: money, stock_minimo: stock }),
      Compra: obj({ compra_id: integer, producto_id: integer, usuario_id: uuid, proveedor_nombre: { type: 'string' }, fecha: stamp, cantidad: kg, costo_unitario: { type: 'number' }, total: { type: 'number', description: 'Cantidad x costo, redondeado a 2 decimales por PostgreSQL.' } }),
      CompraEntrada: obj({ producto_id: integer, proveedor_nombre: { type: 'string', example: 'Proveedor de prueba', maxLength: 150 }, cantidad: kg, costo_unitario: { type: 'number', minimum: 0, multipleOf: 0.0001, example: 30 } }, ['producto_id', 'proveedor_nombre', 'cantidad', 'costo_unitario']),
      Venta: obj({ venta_id: integer, producto_id: integer, usuario_id: uuid, cliente_nombre: { type: 'string' }, fecha: stamp, cantidad: kg, precio_unitario: money, total: { type: 'number' } }),
      VentaEntrada: obj({ producto_id: integer, cliente_nombre: { type: 'string', default: 'Consumidor final', maxLength: 150 }, cantidad: kg }, ['producto_id', 'cantidad']),
      MovimientoInventario: obj({ movimiento_id: integer, producto_id: integer, usuario_id: uuid, compra_id: { ...integer, nullable: true }, venta_id: { ...integer, nullable: true }, fecha: stamp, tipo_movimiento: { type: 'string', enum: ['ENTRADA', 'SALIDA', 'AJUSTE'] }, cantidad: { type: 'number', description: 'Positiva para entradas y salidas; diferencia con signo para ajustes.' }, stock_anterior: stock, stock_nuevo: stock, observacion: { type: 'string', nullable: true } }),
      AjusteEntrada: obj({ producto_id: integer, stock_nuevo: stock, motivo: { type: 'string', maxLength: 500, example: 'Conteo fisico de evaluacion' } }, ['producto_id', 'stock_nuevo', 'motivo']),
    },
  },
};
