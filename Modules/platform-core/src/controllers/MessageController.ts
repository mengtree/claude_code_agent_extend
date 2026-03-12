/**
 * 消息控制器
 *
 * 提供统一消息 Envelope 的 HTTP 接入能力，并支持通过 Platform 消息总线进行模块间通信。
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MessageEnvelope, MessageRequestHandler } from '../types/index.js';
import type { MessageBusClient } from '../services/MessageBusClient.js';

/**
 * 消息控制器类
 */
export class MessageController {
  private readonly handlers: Map<string, MessageRequestHandler> = new Map();
  private messageBusClient?: MessageBusClient;
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
  registerHandler(action: string, handler: MessageRequestHandler): void {
    this.handlers.set(action, handler);
  }

  /**
   * 初始化消息总线客户端
   */
  private initMessageBus(baseURL: string, autoSubscribe: boolean): void {
    // 动态导入 MessageBusClient
    import('../services/MessageBusClient.js').then(({ createMessageBusClient }) => {
      this.messageBusClient = createMessageBusClient(baseURL, this.moduleId);

      if (autoSubscribe) {
        // 订阅发给我的消息
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
    }).catch((error) => {
      console.error(`[${this.moduleId}] Failed to initialize message bus:`, error);
    });
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
      const result = await handler(envelope);

      // 发送回复
      if (this.messageBusClient && envelope.replyTo) {
        await this.messageBusClient.reply(envelope, result);
      }
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
   * 处理消息请求（POST /messages）
   */
  async handleMessage(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const envelope = await this.readEnvelope(request);
      const handler = this.handlers.get(envelope.action);

      if (!handler) {
        throw new Error(`Unknown action: ${envelope.action}`);
      }

      const result = await handler(envelope);

      if (this.isMessageEnvelope(result)) {
        this.sendJson(response, 200, result);
        return;
      }

      this.sendJson(response, 200, createReply(envelope, result ?? { ok: true }));
    } catch (error) {
      const envelope = this.tryExtractEnvelope(request);
      if (envelope) {
        this.sendJson(response, 500, createReply(
          envelope,
          { message: error instanceof Error ? error.message : String(error) },
          true
        ));
        return;
      }

      this.sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      });
    }
  }

  /**
   * 读取消息信封
   */
  private async readEnvelope(request: IncomingMessage): Promise<MessageEnvelope> {
    const body = await this.readJsonBody(request);

    if (!body || typeof body !== 'object') {
      throw new Error('Request body must be a valid object');
    }

    const envelope = body as Partial<MessageEnvelope>;

    if (!envelope.action || !envelope.fromModule || !envelope.toModule || !envelope.replyTo) {
      throw new Error('Missing required fields in message envelope');
    }

    if (envelope.toModule !== this.moduleId) {
      throw new Error(`Message addressed to wrong module: ${envelope.toModule}`);
    }

    return {
      messageId: envelope.messageId || randomUUID(),
      traceId: envelope.traceId || randomUUID(),
      fromModule: envelope.fromModule,
      toModule: envelope.toModule,
      action: envelope.action,
      payload: envelope.payload,
      replyTo: envelope.replyTo,
      callbackTopic: envelope.callbackTopic,
      timeoutMs: envelope.timeoutMs,
      context: envelope.context || {},
      createdAt: envelope.createdAt || new Date().toISOString(),
      inReplyTo: envelope.inReplyTo
    };
  }

  /**
   * 尝试从请求对象读取 envelope 缓存
   */
  private tryExtractEnvelope(request: IncomingMessage): MessageEnvelope | null {
    return (request as IncomingMessage & { parsedEnvelope?: MessageEnvelope }).parsedEnvelope || null;
  }

  /**
   * 读取 JSON 请求体
   */
  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const bodyText = await new Promise<string>((resolve, reject) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on('end', () => {
        resolve(body);
      });

      request.on('error', reject);
    });

    if (!bodyText.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);
      const envelope = parsed as MessageEnvelope;
      (request as IncomingMessage & { parsedEnvelope?: MessageEnvelope }).parsedEnvelope = envelope;
      return parsed;
    } catch {
      throw new Error('Invalid JSON in request body');
    }
  }

  /**
   * 判断是否为消息信封
   */
  private isMessageEnvelope(value: unknown): value is MessageEnvelope {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<MessageEnvelope>;
    return typeof candidate.messageId === 'string'
      && typeof candidate.traceId === 'string'
      && typeof candidate.fromModule === 'string'
      && typeof candidate.toModule === 'string'
      && typeof candidate.action === 'string'
      && typeof candidate.replyTo === 'string'
      && typeof candidate.createdAt === 'string';
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }
}

/**
 * 创建回复信封
 */
export function createReply(
  originalMessage: MessageEnvelope,
  payload: unknown,
  isError: boolean = false
): MessageEnvelope {
  return {
    messageId: randomUUID(),
    traceId: originalMessage.traceId,
    fromModule: originalMessage.toModule,
    toModule: originalMessage.replyTo || originalMessage.fromModule,
    action: `${originalMessage.action}_reply`,
    payload: isError ? { error: payload } : { result: payload },
    replyTo: originalMessage.fromModule,
    callbackTopic: originalMessage.callbackTopic,
    timeoutMs: originalMessage.timeoutMs,
    context: originalMessage.context,
    createdAt: new Date().toISOString(),
    inReplyTo: originalMessage.messageId
  };
}