import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { from, type Observable } from 'rxjs';
import { DatabaseService } from '../../database/database.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) return next.handle();
    return from(this.db.withRequestContext(request.user.sub, request.user.role, async () => next.handle().toPromise()));
  }
}
