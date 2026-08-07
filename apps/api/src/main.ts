import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './global-exception.filter';
import { LoggingInterceptor } from './logging.interceptor';
import { TimeoutInterceptor } from './timeout.interceptor';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  /**
   * Security headers.
   *
   * Content-Security-Policy is off deliberately. The judge portal is Next.js
   * with inline styles, and a policy tuned by guesswork would break it somewhere
   * nobody notices until a judge does. The headers that matter here — framing,
   * MIME sniffing, transport — are all on.
   */
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  /**
   * CORS.
   *
   * `origin: true` reflects whatever Origin arrives, and with `credentials: true`
   * that means any site a logged-in coordinator visits can call this API as
   * them. An allow-list closes it.
   *
   * Unset, it falls back to the old behaviour rather than refusing to start —
   * an event three weeks away must not go down because a variable was missed —
   * but it says so on every boot.
   */
  const allowed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    logger.warn(
      'CORS_ORIGINS is not set — any origin may call this API with credentials. ' +
      'Set it to a comma-separated list of the sites that should be allowed.',
    );
  }

  app.enableCors({
    origin: allowed.length > 0 ? allowed : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TimeoutInterceptor(30000));
  app.enableShutdownHooks();

  process.on('uncaughtException', (error) => { logger.error(`Uncaught exception: ${error.message}`, error.stack); });
  process.on('unhandledRejection', (reason: any) => { logger.error(`Unhandled rejection: ${reason?.message || reason}`, reason?.stack); });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/graphql`);
  logger.log(`Health check: http://localhost:${port}/health`);
}
bootstrap();
