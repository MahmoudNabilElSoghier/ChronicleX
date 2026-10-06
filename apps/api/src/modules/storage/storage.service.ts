import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import type { Readable } from 'node:stream';

export interface ObjectRange {
  start: number;
  end?: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: Minio.Client;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = new URL(config.getOrThrow<string>('MINIO_ENDPOINT'));
    this.client = new Minio.Client({
      endPoint: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 80,
      useSSL: endpoint.protocol === 'https:',
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      region: config.get<string>('MINIO_REGION') ?? 'us-east-1',
    });
    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'chroniclex-archive';
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
  }

  async getObjectStream(key: string, range?: ObjectRange): Promise<Readable> {
    // Full fetches use getObject. getPartialObject with an undefined length
    // behaves inconsistently across S3-compatible backends (MinIO, AWS,
    // Backblaze B2) and can return a truncated stream. Range requests
    // (byte ranges) must use getPartialObject with explicit start/end.
    if (range === undefined) {
      return (await this.client.getObject(this.bucket, key)) as unknown as Readable;
    }
    if (range.end === undefined) {
      throw new Error('getObjectStream: range requests require explicit start and end');
    }
    const stream = (await this.client.getPartialObject(
      this.bucket,
      key,
      range.start,
      range.end - range.start + 1,
    )) as unknown as Readable;
    return stream;
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = (await this.client.getObject(this.bucket, key)) as unknown as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }

  async statObject(key: string): Promise<{ size: number; contentType: string; etag: string }> {
    const stat = await this.client.statObject(this.bucket, key);
    return {
      size: stat.size,
      contentType: (stat.metaData?.['content-type'] as string | undefined) ?? 'application/pdf',
      etag: stat.etag,
    };
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async getPresignedUrl(key: string, expirySeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }
}
