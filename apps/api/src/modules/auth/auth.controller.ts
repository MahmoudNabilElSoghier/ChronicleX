import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, REFRESH_COOKIE } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { AccessPayload, TokenService } from './token.service';

function refreshCookieOptions(config: ConfigService, tokens: TokenService): CookieOptions {
  const domain = config.get<string>('COOKIE_DOMAIN') ?? 'localhost';
  const options: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    path: '/auth',
    maxAge: tokens.refreshTtlSeconds * 1000,
    secure: config.get<string>('COOKIE_SECURE') === 'true',
  };
  // Domain=localhost is rejected by browsers; only send Domain for real hosts.
  if (domain && domain !== 'localhost') {
    options.domain = domain;
  }
  return options;
}

function refreshClearOptions(config: ConfigService, tokens: TokenService): CookieOptions {
  const options = { ...refreshCookieOptions(config, tokens) };
  delete options.maxAge;
  return options;
}

function bearerToken(authHeader: string | undefined): string {
  const [scheme, token] = (authHeader ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException('Missing access token');
  }
  return token;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginThrottlerGuard)
  @Throttle({
    'login-account': { limit: 5, ttl: 900 },
    'login-ip': { limit: 20, ttl: 900 },
  })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: unknown }> {
    const result = await this.auth.login(dto.email, dto.password, ip, userAgent ?? null);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(this.config, this.tokens));
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    try {
      const result = await this.auth.refresh(
        req.cookies?.[REFRESH_COOKIE] as string | undefined ?? '',
        ip,
        userAgent ?? null,
      );
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(this.config, this.tokens));
      return { accessToken: result.accessToken };
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, refreshClearOptions(this.config, this.tokens));
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined, ip, userAgent ?? null);
    res.clearCookie(REFRESH_COOKIE, refreshClearOptions(this.config, this.tokens));
  }

  // No guard yet (Phase 4 replaces this inline check with @RequirePermission).
  @Get('me')
  async me(@Headers('authorization') authorization: string | undefined): Promise<unknown> {
    let payload: AccessPayload;
    try {
      payload = this.tokens.verify<AccessPayload>(bearerToken(authorization));
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    return this.auth.me(payload.sub);
  }
}
