import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WhatsAppSession } from './whatsapp-session.schema';

export type WhatsAppAlertDocument = WhatsAppAlert & Document;

@Schema({ timestamps: true })
export class WhatsAppAlert {
  @Prop({ type: Types.ObjectId, ref: WhatsAppSession.name, required: true })
  session: Types.ObjectId;

  // Type of alert (currently supporting 'disconnected')
  @Prop({ type: String, enum: ['disconnected'], required: true })
  type: string;

  // Optional human-readable message for clients
  @Prop({ type: String, required: false })
  message?: string;

  // Whether the alert has been read by a client
  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  // Timestamp when it was read
  @Prop({ type: Date, required: false })
  readAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WhatsAppAlertSchema = SchemaFactory.createForClass(WhatsAppAlert);


