import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { RBACModule } from './modules/rbac/rbac.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60, limit: 100 },
      { name: 'login-account', ttl: 900, limit: 5 },
      { name: 'login-ip', ttl: 900, limit: 20 },
    ]),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    RBACModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
