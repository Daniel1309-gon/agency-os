import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/api-client';
import { sessionRestoreDisposition } from './AuthProvider';

describe('session restore', () => {
  it('returns to login only when the server confirms the session is invalid', () => {
    expect(sessionRestoreDisposition(new ApiError(401, { code: 'UNAUTHENTICATED', message: 'expired' }))).toBe('anonymous');
  });

  it('keeps the session recoverable for server failures', () => {
    expect(sessionRestoreDisposition(new ApiError(500, { code: 'INTERNAL_ERROR', message: 'temporary failure' }))).toBe('recoverable');
  });

  it('keeps the session recoverable when the network fails', () => {
    expect(sessionRestoreDisposition(new Error('network unavailable'))).toBe('recoverable');
  });
});
