import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}
// eslint-disable-next-line no-console
bootstrap().catch((err) => console.error(err));
