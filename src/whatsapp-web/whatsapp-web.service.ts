// src/whatsapp-web/whatsapp-web.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import * as mongoose from 'mongoose';
import * as qrcode from 'qrcode-terminal';
import * as puppeteer from 'puppeteer';
import { WhatsAppSession, WhatsAppSessionDocument } from './schemas/whatsapp-session.schema';
import { WhatsAppMessage, WhatsAppMessageDocument } from './schemas/whatsapp-message.schema';
import { WhatsappStorageService } from './whatsapp-storage.service';
import { WhatsappWebGateway } from './whatsapp-web.gateway';
import * as path from 'path';

@Injectable()
export class WhatsappWebService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappWebService.name);
  private readonly sessionPath = path.join(process.cwd(), '.wwebjs_auth');
  private sessions: Map<string, { client: Client; isReady: boolean; lastRestore?: Date }> = new Map();
  private isInitializing = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(WhatsAppSession.name) private whatsAppSessionModel: mongoose.Model<WhatsAppSessionDocument>,
    @InjectModel(WhatsAppMessage.name) private whatsAppMessageModel: mongoose.Model<WhatsAppMessageDocument>,
    private readonly configService: ConfigService,
    private readonly storageService: WhatsappStorageService,
    private readonly gateway: WhatsappWebGateway,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing WhatsApp Web Service...');
    await this.initializeStoredSessions();
  }

  /**
   * Initialize stored sessions from local storage
   * Queries database for sessions with 'ready' or 'authenticated' status
   */
  private async initializeStoredSessions() {
    if (this.isInitializing) {
      this.logger.warn('Session initialization already in progress');
      return;
    }

    this.isInitializing = true;
    
    try {
      // Wait for MongoDB connection to be ready
      await this.connection.readyState;
      
      // Query for sessions with ready or authenticated status
      const documents = await this.whatsAppSessionModel.find({
        status: { $in: ['ready', 'authenticated'] }
      }).exec();
      
      this.logger.log(`📱 Found ${documents.length} ready/authenticated sessions in database`);
      
      if (documents.length === 0) {
        this.logger.log('No ready/authenticated sessions to restore');
        return;
      }

      // Extract unique session IDs from the documents
      const sessionIds = [...new Set(documents.map(doc => doc.sessionId))];
      
      for (const sessionId of sessionIds) {
        // Check if session is already active
        if (this.sessions.has(sessionId)) {
          this.logger.log(`Session ${sessionId} is already active, skipping...`);
          continue;
        }

        try {
          this.logger.log(`🔄 Attempting to restore session: ${sessionId}`);
          await this.createSession(sessionId);
          this.logger.log(`✅ Session ${sessionId} restored successfully`);
        } catch (error) {
          this.logger.error(`❌ Failed to restore session ${sessionId}:`, error.message);
        }
      }
      
      this.logger.log(`📊 Total active sessions: ${this.sessions.size}`);
    } catch (error) {
      this.logger.error('Error initializing stored sessions:', error);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Store session metadata in MongoDB
   */
  private async storeSessionMetadata(sessionId: string, metadata: { status: string; lastSeen: Date }) {
    try {
      await this.whatsAppSessionModel.updateOne(
        { sessionId: sessionId },
        { 
          $set: {
            sessionId: sessionId,
            ...metadata,
          }
        },
        { upsert: true }
      );
    } catch (error) {
      this.logger.error(`Error storing session metadata for ${sessionId}:`, error);
    }
  }


  /**
   * Setup event listeners for WhatsApp client
   */
  private setupClientListeners(client: Client, sessionId: string) {
    client.on('qr', async (qr) => {
      this.logger.log(`📱 QR received for session ${sessionId}`);
      qrcode.generate(qr, { small: true, width: 100, height: 100 });
      
      await this.storeSessionMetadata(sessionId, { 
        status: 'qr_generated', 
        lastSeen: new Date() 
      });
      
      this.emitQrEvent(sessionId, qr);
    });

    client.on('ready', async () => {
      this.logger.log(`✅ Session ${sessionId} is ready!`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.isReady = true;
      }
      await this.storeSessionMetadata(sessionId, { 
        status: 'ready', 
        lastSeen: new Date() 
      });
      
      this.emitReadyEvent(sessionId);
    });

    client.on('authenticated', async () => {
      this.logger.log(`🔐 Session ${sessionId} authenticated`);
      await this.storeSessionMetadata(sessionId, { 
        status: 'authenticated', 
        lastSeen: new Date() 
      });
    });

    client.on('auth_failure', async (error) => {
      this.logger.error(`❌ Session ${sessionId} authentication failed:`, error);
      await this.storeSessionMetadata(sessionId, { 
        status: 'auth_failure', 
        lastSeen: new Date() 
      });
      this.emitAuthFailureEvent(sessionId, error);
    });
    
    client.on('message_create', async (message) => {
      try {
        this.logger.log(`📤 Message received in session ${sessionId}: ${message.body?.substring(0, 50) || 'media message'}`);
        console.log('message', message);
        
        await this.storageService.saveMessage(sessionId, message);
      } catch (error) {
        this.logger.error(`Error handling message_create: ${error.message}`);
      }
    });

    client.on('chat_removed', async (chat) => {
      try {
        this.logger.log(`🗑️ Chat removed in session ${sessionId}: ${chat.id._serialized}`);
        await this.storageService.markChatAsDeleted(sessionId, chat.id._serialized);
      } catch (error) {
        this.logger.error(`Error handling chat_removed: ${error.message}`);
      }
    });



    client.on('disconnected', async (reason) => {
      this.logger.warn(`⚠️ Session ${sessionId} disconnected: ${reason}`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.isReady = false;
      }
      
      await this.storeSessionMetadata(sessionId, { 
        status: 'disconnected', 
        lastSeen: new Date() 
      });
      
      // Auto-reconnect after 5 seconds
      setTimeout(async () => {
        this.logger.log(`🔄 Attempting to reconnect session ${sessionId}`);
        this.sessions.delete(sessionId);
        await this.createSession(sessionId);
      }, 5000);
    });

    client.on('message_revoke_me', async (message) => {
      try {
        this.logger.log(`🗑️ Message revoked (me) in session ${sessionId}: ${message.body?.substring(0, 50) || 'media message'}`);
        await this.storageService.markMessageAsDeleted(sessionId, message.id._serialized, 'me');
      } catch (error) {
        this.logger.error(`Error handling message_revoke_me: ${error.message}`);
      }
    });

    client.on('message_revoke_everyone', async (message, revokedMsg) => {
      try {
        this.logger.log(`🗑️ Message revoked (everyone) in session ${sessionId}: ${message.body?.substring(0, 50) || 'media message'}`);
        
        // If we have the revoked message, save it first
        if (revokedMsg) {
          await this.storageService.saveMessage(sessionId, revokedMsg);
        }
        
        await this.storageService.markMessageAsDeleted(sessionId, message.id._serialized, 'everyone');
      } catch (error) {
        this.logger.error(`Error handling message_revoke_everyone: ${error.message}`);
      }
    });

    client.on('message_edit', async (message, newBody, prevBody) => {
      try {
        this.logger.log(`✏️ Message edited in session ${sessionId}: ${message.body?.substring(0, 50) || 'media message'}`);
        await this.storageService.updateMessageEdition(sessionId, message, String(newBody), String(prevBody));
      } catch (error) {
        this.logger.error(`Error handling message_edit: ${error.message}`);
      }
    });

    client.on('local_session_saved', async () => {
      this.logger.log(`💾 Session ${sessionId} data saved to local storage`);
    });

    client.on('remote_session_saved', async () => {
      this.logger.log(`💾 Session ${sessionId} data saved to MongoDB`);
    });

    client.on('loading_screen', (percent, message) => {
      this.logger.log(`📱 Session ${sessionId} loading: ${percent}% - ${message}`);
    });
  }
  
  /**
   * Create a new WhatsApp session
   */
  async createSession(sessionId: string) {
    try {
      console.log('createSession or restore session', sessionId);
      
      // Check if session already exists in memory and is ready/authenticated
      const existingSession = this.sessions.get(sessionId);
      if (existingSession && existingSession.isReady) {
        this.logger.warn(`Session ${sessionId} already exists and is ready`);
        return { success: false, sessionId, message: 'Session already exists and is authenticated' };
      }
      

      // Check database for stored session with authenticated/ready status
      const storedSession = await this.whatsAppSessionModel.findOne({ sessionId }).exec();
      if (storedSession && (storedSession.status === 'ready' || storedSession.status === 'authenticated')) {
        // If there's a stored authenticated session but not in memory, try to restore it
        if (!existingSession) {
          this.logger.log(`🔄 Found authenticated session ${sessionId} in database, restoring...`);
          // Don't return here, allow the session creation to proceed which will restore it
        } else {
          this.logger.warn(`Session ${sessionId} is authenticated in database`);
          return { success: false, sessionId, message: 'Session is already authenticated' };
        }
      }

      // If session exists but not ready, we'll recreate it
      if (existingSession && !existingSession.isReady) {
        this.logger.log(`Session ${sessionId} exists but not ready, proceeding with recreation`);
        // Clean up existing session before creating new one
        try {
          await existingSession.client.destroy();
        } catch (error) {
          this.logger.warn(`Error destroying existing session: ${error.message}`);
        }
        this.sessions.delete(sessionId);
      }

      this.logger.log(`🔨 Creating session: ${sessionId}`);
    
      // Store session metadata
      await this.storeSessionMetadata(sessionId, { 
        status: 'initializing', 
        lastSeen: new Date() 
      });

      // Puppeteer options
      // Get the executable path to ensure Chromium is found
      const executablePath = puppeteer.executablePath();
      const defaultPuppeteerOptions = {
        headless: true,
        executablePath: executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
      };

      this.logger.log(`🔧 Using browser executable: ${executablePath}`);

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: this.sessionPath,
        }),
        puppeteer: {
          ...defaultPuppeteerOptions,
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
      });

      // Set up event handlers
      this.setupClientListeners(client, sessionId);

      // Initialize client
      await client.initialize();

      this.sessions.set(sessionId, { 
        client, 
        isReady: false,
        lastRestore: new Date()
      });

      return { success: true, sessionId, message: 'Session created successfully' };
    } catch (error) {
      this.logger.error(`❌ Error creating session ${sessionId}:`, error);
      
      // Remove from sessions if it was added
      this.sessions.delete(sessionId);
      
      // Update metadata
      await this.storeSessionMetadata(sessionId, { 
        status: 'error', 
        lastSeen: new Date() 
      });
      
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Destroy a session
   */
  async destroySession(sessionId: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (session) {
        await session.client.destroy();
        this.sessions.delete(sessionId);
        
        // Remove from MongoDB using the model
        await this.whatsAppSessionModel.deleteMany({ sessionId: sessionId });
        
        this.logger.log(`🧹 Session ${sessionId} destroyed and removed from MongoDB`);
        return { success: true, message: 'Session destroyed successfully' };
      }
      return { success: false, message: 'Session not found' };
    } catch (error) {
      this.logger.error(`Error destroying session ${sessionId}:`, error);
      throw new Error(`Failed to destroy session: ${error.message}`);
    }
  }

  /**
   * Send message
   */
  async sendMessage(sessionId: string, phone: string, message: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (!session.isReady) {
        throw new Error(`Session ${sessionId} is not ready yet`);
      }

      // Format phone number (remove any non-digit characters and ensure proper format)
      const formattedPhone = phone.replace(/\D/g, '');
      const chatId = `${formattedPhone}@c.us`;

      const result = await session.client.sendMessage(chatId, message);
      
      this.logger.log(`📤 Message sent to ${phone} via session ${sessionId}`);
      return { 
        success: true, 
        messageId: result.id._serialized,
        timestamp: result.timestamp,
      };
    } catch (error) {
      this.logger.error(`Error sending message via session ${sessionId}:`, error);
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { exists: false, ready: false };
    }
    return { 
      exists: true, 
      ready: session.isReady,
      state: session.client.info // Additional client info if available
    };
  }

  /**
   * List all active sessions
   */
  getSessions() {
    const sessions = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      sessions.push({
        sessionId,
        isReady: session.isReady,
        lastRestore: session.lastRestore,
      });
    }
    return sessions;
  }

  /**
   * List all stored sessions in MongoDB
   */
  async getStoredSessions() {
    try {
      const sessions = await this.whatsAppSessionModel.find({}).exec();
      return sessions.map(session => ({
        sessionId: session.sessionId,
        status: session.status,
        lastSeen: session.lastSeen,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      }));
    } catch (error) {
      this.logger.error('Error fetching stored sessions:', error);
      return [];
    }
  }

  /**
   * Get client instance (for advanced operations)
   */
  getClient(sessionId: string): Client | null {
    const session = this.sessions.get(sessionId);
    return session ? session.client : null;
  }

  /**
   * Get chats for a session and save them to database
   */
  async getChats(sessionId: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (!session.isReady) {
        throw new Error(`Session ${sessionId} is not ready yet`);
      }

      const chats = await session.client.getChats();
      
      this.logger.log(`📋 Retrieved ${chats.length} chats from session ${sessionId}`);
      
      // Save chats to database using storage service
      try {
        await this.storageService.saveChats(sessionId, chats);
        this.logger.log(`💾 Saved ${chats.length} chats to database for session ${sessionId}`);
      } catch (error) {
        this.logger.error(`Error saving chats to database: ${error.message}`);
      }
      
      return chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        lastMessage: chat.lastMessage,
        timestamp: chat.timestamp,
        archive: chat.archived,
        pinned: chat.pinned,
      }));
    } catch (error) {
      this.logger.error(`Error getting chats from session ${sessionId}:`, error);
      if (error?.message && /Session closed/i.test(error.message)) {
        await this.handleSessionClosed(sessionId);
      }
      
      throw new Error(`Failed to get chats: ${error.message}`);
    }
  }
  /**
   * Get messages from a specific chat
   * Stores messages in database to avoid duplicates, then returns stored messages
   */
  async getChatMessages(sessionId: string, chatId: string, limit?: number) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (!session.isReady) {
        throw new Error(`Session ${sessionId} is not ready yet`);
      }

      // Fetch messages from WhatsApp
      const chat = await session.client.getChatById(chatId);
      const messages = (await chat.fetchMessages({ limit: limit || 50 })).sort((a, b) => a.timestamp - b.timestamp);
      
      this.logger.log(`📨 Retrieved ${messages.length} messages from chat ${chatId} in session ${sessionId}`);
    
      // Store messages in database (batch operation to avoid duplicates)
      try {
        // Save messages concurrently with proper chatId
        const savePromises = messages.map((message) =>
          this.storageService.saveMessage(sessionId, message, chatId),
        );
        await Promise.all(savePromises);
        this.logger.log(`💾 Saved ${messages.length} messages to database for chat ${chatId}`);
      } catch (error) {
        this.logger.error(`Error saving messages to database: ${error.message}`);
        // Continue even if save fails, return the fetched messages
      }
      
      // Fetch stored messages from database
      const storedMessages = await this.getStoredMessages(sessionId, chatId, { 
        limit: limit || 50 
      });
      
      this.logger.log(`📥 Returning ${storedMessages.length} stored messages from database`);
      
      return storedMessages.map(msg => ({
        id: msg.messageId,
        body: msg.body,
        from: msg.from,
        to: msg.to,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp,
        hasMedia: msg.hasMedia,
        mediaType: msg.mediaType,
        hasQuotedMsg: msg.hasQuotedMsg,
        isForwarded: msg.isForwarded,
        isStarred: msg.isStarred,
        isDeleted: msg.isDeleted,
      }));
    } catch (error) {
      this.logger.error(`Error getting messages from chat ${chatId} in session ${sessionId}:`, error);
      if (error?.message && /Session closed/i.test(error.message)) {
        await this.handleSessionClosed(sessionId, chatId);
      }
      throw new Error(`Failed to get messages: ${error.message}`);
    }
  }

  /**
   * Sync recent messages from the live session into local storage
   * If chatId is provided, sync only that chat; otherwise sync all chats
   */
  async syncRecentMessages(sessionId: string, chatId?: string, limitPerChat: number = 100) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (!session.isReady) {
        throw new Error(`Session ${sessionId} is not ready yet`);
      }

      const targetChatIds: string[] = [];

      if (chatId) {
        targetChatIds.push(chatId);
      } else {
        const chats = await session.client.getChats();
        for (const chat of chats) {
          targetChatIds.push(chat.id._serialized);
        }
      }

      this.logger.log(`🔄 Syncing recent messages for ${targetChatIds.length} chat(s) on session ${sessionId}`);

      for (const targetId of targetChatIds) {
        try {
          const chat = await session.client.getChatById(targetId);
          const messages = await chat.fetchMessages({ limit: limitPerChat });
          if (messages.length > 0) {
            await this.storageService.saveMessages(sessionId, messages, targetId);
            this.logger.log(`💾 Synced ${messages.length} messages for chat ${targetId}`);
          }
        } catch (innerError) {
          this.logger.error(`Error syncing messages for chat ${targetId}: ${innerError.message}`);
        }
      }

      return { success: true, chatsProcessed: targetChatIds.length };
    } catch (error) {
      this.logger.error(`Error syncing recent messages for session ${sessionId}:`, error);
      throw new Error(`Failed to sync recent messages: ${error.message}`);
    }
  }

  /**
   * Get messages from database
   */
  async getStoredMessages(sessionId: string, chatId?: string, options?: {
    includeDeleted?: boolean;
    limit?: number;
    skip?: number;
    startTimestamp?: number;
    endTimestamp?: number;
  }) {
    try {
      const query: any = { sessionId };
      
      if (chatId) {
        query.chatId = chatId;
      }
      console.log('options', options);
      // if (!options?.includeDeleted) {
      //   query.isDeleted = false;
      // }
      if (options?.startTimestamp) {
        query.timestamp = { $gte: options.startTimestamp };
      }
      if (options?.endTimestamp) {
        if (!query.timestamp) {
          query.timestamp = {};
        }
        query.timestamp.$lte = options.endTimestamp;
      }

      console.log('query', query);
      const messages = await this.whatsAppMessageModel
        .find(query)
        .sort({ timestamp: 1 })
        //.limit(options?.limit || 50)
        .skip(options?.skip || 0)
        .exec();

      return messages.map(msg => ({
        messageId: msg.messageId,
        chatId: msg.chatId,
        body: msg.body,
        type: msg.type,
        from: msg.from,
        to: msg.to,
        author: msg.author,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp,
        isDeleted: msg.isDeleted,
        deletedAt: msg.deletedAt,
        deletedBy: msg.deletedBy,
        edition: msg.edition,
        hasMedia: msg.hasMedia,
        mediaType: msg.mediaType,
        hasQuotedMsg: msg.hasQuotedMsg,
        isForwarded: msg.isForwarded,
        isStarred: msg.isStarred,
      }));
    } catch (error) {
      this.logger.error(`Error getting stored messages: ${error.message}`);
      throw new Error(`Failed to get stored messages: ${error.message}`);
    }
  }

  /**
   * Get deleted messages
   */
  async getDeletedMessages(sessionId: string, chatId?: string, limit?: number) {
    try {
      const query: any = { sessionId, isDeleted: true };
      
      if (chatId) {
        query.chatId = chatId;
      }
      
      const messages = await this.whatsAppMessageModel
        .find(query)
        .sort({ deletedAt: -1 })
        .limit(limit || 50)
        .exec();
      
      return messages;
    } catch (error) {
      this.logger.error(`Error getting deleted messages: ${error.message}`);
      throw new Error(`Failed to get deleted messages: ${error.message}`);
    }
  }

  /**
   * Get message by ID
   */
  async getStoredMessageById(sessionId: string, messageId: string) {
    try {
      const message = await this.whatsAppMessageModel.findOne({ 
        sessionId, 
        messageId 
      }).exec();
      
      if (!message) {
        throw new Error('Message not found');
      }
      
      return {
        messageId: message.messageId,
        chatId: message.chatId,
        body: message.body,
        type: message.type,
        from: message.from,
        to: message.to,
        author: message.author,
        fromMe: message.fromMe,
        timestamp: message.timestamp,
        isDeleted: message.isDeleted,
        deletedAt: message.deletedAt,
        deletedBy: message.deletedBy,
        edition: message.edition,
        hasMedia: message.hasMedia,
        mediaType: message.mediaType,
        editionHistory: message.edition,
        rawData: message.rawData,
      };
    } catch (error) {
      this.logger.error(`Error getting stored message: ${error.message}`);
      throw new Error(`Failed to get message: ${error.message}`);
    }
  }

  /**
   * Get message edit history
   */
  async getMessageEditHistory(sessionId: string, messageId: string) {
    try {
      const message = await this.whatsAppMessageModel.findOne({ 
        sessionId, 
        messageId 
      }).exec();
      
      if (!message) {
        throw new Error('Message not found');
      }
      
      return {
        messageId: message.messageId,
        currentBody: message.body,
        editionHistory: message.edition,
        editCount: message.edition.length,
      };
    } catch (error) {
      this.logger.error(`Error getting message edit history: ${error.message}`);
      throw new Error(`Failed to get edit history: ${error.message}`);
    }
  }

  /**
   * Get stored chats from database
   */
  async getStoredChats(sessionId: string, options?: {
    archived?: boolean;
    isGroup?: boolean;
    limit?: number;
    skip?: number;
  }) {
    return this.storageService.getStoredChats(sessionId, options);
  }

  /**
   * Get a specific stored chat from database
   */
  async getStoredChat(sessionId: string, chatId: string) {
    return this.storageService.getStoredChat(sessionId, chatId);
  }

  // Event emitter methods using WebSocket
  private emitQrEvent(sessionId: string, qr: string) {
    this.gateway.emitQrCode(sessionId, qr);
  }

  private emitReadyEvent(sessionId: string) {
    this.gateway.emitReady(sessionId);
  }

  private emitAuthFailureEvent(sessionId: string, error: any) {
    this.gateway.emitAuthFailure(sessionId, error);
  }

  private async handleSessionClosed(sessionId: string, chatId?: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.isReady = false;
      }
      await this.storeSessionMetadata(sessionId, {
        status: 'closed',
        lastSeen: new Date(),
      });
      this.gateway.emitSessionClosed(sessionId, chatId);
    } catch (e) {
      this.logger.error(`Failed to handle session closed for ${sessionId}: ${e.message}`);
    }
  }
}

