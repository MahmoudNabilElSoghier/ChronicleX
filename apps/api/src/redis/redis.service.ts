import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', () => {
      // Connection failures surface per-command; never crash the process.
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'ready') return;
    await this.client.connect().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.ensureConnected();
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(key);
  }

  async deleteByPattern(pattern: string): Promise<number> {
    await this.ensureConnected();
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }

  async hset(key: string, fields: Record<string, string | number>): Promise<void> {
    await this.ensureConnected();
    await this.client.hset(key, fields as Record<string, string>);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    await this.ensureConnected();
    return this.client.hgetall(key);
  }

  /** Atomic increment. Returns the new value — use it for last-writer decisions. */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    await this.ensureConnected();
    return this.client.hincrby(key, field, increment);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.ensureConnected();
    await this.client.expire(key, ttlSeconds);
  }

  async rpush(key: string, value: string): Promise<void> {
    await this.ensureConnected();
    await this.client.rpush(key, value);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    await this.ensureConnected();
    return this.client.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    await this.ensureConnected();
    return this.client.llen(key);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connect') {
      this.client.disconnect();
    }
  }
}
