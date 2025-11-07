import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsAppChat, WhatsAppChatDocument } from './schemas/whatsapp-chat.schema';
import { WhatsAppMessage, WhatsAppMessageDocument } from './schemas/whatsapp-message.schema';
import * as WAWebJS from 'whatsapp-web.js';

@Injectable()
export class WhatsappStorageService {
  private readonly logger = new Logger(WhatsappStorageService.name);

  constructor(
    @InjectModel(WhatsAppChat.name) private whatsAppChatModel: Model<WhatsAppChatDocument>,
    @InjectModel(WhatsAppMessage.name) private whatsAppMessageModel: Model<WhatsAppMessageDocument>,
  ) {}

  /**
   * Save or update a chat in the database
   * Validates if the chat already exists to avoid duplicates
   */
  async saveChat(sessionId: string, chat: WAWebJS.Chat): Promise<void> {
    try {
      const chatData = {
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
        deleted: false,
        muteExpiration: chat.muteExpiration,
        lastMessage: chat.lastMessage?.body || null,
        lastMessageTimestamp: chat.lastMessage?.timestamp || null,
        lastMessageFromMe: chat.lastMessage?.fromMe || false,
      };

      // Use findOneAndUpdate with upsert to handle duplicates
      await this.whatsAppChatModel.findOneAndUpdate(
        { chatId: chat.id._serialized, sessionId },
        { $set: chatData },
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
  async saveChats(sessionId: string, chats: WAWebJS.Chat[]): Promise<void> {
    try {
      const operations = chats.map(chat => ({
        updateOne: {
          filter: { chatId: chat.id._serialized, sessionId },
          update: {
            $set: {
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
            },
          },
          upsert: true,
        },
      }));

      if (operations.length > 0) {
        await this.whatsAppChatModel.bulkWrite(operations);
        this.logger.log(`💾 Batch saved ${chats.length} chats for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(`Error batch saving chats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save or update a message in the database
   */
  async saveMessage(sessionId: string, message: WAWebJS.Message, chatId?: string): Promise<void> {
    try {
      // Use provided chatId or fallback to message context
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
      };

      // Check if message already exists
      const existingMessage = await this.whatsAppMessageModel.findOne({
        messageId: message.id._serialized,
        sessionId
      });

      if (!existingMessage) {
        const newMessage = await this.whatsAppMessageModel.create(messageData);
        // console.log('newMessage', newMessage);
        this.logger.debug(`💾 Message saved: ${newMessage.chatId}`);
      } else {
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
  async saveMessages(sessionId: string, messages: WAWebJS.Message[], chatId?: string): Promise<void> {
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

      console.log({options});
      
      if (options?.archived !== undefined) {
        query.archived = options.archived;
      }
      
      if (options?.isGroup !== undefined) {
        query.isGroup = options.isGroup;
      }

      console.log({query});

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
      await this.whatsAppChatModel.updateOne(
        { chatId, sessionId },
        { 
          $set: { 
            deleted: true,
            deletedAt: new Date(),
          }
        }
      );
      
      this.logger.debug(`🗑️ Chat marked as deleted: ${chatId} in session ${sessionId}`);
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
}

