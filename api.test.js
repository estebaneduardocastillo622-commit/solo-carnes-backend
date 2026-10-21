import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

// Estos tokens y perfiles son ficticios y solo existen en estas pruebas.
const adminId = '11111111-1111-4111-8111-111111111111';
function fakeSupabase(options = {}) {
  const calls = [];
  const factory = token => {
    const rol = token === 'vendedor-test' ? 'vendedor' : 'administrador';
    const profile = { usuario_id: adminId, nombre_completo: 'Prueba', rol, estado: token !== 'inactivo-test' };
    return {
      auth: {
        getUser: async () => token === 'invalido-test' ? { data: null, error: {} } : { data: { user: { id: adminId } }, error: null },
        signInWithPassword: async () => ({ data: { user: { id: adminId }, session: { access_token: 'admin-test', expires_in: 3600 } }, error: null }),
      },
      from: table => {
        let payload;
        const q = {
          select: () => q, eq: () => q, order: () => q, ilike: () => q, gte: () => q, lte: () => q,
          insert: data => { payload = data; return q; }, update: data => { payload = data; return q; },
          range: async () => ({ data: table === 'usuarios' ? [profile] : [], count: table === 'usuarios' ? 1 : 0, error: null }),
          maybeSingle: async () => ({ data: table === 'usuarios' ? profile : { producto_id: 5, ...payload }, error: null }),
          single: async () => ({ data: { producto_id: 5, stock: 0, precio_compra: 0, ...payload }, error: null }),
        };
        return q;
      },
      rpc: async (name, args) => { calls.push({ name, args }); return options.rpcError ? { error: options.rpcError } : { data: 7, error: null }; },
    };
  };
  return { factory, calls };
}
async function setup(t, options) {
  const fake = fakeSupabase(options);
  const app = createApp({ clientFactory: fake.factory });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', token = 'admin-test', body, raw } = {}) => {
    const res = await fetch(url + path, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    return { status: res.status, headers: res.headers, data: await res.json() };
  };
  return { ...fake, request, url };
}

test('documentacion y salud publicas sin exponer credenciales', async t => {
  const { request, url } = await setup(t);
  assert.equal((await request('/health', { token: null })).status, 200);
  const spec = await request('/openapi.json', { token: null });
  assert.equal(spec.data.openapi, '3.0.3');
  assert.ok(spec.data.paths['/api/compras']);
  assert.ok(!JSON.stringify(spec.data).includes('sb_secret_'));
  const docs = await fetch(url + '/docs/');
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui/);
});
test('rechaza consultas sin sesion o con token invalido', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/productos', { token: null })).status, 401);
  assert.equal((await request('/api/productos', { token: 'invalido-test' })).status, 401);
});
test('una cuenta inactiva no accede aunque tenga token', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/productos', { token: 'inactivo-test' })).status, 403);
});
test('login entrega token sin almacenar contrasena en respuesta', async t => {
  const { request } = await setup(t);
  const r = await request('/api/auth/login', { method: 'POST', token: null, body: { email: 'prueba@example.com', password: 'solo-prueba' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.access_token, 'admin-test');
  assert.ok(!('password' in r.data));
  assert.match(r.headers.get('cache-control'), /no-store/);
});
test('el vendedor no compra ni administra perfiles', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('/api/compras', { token: 'vendedor-test', method: 'POST', body: { producto_id: 1, cantidad: 2, costo_unitario: 20, proveedor_nombre: 'Prueba' } })).status, 403);
  assert.equal((await request('/api/usuarios', { token: 'vendedor-test' })).status, 403);
  assert.equal(calls.length, 0);
});
test('no acepta escribir stock ni cambiar costo desde productos', async t => {
  const { request } = await setup(t);
  const base = { codigo: 'T-01', nombre: 'Prueba', precio_venta: 30, stock_minimo: 1 };
  assert.equal((await request('/api/productos', { method: 'POST', body: { ...base, stock: 900 } })).status, 400);
  assert.equal((await request('/api/productos/1', { method: 'PATCH', body: { precio_compra: 1 } })).status, 400);
});
test('compra valida llama la funcion transaccional correcta', async t => {
  const { request, calls } = await setup(t);
  const r = await request('/api/compras', { method: 'POST', body: { producto_id: 5, cantidad: 2.5, costo_unitario: 25.1234, proveedor_nombre: ' Proveedor prueba ' } });
  assert.equal(r.status, 201);
  assert.deepEqual(calls, [{ name: 'registrar_compra', args: { p_producto_id: 5, p_cantidad: 2.5, p_costo_unitario: 25.1234, p_proveedor_nombre: 'Proveedor prueba' } }]);
});
test('rechaza suplantar usuario o precio al vender', async t => {
  const { request, calls } = await setup(t);
  const b = { producto_id: 5, cantidad: 1 };
  assert.equal((await request('/api/ventas', { method: 'POST', body: { ...b, usuario_id: adminId } })).status, 400);
  assert.equal((await request('/api/ventas', { method: 'POST', body: { ...b, precio_unitario: 0 } })).status, 400);
  assert.equal(calls.length, 0);
});
test('stock insuficiente devuelve 409 y conserva mensaje de la base', async t => {
  const { request } = await setup(t, { rpcError: { code: 'P0001', message: 'Stock insuficiente: disponible 0 kg' } });
  const r = await request('/api/ventas', { method: 'POST', body: { producto_id: 5, cantidad: 1 } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Stock insuficiente/);
});
test('validacion rechaza cero y mas de tres decimales', async t => {
  const { request, calls } = await setup(t);
  for (const cantidad of [0, -1, 0.0001]) {
    assert.equal((await request('/api/ventas', { method: 'POST', body: { producto_id: 5, cantidad } })).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('ajuste requiere motivo y recibe stock final', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('/api/ajustes', { method: 'POST', body: { producto_id: 5, stock_nuevo: 2, motivo: ' ' } })).status, 400);
  assert.equal((await request('/api/ajustes', { method: 'POST', body: { producto_id: 5, stock_nuevo: 0, motivo: 'Conteo' } })).status, 201);
  assert.deepEqual(calls[0].args, { p_producto_id: 5, p_stock_nuevo: 0, p_motivo: 'Conteo' });
});
test('controla paginacion, fechas imposibles y JSON invalido', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/productos?limite=1000')).status, 400);
  assert.equal((await request('/api/kardex?fecha_desde=2026-02-30')).status, 400);
  assert.equal((await request('/api/kardex?fecha_desde=2026-10-20&fecha_hasta=2026-10-01')).status, 400);
  assert.equal((await request('/api/ventas', { method: 'POST', raw: '{mal json' })).status, 400);
});
test('un plato se crea por unidad y con stock minimo cero', async t => {
  const { request } = await setup(t);
  const plato = { codigo: 'P-01', nombre: 'Parrillada individual', tipo: 'PLATO', unidad: 'UNIDAD', precio_venta: 60, stock_minimo: 0 };
  assert.equal((await request('/api/productos', { method: 'POST', body: { ...plato, unidad: 'KG' } })).status, 400);
  assert.equal((await request('/api/productos', { method: 'POST', body: { ...plato, stock_minimo: 5 } })).status, 400);
  const result = await request('/api/productos', { method: 'POST', body: plato });
  assert.equal(result.status, 201);
  assert.equal(result.data.datos.tipo, 'PLATO');
  assert.equal(result.data.datos.unidad, 'UNIDAD');
});
test('consumo manual de cocina envia cantidad y motivo a su RPC', async t => {
  const { request, calls } = await setup(t);
  const consumo = { producto_id: 2, cantidad: 0.6, motivo: 'Carne utilizada en parrilladas' };
  assert.equal((await request('/api/consumos', { method: 'POST', token: 'vendedor-test', body: consumo })).status, 403);
  assert.equal((await request('/api/consumos', { method: 'POST', body: { ...consumo, motivo: ' ' } })).status, 400);
  assert.equal((await request('/api/consumos', { method: 'POST', body: consumo })).status, 201);
  assert.deepEqual(calls, [{ name: 'registrar_consumo_insumo', args: { p_producto_id: 2, p_cantidad: 0.6, p_motivo: 'Carne utilizada en parrilladas' } }]);
});
