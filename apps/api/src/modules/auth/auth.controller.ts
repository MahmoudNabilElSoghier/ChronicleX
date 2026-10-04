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
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, REFRESH_COOKIE } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { TokenService } from './token.service';
import type { AuthenticatedUser } from './types';

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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Public()
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

  @Public()
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

  @Public()
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

  // Protected by the global AuthGuard; permission checks arrive in Phase 5+ routes.
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.auth.me(user.id);
  }
}
