import express, { Express } from 'express';
import cors from 'cors';
import { IDatabase } from './db/interface.js';
import { AuthService } from './auth/auth-service.js';
import { createSoftwareRouter } from './controllers/software.controller.js';

export function createApp(db: IDatabase): Express {
  const app = express();
  const authService = new AuthService(db);

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Root status
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'DeSUDN Main Server', timestamp: new Date().toISOString() });
  });

  // Software & versions API
  app.use('/api', createSoftwareRouter(db, authService));

  return app;
}
