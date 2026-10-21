import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { VoiceGateway } from './voice/voice.gateway';

async function bootstrap() {
  // rawBody: the Stripe webhook verifies its signature over the exact bytes sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // One proxy hop (nginx) in production, so `req.ip` is the client, not 127.0.0.1.
  app.set('trust proxy', 1);
  app.enableCors({ origin: true, credentials: true });

  // Every route lives under /api, so the Vite dev proxy and nginx can forward /api
  // untouched — the same convention as the internal app.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // step12: SignalWire streams AI phone calls to /api/voice/stream (WebSocket upgrade).
  app.get(VoiceGateway).attach(app.getHttpServer());

  // 3001, not 3000: the internal API owns 3000 on dev machines and on the host.
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Customer API running on http://localhost:${port}/api`);
}
void bootstrap();
