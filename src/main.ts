import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.APP_PORT;
  
  app.setGlobalPrefix('ws-rest');
  
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  
  await app.listen(port);
  console.log(`🚀 WhatsApp Web Microservice is running on: http://localhost:${port}/rest`);
}
bootstrap();
