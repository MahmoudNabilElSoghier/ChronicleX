import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

function redisConnection(url: string): {
  host: string;
  port: number;
  password?: string;
  db?: number;
} {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:') {
    throw new Error(`QueueModule: unsupported Redis protocol ${parsed.protocol}`);
  }
  const out: { host: string; port: number; password?: string; db?: number } = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };
  if (parsed.password) out.password = decodeURIComponent(parsed.password);
  const db = parsed.pathname.replace('/', '');
  if (db !== '') out.db = Number(db);
  return out;
}

@Global()
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: redisConnection(config.getOrThrow<string>('REDIS_URL')),
          }),
        }),
      ],
      exports: [BullModule],
    };
  }
}
