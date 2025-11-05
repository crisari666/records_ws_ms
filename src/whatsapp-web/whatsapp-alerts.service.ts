import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WhatsAppAlert, WhatsAppAlertDocument } from './schemas/whatsapp-alert.schema';

@Injectable()
export class WhatsappAlertsService {
  private readonly logger = new Logger(WhatsappAlertsService.name);

  constructor(
    @InjectModel(WhatsAppAlert.name)
    private readonly alertModel: Model<WhatsAppAlertDocument>,
  ) {}

  async createDisconnectedAlert(sessionObjectId: Types.ObjectId, message?: string) {
    try {
      const alert = await this.alertModel.create({
        session: sessionObjectId,
        type: 'disconnected',
        message: message ?? 'WhatsApp session disconnected',
        isRead: false,
      });
      return alert;
    } catch (error) {
      this.logger.error('Failed to create disconnected alert', error as Error);
      throw error;
    }
  }

  async markAsRead(alertId: string) {
    const _id = new Types.ObjectId(alertId);
    return this.alertModel.findByIdAndUpdate(
      _id,
      { isRead: true, readAt: new Date() },
      { new: true },
    );
  }

  async listSessionAlerts(sessionObjectId: Types.ObjectId) {
    return this.alertModel.find({ session: sessionObjectId }).sort({ createdAt: -1 }).exec();
  }
}


