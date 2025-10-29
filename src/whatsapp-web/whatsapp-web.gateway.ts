import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/whatsapp',
})
export class WhatsappWebGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WhatsappWebGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitQrCode(sessionId: string, qr: string) {
    this.server.emit('qr', { sessionId, qr });
    this.logger.log(`QR code emitted for session ${sessionId}`);
  }

  emitReady(sessionId: string) {
    this.server.emit('ready', { sessionId });
    this.logger.log(`Ready event emitted for session ${sessionId}`);
  }

  emitAuthFailure(sessionId: string, error: any) {
    this.server.emit('auth_failure', { sessionId, error: error.message || error });
    this.logger.log(`Auth failure emitted for session ${sessionId}`);
  }

  emitSessionClosed(sessionId: string, chatId?: string) {
    this.server.emit('sessionClosed', { sessionId, chatId });
    this.logger.log(`Session closed emitted for session ${sessionId}${chatId ? `, chat ${chatId}` : ''}`);
  }
}

