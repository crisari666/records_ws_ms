import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WhatsAppSessionDocument = WhatsAppSession & Document;

@Schema({ timestamps: true })
export class WhatsAppSession {
  // A unique ID for this session (e.g., 'user-1', 'sales-team', etc.)
  @Prop({ required: true, unique: true })
  sessionId: string;

  // The session data object provided by 'whatsapp-web.js' (stored by MongoStore)
  @Prop({ type: Object, required: false })
  sessionData?: any;

  // Current status of the session
  @Prop({ 
    type: String, 
    enum: [
      'initializing', 
      'qr_generated', 
      'authenticated', 
      'ready', 
      'disconnected', 
      'closed',
      'auth_failure', 
      'error'
    ],
    default: 'initializing'
  })
  status: string;

  // Last time the session was active/seen
  @Prop({ type: Date, default: Date.now })
  lastSeen: Date;

  // Timestamps (automatically added by Mongoose with { timestamps: true })
  createdAt?: Date;
  updatedAt?: Date;
}

export const WhatsAppSessionSchema = SchemaFactory.createForClass(WhatsAppSession);

