import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const app = createApp({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  production: process.env.NODE_ENV === 'production',
});
const server = app.listen(port, host, () => console.log(`Solo Carnes API lista en el puerto ${port}. Swagger: /docs`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
