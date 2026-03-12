/**
 * 消息控制器
 *
 * 负责处理来自核心平台的消息总线请求，并支持通过 Platform 消息总线进行模块间通信。
 */

import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMessageBusClient, type ModuleMessageBusClient } from '@agent-platform/module-message-bus-client';
import type { MessageEnvelope, MessageHandler } from '../types/index.js';
import { ValidationError } from '../types/index.js';

/**
 * 消息控制器类
 */
export class MessageController {
  private readonly handlers: Map<string, MessageHandler> = new Map();
  private messageBusClient?: ModuleMessageBusClient<MessageEnvelope>;
  private sseSubscription?: {
    unsubscribe: () => void;
  };

  constructor(
    private readonly moduleId: string,
    options?: {
      /** Platform 消息总线地址 */
      messageBusURL?: string;
      /** 是否自动订阅消息总线 */
      autoSubscribe?: boolean;
    }
  ) {
    if (options?.messageBusURL) {
      this.initMessageBus(options.messageBusURL, options.autoSubscribe ?? true);
    }
  }

  /**
   * 注册消息处理器
   */
  registerHandler(action: string, handler: MessageHandler): void {
    this.handlers.set(action, handler);
  }

  /**
   * 初始化消息总线客户端
   */
  private initMessageBus(baseURL: string, autoSubscribe: boolean): void {
    this.messageBusClient = createMessageBusClient(baseURL, this.moduleId);

    if (autoSubscribe) {
      this.sseSubscription = this.messageBusClient.subscribeSSE(
        {
          topics: [`module.${this.moduleId}.*`]
        },
        {
          onMessage: this.handleBusMessage.bind(this),
          onError: (error) => {
            console.error(`[${this.moduleId}] Message bus error:`, error);
          },
          onConnected: () => {
            console.log(`[${this.moduleId}] Connected to message bus`);
          },
          onDisconnected: () => {
            console.log(`[${this.moduleId}] Disconnected from message bus`);
          },
          autoReconnect: true
        }
      );
    }

    console.log(`[${this.moduleId}] Message bus client initialized`);
  }

  /**
   * 处理来自消息总线的消息
   */
  private async handleBusMessage(envelope: MessageEnvelope): Promise<void> {
    const handler = this.handlers.get(envelope.action);

    if (!handler) {
      console.warn(`[${this.moduleId}] No handler for action: ${envelope.action}`);
      // 发送错误回复
      if (this.messageBusClient && envelope.replyTo) {
        await this.messageBusClient.reply(envelope, `Unknown action: ${envelope.action}`, true);
      }
      return;
    }

    try {
      await handler(envelope);
    } catch (error) {
      console.error(`[${this.moduleId}] Error handling message:`, error);

      // 发送错误回复
      if (this.messageBusClient && envelope.replyTo) {
        await this.messageBusClient.reply(
          envelope,
          error instanceof Error ? error.message : String(error),
          true
        );
      }
    }
  }

  /**
   * 发送消息到消息总线
   */
  async sendToBus(config: {
    toModule?: string;
    action: string;
    payload: unknown;
    replyTo?: string;
    callbackTopic?: string;
    traceId?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; error?: string } | null> {
    if (!this.messageBusClient) {
      console.warn(`[${this.moduleId}] Message bus client not initialized`);
      return null;
    }

    return this.messageBusClient.send(config);
  }

  /**
   * 关闭消息总线连接
   */
  shutdown(): void {
    this.sseSubscription?.unsubscribe();
    this.messageBusClient?.shutdown();
  }

  /**
   * 取消注册消息处理器
   */
  unregisterHandler(action: string): void {
    this.handlers.delete(action);
  }

  /**
   * 处理消息请求（POST /messages）
   */
  async handleMessage(request: Request, response: ServerResponse): Promise<void> {
    try {
      const envelope = await this.parseEnvelope(request);

      // 查找处理器
      const handler = this.handlers.get(envelope.action);
      if (!handler) {
        throw new ValidationError(`Unknown action: ${envelope.action}`);
      }

      // 调用处理器
      await handler(envelope);

      // 返回响应
      this.sendJson(response, 200, {
        ok: true,
        messageId: envelope.messageId
      });

    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 解析消息信封
   */
  private async parseEnvelope(request: Request): Promise<MessageEnvelope> {
    try {
      const body = await request.json() as MessageEnvelope;

      // 验证必需字段
      if (!body.messageId || !body.action || !body.fromModule || !body.toModule) {
        throw new ValidationError('Missing required fields in message envelope');
      }

      // 验证目标模块
      if (body.toModule !== 'sessions') {
        throw new ValidationError(`Message addressed to wrong module: ${body.toModule}`);
      }

      return body;
    } catch (error) {
      throw new ValidationError('Invalid message envelope');
    }
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }

  /**
   * 处理错误
   */
  private handleError(response: ServerResponse, error: unknown): void {
    const statusCode = error instanceof ValidationError ? 400 : 500;
    const message = error instanceof Error ? error.message : String(error);

    this.sendJson(response, statusCode, {
      error: message,
      ok: false
    });
  }
}

/**
 * 创建消息响应信封
 */
export function createReply(
  originalMessage: MessageEnvelope,
  payload: unknown,
  isError: boolean = false
): MessageEnvelope {
  return {
    messageId: randomUUID(),
    traceId: originalMessage.traceId,
    fromModule: 'sessions',
    toModule: originalMessage.replyTo || originalMessage.fromModule,
    action: isError ? 'error' : 'reply',
    payload,
    replyTo: 'sessions',
    timeoutMs: 5000,
    context: originalMessage.context,
    createdAt: new Date().toISOString()
  };
}
