import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';

describe('login throttling (in-memory storage, no Docker)', () => {
  const authService = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
      user: { id: 'u1', email: 'a@b.c', nameAr: 'ن', nameEn: 'N' },
    }),
  };
  const tokens = { refreshTtlSeconds: 604800 };
  const config = {
    get: (key: string): string | undefined =>
      key === 'COOKIE_SECURE' ? 'false' : key === 'COOKIE_DOMAIN' ? 'localhost' : undefined,
  };

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60, limit: 100 },
          { name: 'login-account', ttl: 900, limit: 5 },
          { name: 'login-ip', ttl: 900, limit: 20 },
        ]),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokens },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('6 attempts same (IP, email) → 429 on the 6th', async () => {
    const app = await boot();
    try {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'a@b.c', password: 'Password123' })
          .expect(200);
      }
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'a@b.c', password: 'Password123' })
        .expect(429);
    } finally {
      await app.close();
    }
  });

  it('21 attempts same IP across different emails → 429 on the 21st', async () => {
    const app = await boot();
    try {
      for (let i = 0; i < 20; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: `user${i}@b.c`, password: 'Password123' })
          .expect(200);
      }
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user20@b.c', password: 'Password123' })
        .expect(429);
    } finally {
      await app.close();
    }
  });
});
