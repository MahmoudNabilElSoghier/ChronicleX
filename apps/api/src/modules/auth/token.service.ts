import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'node:fs';

export interface AccessPayload {
  sub: string;
  email: string;
  jti: string;
}

export interface RefreshPayload {
  sub: string;
  jti: string;
}

/** Parse "30s" | "15m" | "12h" | "7d" (or plain seconds) to seconds. */
export function parseTtlToSeconds(ttl: string, fallback: number): number {
  const m = /^(\d+)(s|m|h|d)?$/.exec(ttl.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  switch (m[2] ?? 's') {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return fallback;
  }
}

@Injectable()
export class TokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  readonly accessTtl: string;
  readonly refreshTtl: string;
  readonly refreshTtlSeconds: number;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    const privPath = config.getOrThrow<string>('JWT_PRIVATE_KEY_PATH');
    const pubPath = config.getOrThrow<string>('JWT_PUBLIC_KEY_PATH');
    try {
      this.privateKey = fs.readFileSync(privPath, 'utf8');
      this.publicKey = fs.readFileSync(pubPath, 'utf8');
    } catch {
      throw new Error(`TokenService: cannot read JWT keys at ${privPath} / ${pubPath}`);
    }
    if (!this.privateKey.includes('PRIVATE KEY') || !this.publicKey.includes('PUBLIC KEY')) {
      throw new Error('TokenService: JWT key files do not look like PEM keys');
    }
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtl = config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    this.refreshTtlSeconds = parseTtlToSeconds(this.refreshTtl, 7 * 24 * 3600);
  }

  signAccess(payload: AccessPayload): string {
    return this.jwt.sign(payload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      expiresIn: this.accessTtl,
    });
  }

  signRefresh(payload: RefreshPayload): string {
    return this.jwt.sign(payload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      expiresIn: this.refreshTtl,
    });
  }

  verify<T extends object>(token: string): T {
    return this.jwt.verify<T>(token, {
      algorithms: ['RS256'],
      publicKey: this.publicKey,
    });
  }
}
