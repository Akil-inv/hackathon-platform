import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './global-exception.filter';
import { LoggingInterceptor } from './logging.interceptor';
import { TimeoutInterceptor } from './timeout.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  app.enableCors({ origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
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
