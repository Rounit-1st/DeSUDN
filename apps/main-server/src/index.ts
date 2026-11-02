import dotenv from 'dotenv';
import { getDatabase } from './db/index.js';
import { createApp } from './app.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  const db = await getDatabase();
  const app = createApp(db);

  const server = app.listen(PORT, HOST, () => {
    console.log(`[MainServer] DeSUDN Metadata Server listening on http://${HOST}:${PORT}`);
  });

  process.on('SIGTERM', async () => {
    console.log('[MainServer] Shutting down gracefully...');
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}

bootstrap().catch((err) => {
  console.error('[MainServer] Startup failed:', err);
  process.exit(1);
});
