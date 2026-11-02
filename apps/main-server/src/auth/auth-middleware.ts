import { Request, Response, NextFunction } from 'express';
import { AuthService, PublisherPayload } from './auth-service.js';

export interface AuthenticatedRequest extends Request {
  publisher?: PublisherPayload;
}

export function createAuthMiddleware(authService: AuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    try {
      req.publisher = authService.verifyToken(token);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  };
}
