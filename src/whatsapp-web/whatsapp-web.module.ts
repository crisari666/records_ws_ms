import { Module } from '@nestjs/common';
import { WhatsappWebService } from './whatsapp-web.service';
import { WhatsappWebController } from './whatsapp-web.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsAppSession, WhatsAppSessionSchema } from './schemas/whatsapp-session.schema';
import { WhatsAppMessage, WhatsAppMessageSchema } from './schemas/whatsapp-message.schema';
import { WhatsAppChat, WhatsAppChatSchema } from './schemas/whatsapp-chat.schema';
import { WhatsappStorageService } from './whatsapp-storage.service';
import { WhatsappWebGateway } from './whatsapp-web.gateway';
import { WhatsAppAlert, WhatsAppAlertSchema } from './schemas/whatsapp-alert.schema';
import { WhatsappAlertsService } from './whatsapp-alerts.service';
import { RabbitService } from 'src/rabbit.service';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        { name: WhatsAppSession.name, schema: WhatsAppSessionSchema },
        { name: WhatsAppMessage.name, schema: WhatsAppMessageSchema },
        { name: WhatsAppChat.name, schema: WhatsAppChatSchema },
        { name: WhatsAppAlert.name, schema: WhatsAppAlertSchema },
      ]
    ),
    ClientsModule.register([
      {
        name: 'RECORDS_AI_CHATS_ANALYSIS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: ['amqp://guest:guest@localhost:5672'],
          queue: 'records_ai_chats_analysis_events', // where MS2 is listening
          queueOptions: { durable: true },
        },
      },
    ]),
  ],
  controllers: [WhatsappWebController],
  providers: [WhatsappWebService, WhatsappStorageService, WhatsappWebGateway, WhatsappAlertsService, RabbitService],
  exports: [WhatsappWebService, WhatsappStorageService, WhatsappAlertsService],
})
export class WhatsappWebModule {}

