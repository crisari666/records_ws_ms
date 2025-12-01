import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsAppChat, WhatsAppChatDocument } from './schemas/whatsapp-chat.schema';
import { WhatsAppMessage, WhatsAppMessageDocument } from './schemas/whatsapp-message.schema';
import * as WAWebJS from 'whatsapp-web.js';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class WhatsappStorageService {
  private readonly logger = new Logger(WhatsappStorageService.name);
  private readonly mediaPath = path.join(process.cwd(), 'media');

  constructor(
    @InjectModel(WhatsAppChat.name) private whatsAppChatModel: Model<WhatsAppChatDocument>,
    @InjectModel(WhatsAppMessage.name) private whatsAppMessageModel: Model<WhatsAppMessageDocument>,
  ) {
    // Ensure media directory exists
    this.ensureMediaDirectory();
  }

  /**
   * Ensure media directory exists
   */
  private async ensureMediaDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.mediaPath, { recursive: true });
      this.logger.log(`📁 Media directory ensured: ${this.mediaPath}`);
    } catch (error) {
      this.logger.error(`Error creating media directory: ${error.message}`);
    }
  }

  /**
   * Save or update a chat in the database
   * Validates if the chat already exists to avoid duplicates
   */
  async saveChat(sessionId: string, chat: WAWebJS.Chat): Promise<void> {
    try {
      // Check if the last message type is "e2e_notification"
      const isE2ENotification = chat.lastMessage?.type === 'e2e_notification';

      const chatData: any = {
        chatId: chat.id._serialized,
        sessionId,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        archived: chat.archived,
        pinned: chat.pinned,
        isReadOnly: chat.isReadOnly,
        isMuted: chat.isMuted,
        muteExpiration: chat.muteExpiration,
        lastMessage: chat.lastMessage?.body || null,
        lastMessageTimestamp: chat.lastMessage?.timestamp || null,
        lastMessageFromMe: chat.lastMessage?.fromMe || false,
      };

      // Only set deleted: false if the message type is NOT "e2e_notification"
      if (!isE2ENotification) {
        chatData.deleted = false;
      }

      // Use findOneAndUpdate with upsert to handle duplicates
      // Preserve deletedAt array history, only initialize it for new chats
      await this.whatsAppChatModel.findOneAndUpdate(
        { chatId: chat.id._serialized, sessionId },
        {
          $set: chatData,
          $setOnInsert: { deletedAt: [] }
        },
        { upsert: true, new: true }
      );

      this.logger.debug(`💾 Chat saved: ${chat.id._serialized}`);
    } catch (error) {
      this.logger.error(`Error saving chat: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save multiple chats (batch operation)
   */
  async saveChats(
    sessionId: string,
    chats: WAWebJS.Chat[],
    onProgress?: (currentIndex: number, total: number, chat: WAWebJS.Chat) => void | Promise<void>
  ): Promise<void> {
    try {
      const total = chats.length;

      // Process chats one by one to allow progress callbacks
      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];

        // Check if the last message type is "e2e_notification"
        const isE2ENotification = chat.lastMessage?.type === 'e2e_notification';

        const chatData: any = {
          chatId: chat.id._serialized,
          sessionId,
          name: chat.name,
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp,
          archived: chat.archived,
          pinned: chat.pinned,
          isReadOnly: chat.isReadOnly,
          isMuted: chat.isMuted,
          muteExpiration: chat.muteExpiration,
          lastMessage: chat.lastMessage?.body || null,
          lastMessageTimestamp: chat.lastMessage?.timestamp || null,
          lastMessageFromMe: chat.lastMessage?.fromMe || false,
        };

        // Only set deleted: false if the message type is NOT "e2e_notification"
        if (!isE2ENotification) {
          chatData.deleted = false;
        }

        await this.whatsAppChatModel.findOneAndUpdate(
          { chatId: chat.id._serialized, sessionId },
          {
            $set: chatData,
            $setOnInsert: { deletedAt: [] }
          },
          { upsert: true, new: true }
        );

        // Call progress callback if provided
        if (onProgress) {
          await onProgress(i + 1, total, chat);
        }
      }

      this.logger.log(`💾 Saved ${chats.length} chats for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error saving chats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save or update a message in the database
   */
  async saveMessage(sessionId: string, message: WAWebJS.Message, chatId?: string): Promise<void> {
    try {

      const messageChatId = chatId || message.id.remote
      const messageData = {
        messageId: message.id._serialized,
        sessionId,
        chatId: messageChatId,
        body: message.body || '',
        type: message.type,
        from: message.from,
        to: message.to,
        author: message.author,
        fromMe: message.fromMe,
        isForwarded: message.isForwarded || false,
        forwardingScore: message.forwardingScore || 0,
        isStatus: message.isStatus || false,
        hasMedia: message.hasMedia || false,
        mediaType: message.hasMedia ? message.type : null,
        mediaPath: null, // Will be updated when media is downloaded
        mediaSize: null,
        mediaFilename: null,
        hasQuotedMsg: message.hasQuotedMsg || false,
        isStarred: message.isStarred || false,
        isGif: message.isGif || false,
        isEphemeral: message.isEphemeral || false,
        timestamp: message.timestamp,
        ack: message.ack || 0,
        deletedAt: null,
        deletedBy: null,
        edition: [],
        deviceType: message.deviceType,
        broadcast: message.broadcast || false,
        mentionedIds: message.mentionedIds || [],
        rawData: message.rawData!,
      };

      const existingMessage = await this.whatsAppMessageModel.findOne({
        messageId: message.id._serialized,
        sessionId
      });
      if (!existingMessage) {
        const newMessage = await this.whatsAppMessageModel.create({...messageData, isDeleted: false});
        this.logger.debug(`💾 Message saved: ${newMessage.chatId}`);
      } 
      else {
        
        console.log('existingMessage', {existingMessage});
        if (existingMessage.isDeleted) {
          return;
        }
        // Update only if message data has changed
        await this.whatsAppMessageModel.updateOne(
          { messageId: message.id._serialized, sessionId },
          { $set: messageData }
        );
        this.logger.debug(`✏️ Message updated: ${message.id._serialized}`);
      }
    } catch (error) {
      this.logger.error(`Error saving message: ${error.message}`);
    }
  }

  /**
   * Batch save messages (more efficient for bulk operations)
   */
  async saveMessages(
    sessionId: string,
    messages: WAWebJS.Message[],
    chatId?: string,
    onProgress?: (messagesSaved: number) => void | Promise<void>
  ): Promise<void> {
    try {
      if (messages.length === 0) {
        return;
      }

      const operations = messages.map(message => {
        // Use provided chatId or fallback to message context
        const messageChatId = chatId || message.from || message.to;

        return {
          updateOne: {
            filter: {
              messageId: message.id._serialized,
              sessionId
            },
            update: {
              $set: {
                messageId: message.id._serialized,
                sessionId,
                chatId: messageChatId,
                body: message.body || '',
                type: message.type,
                from: message.from,
                to: message.to,
                author: message.author,
                fromMe: message.fromMe,
                isForwarded: message.isForwarded || false,
                forwardingScore: message.forwardingScore || 0,
                isStatus: message.isStatus || false,
                hasMedia: message.hasMedia || false,
                mediaType: message.hasMedia ? message.type : null,
                mediaPath: null, // Will be updated when media is downloaded
                mediaSize: null,
                mediaFilename: null,
                hasQuotedMsg: message.hasQuotedMsg || false,
                isStarred: message.isStarred || false,
                isGif: message.isGif || false,
                isEphemeral: message.isEphemeral || false,
                timestamp: message.timestamp,
                ack: message.ack || 0,
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                edition: [],
                deviceType: message.deviceType,
                broadcast: message.broadcast || false,
                mentionedIds: message.mentionedIds || [],
                rawData: message.rawData || {},
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        };
      });

      await this.whatsAppMessageModel.bulkWrite(operations);
      this.logger.log(`💾 Batch saved ${messages.length} messages for session ${sessionId}`);

      // Call progress callback if provided
      if (onProgress) {
        await onProgress(messages.length);
      }
    } catch (error) {
      this.logger.error(`Error batch saving messages: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark message as deleted
   */
  async markMessageAsDeleted(sessionId: string, messageId: string, deletedBy: string = 'everyone'): Promise<void> {
    try {
      await this.whatsAppMessageModel.updateOne(
        { messageId, sessionId },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy,
          }
        }
      );

      this.logger.debug(`🗑️ Message marked as deleted: ${messageId} by ${deletedBy}`);
    } catch (error) {
      this.logger.error(`Error marking message as deleted: ${error.message}`);
    }
  }

  /**
   * Update message edition history
   */
  async updateMessageEdition(sessionId: string, message: WAWebJS.Message, newBody: string, prevBody: string): Promise<void> {
    try {
      const existingMessage = await this.whatsAppMessageModel.findOne({
        messageId: message.id._serialized,
        sessionId
      });

      const editionHistory = existingMessage?.edition || [];
      editionHistory.push(prevBody);

      await this.whatsAppMessageModel.updateOne(
        { messageId: message.id._serialized, sessionId },
        {
          $set: {
            body: newBody,
            edition: editionHistory,
          }
        }
      );

      this.logger.debug(`✏️ Message edition saved: ${message.id._serialized}`);
    } catch (error) {
      this.logger.error(`Error updating message edition: ${error.message}`);
    }
  }

  /**
   * Get all chats from database for a session
   */
  async getStoredChats(sessionId: string, options?: {
    archived?: boolean;
    isGroup?: boolean;
    limit?: number;
    skip?: number;
  }): Promise<WhatsAppChat[]> {
    try {
      const query: any = { sessionId };

      console.log({ options });

      if (options?.archived !== undefined) {
        query.archived = options.archived;
      }

      if (options?.isGroup !== undefined) {
        query.isGroup = options.isGroup;
      }

      console.log({ query });

      const chats = await this.whatsAppChatModel
        .find(query)
        .sort({ timestamp: -1 })
        .limit(options?.limit || 500)
        .skip(options?.skip || 0)
        .exec();

      return chats;
    } catch (error) {
      this.logger.error(`Error getting stored chats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a specific chat from database
   */
  async getStoredChat(sessionId: string, chatId: string): Promise<WhatsAppChat | null> {
    try {
      const chat = await this.whatsAppChatModel
        .findOne({ sessionId, chatId })
        .exec();

      return chat;
    } catch (error) {
      this.logger.error(`Error getting stored chat: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark chat as deleted
   */
  async markChatAsDeleted(sessionId: string, chatId: string): Promise<void> {
    try {
      const deletionDate = new Date();

      const chat = await this.whatsAppChatModel.findOne({ chatId, sessionId });
      if (!chat) {
        this.logger.warn(`Chat not found: ${chatId} in session ${sessionId}`);
        return;
      }
      await this.whatsAppChatModel.updateOne(
        { chatId, sessionId },
        {
          $set: {
            deleted: true,
          },
          $push: {
            deletedAt: deletionDate,
          }
        }
      );

      this.logger.debug(`🗑️ Chat marked as deleted: ${chatId} in session ${sessionId} at ${deletionDate.toISOString()}`);
    } catch (error) {
      this.logger.error(`Error marking chat as deleted: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all stored messages from database
   */
  async getStoredMessages(sessionId: string, chatId?: string, options?: {
    includeDeleted?: boolean;
    limit?: number;
    skip?: number;
    startTimestamp?: number;
    endTimestamp?: number;
  }): Promise<WhatsAppMessage[]> {
    try {
      const query: any = { sessionId };

      if (chatId) {
        query.chatId = chatId;
      }

      if (!options?.includeDeleted) {
        query.isDeleted = false;
      }

      if (options?.startTimestamp) {
        query.timestamp = { $gte: options.startTimestamp };
      }

      if (options?.endTimestamp) {
        if (!query.timestamp) {
          query.timestamp = {};
        }
        query.timestamp.$lte = options.endTimestamp;
      }

      const messages = await this.whatsAppMessageModel
        .find(query)
        .sort({ timestamp: -1 })
        .limit(options?.limit || 50)
        .skip(options?.skip || 0)
        .exec();

      return messages;
    } catch (error) {
      this.logger.error(`Error getting stored messages: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save media file to local storage
   * @param sessionId - Session ID
   * @param messageId - Message ID
   * @param media - Media object from WhatsApp
   * @returns Media file path relative to media directory
   */
  async saveMediaFile(sessionId: string, messageId: string, media: WAWebJS.MessageMedia): Promise<{
    mediaPath: string;
    mediaSize: number;
    mediaFilename: string;
  } | null> {
    try {
      if (!media || !media.data) {
        this.logger.warn(`No media data to save for message ${messageId}`);
        return null;
      }

      // Determine file extension from mimetype
      const extension = this.getFileExtension(media.mimetype);
      if (!extension) {
        this.logger.warn(`Unknown mimetype: ${media.mimetype} for message ${messageId}`);
        return null;
      }

      // Create session-specific directory
      const sessionMediaPath = path.join(this.mediaPath, sessionId);
      await fs.mkdir(sessionMediaPath, { recursive: true });

      // Generate filename: messageId.extension
      const filename = `${messageId.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;
      const filePath = path.join(sessionMediaPath, filename);

      // Convert base64 data to buffer
      const buffer = Buffer.from(media.data, 'base64');

      // Save file
      await fs.writeFile(filePath, buffer);

      // Calculate file size
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      // Return relative path for easy access (e.g., sessionId/filename)
      const relativePath = path.join(sessionId, filename).replace(/\\/g, '/');

      this.logger.log(`💾 Media file saved: ${relativePath} (${fileSize} bytes)`);

      return {
        mediaPath: relativePath,
        mediaSize: fileSize,
        mediaFilename: media.filename || filename,
      };
    } catch (error) {
      this.logger.error(`Error saving media file for message ${messageId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get file extension from mimetype
   */
  private getFileExtension(mimetype: string): string | null {
    const mimeToExt: { [key: string]: string } = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/webm': 'webm',
      'audio/aac': 'aac',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/plain': 'txt',
    };

    // Handle mimetype with parameters (e.g., "audio/ogg; codecs=opus")
    const baseMime = mimetype.split(';')[0].trim();
    return mimeToExt[baseMime] || mimeToExt[mimetype] || null;
  }

  /**
   * Update message with media path
   */
  async updateMessageMedia(
    sessionId: string,
    messageId: string,
    mediaInfo: { mediaPath: string; mediaSize: number; mediaFilename: string }
  ): Promise<void> {
    try {
      await this.whatsAppMessageModel.updateOne(
        { messageId, sessionId },
        {
          $set: {
            mediaPath: mediaInfo.mediaPath,
            mediaSize: mediaInfo.mediaSize,
            mediaFilename: mediaInfo.mediaFilename,
          }
        }
      );
      this.logger.debug(`✏️ Message media path updated: ${messageId}`);
    } catch (error) {
      this.logger.error(`Error updating message media path: ${error.message}`);
    }
  }
}

