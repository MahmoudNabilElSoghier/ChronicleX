import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EntriesModule } from './modules/entries/entries.module';
import { RBACModule } from './modules/rbac/rbac.module';
import { QueueModule } from './modules/queue/queue.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60, limit: 100 },
      { name: 'login-account', ttl: 900, limit: 5 },
      { name: 'login-ip', ttl: 900, limit: 20 },
      { name: 'bulk-upload', ttl: 900, limit: 5 },
    ]),
    QueueModule.forRoot(),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    RBACModule,
    StorageModule,
    AuditModule,
    EntriesModule,
    UsersModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // Global interceptors run in registration order. AuditInterceptor is the
    // only global interceptor; future ones must document ordering here.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
