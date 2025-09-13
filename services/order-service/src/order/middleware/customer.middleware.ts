import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { getRandomMockCustomerId } from '@ecommerce/shared-types';

// Request interface'ini genişlet
declare global {
  namespace Express {
    interface Request {
      customerId?: string;
      adminId?: string;
    }
  }
}

@Injectable()
export class CustomerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // JWT token'dan customer ID çıkarılacak (şimdilik mock)
    // Gerçek uygulamada: JWT decode edilip customer ID alınacak

    // Authorization header kontrolü
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // JWT token var - decode edilecek (şimdilik mock customer ID)
      req.customerId = getRandomMockCustomerId();
    } else {
      // JWT token yok - default mock customer ID
      req.customerId = getRandomMockCustomerId();
    }

    // Admin ID için de benzer mantık (gelecekte)
    // req.adminId = extractAdminIdFromToken(token);

    next();
  }
}
