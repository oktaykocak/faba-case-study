import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { getRandomMockAdminId } from '@ecommerce/shared-types';

// Request interface'ini genişlet
declare global {
  namespace Express {
    interface Request {
      adminId?: string;
      customerId?: string;
    }
  }
}

@Injectable()
export class AdminMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // JWT token'dan admin ID çıkarılacak (şimdilik mock)
    // Gerçek uygulamada: JWT decode edilip admin ID alınacak

    // Authorization header kontrolü
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // JWT token var - decode edilecek (şimdilik mock admin ID)
      req.adminId = getRandomMockAdminId();
    } else {
      // JWT token yok - default mock admin ID
      req.adminId = getRandomMockAdminId();
    }

    next();
  }
}
