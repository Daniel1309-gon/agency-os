import { Body, Controller, Get, Headers, Post, Req, Res, UsePipes } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { Authenticated, CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { loginSchema, passwordChangeSchema, passwordResetSchema, refreshSchema, type LoginInput, type PasswordChangeInput, type PasswordResetInput, type RefreshInput } from './auth.schemas.js';

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setRefreshCookie(reply: FastifyReply, token: string, maxAgeSeconds: number, secure: boolean): void {
  reply.header('set-cookie', `agency_refresh=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/api/v1/auth; HttpOnly${secure ? '; Secure' : ''}; SameSite=Strict`);
}

@Controller('auth')
@Authenticated()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Public()
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(body, req.ip, req.headers['user-agent']);
    setRefreshCookie(reply, result.refreshToken, 7 * 86_400, this.config.get('NODE_ENV') === 'production');
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  @Public()
  @Post('refresh')
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async refresh(@Body() body: RefreshInput, @Headers('cookie') cookie: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = body.refreshToken ?? cookieValue(cookie, 'agency_refresh');
    if (!token) throw new UnauthorizedException('Refresh token required');
    const result = await this.auth.refresh(token, req.ip, req.headers['user-agent']);
    setRefreshCookie(reply, result.refreshToken, 7 * 86_400, this.config.get('NODE_ENV') === 'production');
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  @Post('logout')
  async logout(@Headers('cookie') cookie: string | undefined, @Body() body: RefreshInput, @Res({ passthrough: true }) reply: FastifyReply): Promise<{ ok: true }> {
    const token = body?.refreshToken ?? cookieValue(cookie, 'agency_refresh');
    if (token) await this.auth.logout(token);
    setRefreshCookie(reply, '', 0, this.config.get('NODE_ENV') === 'production');
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.me(user.sub);
  }

  @Post('password')
  @UsePipes(new ZodValidationPipe(passwordChangeSchema))
  async changePassword(@CurrentUser() user: AccessTokenClaims, @Body() body: PasswordChangeInput): Promise<{ ok: true }> {
    await this.auth.changePassword(user.sub, body);
    return { ok: true };
  }

  @Post('password/reset')
  @RequirePermissions('users.update')
  @UsePipes(new ZodValidationPipe(passwordResetSchema))
  async resetPassword(@Body() body: PasswordResetInput): Promise<{ ok: true }> {
    await this.auth.resetPassword(body.userId, body);
    return { ok: true };
  }
}
