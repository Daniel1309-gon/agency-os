import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { ConfigService } from '../../config/config.service.js';

describe('AuthController refresh cookie lifecycle', () => {
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
});
