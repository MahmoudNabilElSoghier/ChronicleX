import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * CORS contract (requires Docker: Postgres + Redis + MinIO).
 * Run: pnpm --filter @chroniclex/api test:e2e
 * with CORS_ORIGINS=http://localhost:3000 in the environment.
 */
describe('CORS (e2e, needs Docker)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OPTIONS preflight from the app origin is allowed with credentials', async () => {
    const res = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('GET /health echoes the allowed origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('OPTIONS from an unknown origin gets no allow-origin header', async () => {
    const res = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://evil.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('POST with origin reaches the handler (401 business error, not a CORS block)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'nobody@tmg.local', password: 'WrongPass1' })
      .expect(401);
  });
});
