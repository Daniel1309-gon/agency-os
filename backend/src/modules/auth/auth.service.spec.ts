import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

describe('AuthService rate-limit dependency', () => {
  it('fails closed when Redis cannot enforce a login limit', async () => {
    const auth = new AuthService(
      {} as never,
      { get: vi.fn((key: string) => key === 'PASSWORD_SCRYPT_LOG2N' ? 14 : false) } as never,
      { incrWithExpiry: vi.fn().mockRejectedValue(new Error('redis unavailable')) } as never,
      {} as never,
      {} as never,
    );

    await expect(auth.login({ email: 'operator@agency.test', password: 'long-enough-password' }, '203.0.113.10'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
