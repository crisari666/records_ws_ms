import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class RabbitService {
  constructor(@Inject('RECORDS_AI_CHATS_ANALYSIS_SERVICE') private client: ClientProxy) {}

  // Send event to MS2
  emitToMs2(pattern: string, data: any) {
    return this.client.emit(pattern, data); // fire and forget
  }

  async sendToMs2(pattern: string, data: any) {
    return this.client.send(pattern, data); // request-response
  }
}