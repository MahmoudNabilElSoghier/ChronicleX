import { Injectable } from '@nestjs/common';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Client as PgClient } from 'pg';
import Redis from 'ioredis';

type DepStatus = 'up' | 'down';

@Injectable()
export class HealthService {
  private withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    );
    return Promise.race([promise, timer]);
  }

  private async checkPostgres(): Promise<DepStatus> {
    const url = process.env.DATABASE_URL;
    if (!url) return 'down';
    const client = new PgClient({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await this.withTimeout(client.query('SELECT 1'));
      return 'up';
    } catch {
      return 'down';
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async checkRedis(): Promise<DepStatus> {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const redis = new Redis(url, { lazyConnect: true, enableReadyCheck: false });
    try {
      await this.withTimeout(redis.ping());
      return 'up';
    } catch {
      return 'down';
    } finally {
      redis.disconnect();
    }
  }

  private async checkMinio(): Promise<DepStatus> {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
    const accessKeyId = process.env.MINIO_ACCESS_KEY ?? '';
    const secretAccessKey = process.env.MINIO_SECRET_KEY ?? '';
    if (!accessKeyId || !secretAccessKey) return 'down';
    const s3 = new S3Client({
      endpoint,
      region: process.env.MINIO_REGION ?? 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    try {
      await this.withTimeout(
        s3.send(new HeadBucketCommand({ Bucket: process.env.MINIO_BUCKET ?? 'chroniclex-archive' })),
      );
      return 'up';
    } catch {
      return 'down';
    } finally {
      s3.destroy();
    }
  }

  async checkDependencies(): Promise<Record<'postgres' | 'redis' | 'minio', DepStatus>> {
    const [postgres, redis, minio] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
    ]);
    return { postgres, redis, minio };
  }
}
