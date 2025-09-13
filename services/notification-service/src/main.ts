import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRmqOptionsWithDLQ } from './events/rmq-options.helper';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Setup global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Setup RabbitMQ microservice
  const microservice = app.connectMicroservice<MicroserviceOptions>(
    getRmqOptionsWithDLQ('notification_queue', 3),
  );

  await app.startAllMicroservices();

  const port = configService.get<number>('PORT', 3003);
  await app.listen(port);

  console.log(`Notification Service is running on port ${port}`);
}

bootstrap().catch(console.error);
