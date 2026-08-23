import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { ConfigService } from '../../config/config.service.js';

describe('AuthController refresh cookie', () => {
  it('revokes and clears the HttpOnly cookie on logout in development', async () => {
    const auth = { logout: vi.fn(async () => undefined) } as unknown as AuthService;
    const config = { get: vi.fn(() => 'development') } as unknown as ConfigService;
    const reply = { header: vi.fn() };
    const controller = new AuthController(auth, config);

    await controller.logout('agency_refresh=refresh-token', {}, reply as never);

    expect(auth.logout).toHaveBeenCalledWith('refresh-token');
    expect(reply.header).toHaveBeenCalledWith('set-cookie', expect.stringContaining('Max-Age=0'));
    expect(reply.header.mock.calls[0][1]).toContain('HttpOnly');
    expect(reply.header.mock.calls[0][1]).not.toContain('; Secure');
  });

  it('uses the configured TTL and secure cookie attributes in production', async () => {
    const header = vi.fn();
    const controller = new AuthController(
      { login: vi.fn().mockResolvedValue({ refreshToken: 'refresh-token-value', accessToken: 'access', expiresIn: 900, user: {} }) } as never,
      { get: vi.fn((key: string) => key === 'JWT_REFRESH_TTL_DAYS' ? 3 : 'production') } as never,
    );

    await controller.login(
      { email: 'operator@agency.test', password: 'a-long-enough-password' },
      { ip: '203.0.113.10', headers: { 'user-agent': 'vitest' } } as never,
      { header } as never,
    );

    expect(header).toHaveBeenCalledWith(
      'set-cookie',
      'agency_refresh=refresh-token-value; Max-Age=259200; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });
});
