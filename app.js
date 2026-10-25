import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { openapi } from './openapi.js';

const text = max => z.string().trim().min(1).max(max);
const id = z.coerce.number().int().positive().max(2147483647);
const decimal = (max, places, positive = false) => z.number().finite().min(positive ? 10 ** -places : 0).max(max)
  .refine(v => Math.abs(v * 10 ** places - Math.round(v * 10 ** places)) < 0.00001, `Use hasta ${places} decimales`);
const kg = decimal(999999999.999, 3, true);
const stock = decimal(999999999.999, 3);
const price = decimal(9999999999.99, 2);
const product = z.object({ codigo: text(30), nombre: text(150), tipo: z.enum(['INSUMO', 'PLATO', 'PRODUCTO']), unidad: z.enum(['KG', 'UNIDAD', 'LITRO']), precio_venta: price, stock_minimo: stock }).strict();
const restaurantProduct = product.refine(p => p.tipo !== 'PLATO' || (p.unidad === 'UNIDAD' && p.stock_minimo === 0), 'Los platos usan UNIDAD y stock minimo 0; sus ingredientes se descuentan automáticamente según su receta.');
const recipe = z.object({ plato_id: id, insumo_id: id, cantidad: kg }).strict().refine(v => v.plato_id !== v.insumo_id, 'El plato y el insumo deben ser distintos.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Fecha invalida');
const listQuery = z.object({
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  producto_id: id.optional(), fecha_desde: date.optional(), fecha_hasta: date.optional(),
  tipo: z.enum(['ENTRADA', 'SALIDA', 'AJUSTE']).optional(), buscar: text(100).optional(),
}).strict().refine(v => !v.fecha_desde || !v.fecha_hasta || v.fecha_desde <= v.fecha_hasta, 'Rango de fechas invalido');

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
function databaseError(error) {
  if (error.code === '23505') return new ApiError(409, 'Ya existe un registro con ese codigo.');
  if (error.code === '23503') return new ApiError(400, 'La referencia indicada no existe.');
  if (error.code === '23514' || error.code === '22003' || error.code === '22001') return new ApiError(400, 'Los datos exceden los limites permitidos.');
  if (error.code === '42501') return new ApiError(403, 'No tienes permiso para esta operacion.');
  if (error.code === 'P0001') {
    const msg = error.message || 'Operacion rechazada';
    return new ApiError(/Sin permiso|propio acceso/.test(msg) ? 403 : /inexistente/.test(msg) ? 404 : /Stock insuficiente/.test(msg) ? 409 : 400, msg);
  }
  return new ApiError(502, 'No se pudo completar la consulta a Supabase. Intenta nuevamente.');
}
function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Datos invalidos.', result.error.issues.map(i => ({ campo: i.path.join('.'), mensaje: i.message })));
  return result.data;
}
function permit(...roles) {
  return (req, res, next) => roles.includes(req.profile.rol) ? next() : next(new ApiError(403, 'Tu rol no permite esta operacion.'));
}

export function createApp({ url, key, production = false, clientFactory } = {}) {
  if (!clientFactory && (!url || !key)) throw new Error('Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.');
  const client = clientFactory || (token => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  }));
  const app = express();
  if (production) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && (/^https?:\/\/localhost(?::\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin) || /^https:\/\/[^/]+\.vercel\.app$/.test(origin))) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': production ? [] : null } },
    strictTransportSecurity: production ? undefined : false,
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiadas solicitudes. Espera un minuto.' } }));
  app.get('/', (req, res) => res.redirect('/docs/'));
  app.get('/health', (req, res) => res.json({ estado: 'ok', servicio: 'Restaurante Solo Carnes API Wilfredo', version: '1.1.0' }));
  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    customSiteTitle: 'Solo Carnes | API y base de datos',
    customCss: '.swagger-ui .topbar {display:none}.swagger-ui .info hgroup.main h2 {color:#63252d}',
    swaggerOptions: { persistAuthorization: false, defaultModelsExpandDepth: 0, docExpansion: 'list', filter: true, displayRequestDuration: true },
  }));

  const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Intenta mas tarde.' } });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const data = validate(z.object({ email: z.email().max(254), password: z.string().min(1).max(1024) }).strict(), req.body);
    const { data: result, error } = await client().auth.signInWithPassword(data);
    if (error || !result?.session) throw new ApiError(401, 'Correo o contrasena incorrectos, o correo sin confirmar.');
    const sb = client(result.session.access_token);
    const { data: profile, error: pe } = await sb.from('usuarios').select('*').eq('usuario_id', result.user.id).maybeSingle();
    if (pe) throw databaseError(pe);
    if (!profile?.estado) throw new ApiError(403, 'Cuenta inactiva o sin perfil. Contacta al administrador.');
    res.set('Cache-Control', 'no-store').json({ access_token: result.session.access_token, token_type: 'Bearer', expires_in: result.session.expires_in, usuario: profile });
  });

  app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') || '');
    if (!match) throw new ApiError(401, 'Inicia sesion y envia Authorization: Bearer <access_token>.');
    req.sb = client(match[1]);
    const { data, error } = await req.sb.auth.getUser(match[1]);
    if (error || !data?.user) throw new ApiError(401, 'Token invalido o vencido. Inicia sesion nuevamente.');
    const { data: profile, error: pe } = await req.sb.from('usuarios').select('*').eq('usuario_id', data.user.id).maybeSingle();
    if (pe) throw databaseError(pe);
    if (!profile?.estado) throw new ApiError(403, 'Cuenta inactiva o sin perfil.');
    req.profile = profile;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ usuario: req.profile }));

  const list = (table, order, filterDates = false) => async (req, res) => {
    const args = validate(listQuery, req.query);
    let q = req.sb.from(table).select('*', { count: 'exact' }).order(order, { ascending: false });
    if (table !== 'usuarios' && args.producto_id) q = q.eq('producto_id', args.producto_id);
    if (table === 'productos' && args.buscar) q = q.ilike('nombre', `%${args.buscar.replace(/[\\%_]/g, '\\$&')}%`);
    if (table === 'movimientos_inventario' && args.tipo) q = q.eq('tipo_movimiento', args.tipo);
    if (filterDates && args.fecha_desde) q = q.gte('fecha', `${args.fecha_desde}T00:00:00-04:00`);
    if (filterDates && args.fecha_hasta) q = q.lte('fecha', `${args.fecha_hasta}T23:59:59.999999-04:00`);
    const { data, error, count } = await q.range((args.pagina - 1) * args.limite, args.pagina * args.limite - 1);
    if (error) throw databaseError(error);
    res.json({ datos: data, pagina: args.pagina, limite: args.limite, total: count });
  };
  app.get('/api/productos', list('productos', 'producto_id'));
  app.get('/api/productos/:id', async (req, res) => {
    const productId = validate(id, req.params.id);
    const { data, error } = await req.sb.from('productos').select('*').eq('producto_id', productId).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(404, 'Producto inexistente.');
    res.json({ datos: data });
  });
  app.post('/api/productos', permit('administrador', 'almacen'), async (req, res) => {
    const body = validate(restaurantProduct, req.body);
    const { data, error } = await req.sb.from('productos').insert(body).select('*').single();
    if (error) throw databaseError(error);
    res.status(201).json({ datos: data });
  });
  app.patch('/api/productos/:id', permit('administrador', 'almacen'), async (req, res) => {
    const productId = validate(id, req.params.id);
    const body = validate(product.partial().refine(v => Object.keys(v).length > 0, 'Indica al menos un campo'), req.body);
    const { data, error } = await req.sb.from('productos').update(body).eq('producto_id', productId).select('*').maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(404, 'Producto inexistente.');
    res.json({ datos: data });
  });
  app.get('/api/compras', permit('administrador', 'almacen'), list('compras', 'compra_id', true));
  app.post('/api/compras', permit('administrador', 'almacen'), async (req, res) => {
    const b = validate(z.object({ producto_id: id, cantidad: kg, costo_unitario: decimal(99999999.9999, 4), proveedor_nombre: text(150) }).strict(), req.body);
    const { data, error } = await req.sb.rpc('registrar_compra', { p_producto_id: b.producto_id, p_cantidad: b.cantidad, p_costo_unitario: b.costo_unitario, p_proveedor_nombre: b.proveedor_nombre });
    if (error) throw databaseError(error);
    res.status(201).json({ compra_id: data, mensaje: 'Compra, stock, costo promedio y Kardex registrados.' });
  });
  app.get('/api/recetas', permit('administrador', 'almacen', 'vendedor'), async (req, res) => {
    const platoId = req.query.plato_id ? validate(id, req.query.plato_id) : undefined;
    let query = req.sb.from('recetas_detalle').select('receta_id,plato_id,insumo_id,cantidad,plato:productos!recetas_detalle_plato_id_fkey(producto_id,nombre),insumo:productos!recetas_detalle_insumo_id_fkey(producto_id,nombre,unidad)').order('receta_id');
    if (platoId) query = query.eq('plato_id', platoId);
    const { data, error } = await query;
    if (error) throw databaseError(error);
    res.json({ datos: data });
  });
  app.post('/api/recetas', permit('administrador', 'almacen'), async (req, res) => {
    const body = validate(recipe, req.body);
    const { data, error } = await req.sb.from('recetas_detalle').insert(body).select('*').single();
    if (error) throw databaseError(error);
    res.status(201).json({ datos: data, mensaje: 'Ingrediente agregado a la receta.' });
  });
  app.delete('/api/recetas/:id', permit('administrador', 'almacen'), async (req, res) => {
    const recipeId = validate(id, req.params.id);
    const { error } = await req.sb.from('recetas_detalle').delete().eq('receta_id', recipeId);
    if (error) throw databaseError(error);
    res.status(204).end();
  });  app.get('/api/ventas', permit('administrador', 'vendedor'), list('ventas', 'venta_id', true));
  app.post('/api/ventas', permit('administrador', 'vendedor'), async (req, res) => {
    const b = validate(z.object({ producto_id: id, cantidad: kg, cliente_nombre: text(150).default('Consumidor final') }).strict(), req.body);
    const { data, error } = await req.sb.rpc('registrar_venta', { p_producto_id: b.producto_id, p_cantidad: b.cantidad, p_cliente_nombre: b.cliente_nombre });
    if (error) throw databaseError(error);
    res.status(201).json({ venta_id: data, mensaje: 'Venta registrada. Los ingredientes de la receta se descontaron automáticamente y quedaron registrados en Kardex.' });
  });
  app.get('/api/kardex', permit('administrador', 'almacen'), list('movimientos_inventario', 'movimiento_id', true));
  app.post('/api/ajustes', permit('administrador', 'almacen'), async (req, res) => {
    const b = validate(z.object({ producto_id: id, stock_nuevo: stock, motivo: text(500) }).strict(), req.body);
    const { data, error } = await req.sb.rpc('ajustar_inventario', { p_producto_id: b.producto_id, p_stock_nuevo: b.stock_nuevo, p_motivo: b.motivo });
    if (error) throw databaseError(error);
    res.status(201).json({ movimiento_id: data, mensaje: 'Ajuste e historial registrados.' });
  });
  app.post('/api/consumos', permit('administrador', 'almacen'), async (req, res) => {
    const b = validate(z.object({ producto_id: id, cantidad: kg, motivo: text(500) }).strict(), req.body);
    const { data, error } = await req.sb.rpc('registrar_consumo_insumo', { p_producto_id: b.producto_id, p_cantidad: b.cantidad, p_motivo: b.motivo });
    if (error) throw databaseError(error);
    res.status(201).json({ movimiento_id: data, mensaje: 'Consumo de cocina y salida de inventario registrados.' });
  });
  app.get('/api/usuarios', permit('administrador'), list('usuarios', 'usuario_id'));
  app.patch('/api/usuarios/:id', permit('administrador'), async (req, res) => {
    const userId = validate(z.uuid(), req.params.id);
    const b = validate(z.object({ nombre_completo: text(120), rol: z.enum(['administrador', 'vendedor', 'almacen']), estado: z.boolean() }).strict(), req.body);
    const { error } = await req.sb.rpc('gestionar_usuario', { p_usuario_id: userId, p_nombre: b.nombre_completo, p_rol: b.rol, p_estado: b.estado });
    if (error) throw databaseError(error);
    res.json({ mensaje: 'Perfil actualizado.' });
  });
  app.use((req, res) => res.status(404).json({ error: 'Ruta inexistente. Consulta /docs/.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Solicitud demasiado grande.' });
    const status = err instanceof ApiError ? err.status : 500;
    if (status === 500) console.error('Error interno de API:', err.name);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor.' : err.message, ...(err.details ? { detalles: err.details } : {}) });
  });
  return app;
}

