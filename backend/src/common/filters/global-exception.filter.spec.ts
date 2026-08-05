import { describe, expect, it, vi } from 'vitest';
import {
  type ArgumentsHost,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import type { LoggerService } from '../logger/logger.service.js';

interface Captured {
  status: number;
  body: { error: { code: string; message: string; requestId?: string; details?: Record<string, unknown> } };
}

function hostWith(requestId = 'req-1'): { host: ArgumentsHost; captured: Captured } {
  const captured = { status: 0, body: { error: { code: '', message: '' } } } as Captured;
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    send(body: Captured['body']) {
      captured.body = body;
    },
    request: { id: requestId },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ id: requestId }) }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

function filterWith() {
  const logger = { error: vi.fn() } as unknown as LoggerService;
  return { filter: new GlobalExceptionFilter(logger), logger };
}

describe('GlobalExceptionFilter', () => {
  it('maps each HTTP status to its documented error code', () => {
    const cases: Array<[HttpException, number, string]> = [
      [new UnauthorizedException('nope'), 401, 'UNAUTHENTICATED'],
      [new ForbiddenException('nope'), 403, 'FORBIDDEN'],
      [new NotFoundException('nope'), 404, 'NOT_FOUND'],
      [new ConflictException('nope'), 409, 'CONFLICT'],
      [new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), 429, 'RATE_LIMITED'],
    ];
    for (const [exception, status, code] of cases) {
      const { filter } = filterWith();
      const { host, captured } = hostWith();
      filter.catch(exception, host);
      expect(captured.status).toBe(status);
      expect(captured.body.error.code).toBe(code);
    }
  });

  it('never leaks an internal error message or stack to the client', () => {
    const { filter, logger } = filterWith();
    const { host, captured } = hostWith('req-leak');
    filter.catch(new Error('connection to postgres://agency:hunter2@db failed'), host);

    expect(captured.status).toBe(500);
    expect(captured.body.error.code).toBe('INTERNAL_ERROR');
    expect(captured.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    // El detalle si tiene que quedar en el log del servidor, con el requestId
    // que lo correlaciona con la peticion.
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled exception',
      expect.objectContaining({ err: expect.stringContaining('hunter2'), requestId: 'req-leak' }),
    );
  });

  it('answers a thrown non-Error without crashing the filter', () => {
    const { filter } = filterWith();
    const { host, captured } = hostWith();
    filter.catch('a bare string', host);
    expect(captured.status).toBe(500);
    expect(captured.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('carries the requestId into every response body', () => {
    const { filter } = filterWith();
    const { host, captured } = hostWith('req-abc');
    filter.catch(new ConflictException('duplicate'), host);
    expect(captured.body.error.requestId).toBe('req-abc');
  });
});
