import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './global-exception.filter';
import { LoggingInterceptor } from './logging.interceptor';
import { TimeoutInterceptor } from './timeout.interceptor';
import { createValidationPipe } from './validation.pipe';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global pipes, filters, interceptors
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TimeoutInterceptor(30000), // 30s default timeout
  );

  // Graceful shutdown
  app.enableShutdownHooks();

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`, error.stack);
  });

  process.on('unhandledRejection', (reason: any) => {
    logger.error(`Unhandled rejection: ${reason?.message || reason}`, reason?.stack);
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/graphql`);
  logger.log(`Health check: http://localhost:${port}/health`);
}

bootstrap();
