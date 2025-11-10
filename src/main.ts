import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.APP_PORT;
  
  app.setGlobalPrefix('ws-rest');
  
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: ['amqp://guest:guest@localhost:5672'],
      queue: 'whatsapp_events',
      queueOptions: {
        durable: true, // 👈 asegura persistencia
      },
    },
  });
  await app.startAllMicroservices();
  
  await app.listen(port);
  console.log(`🚀 WhatsApp Web Microservice is running on: http://localhost:${port}/rest`);
}
bootstrap();
