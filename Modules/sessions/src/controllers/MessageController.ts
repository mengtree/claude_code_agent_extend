/**
 * 消息控制器
 *
 * 负责处理来自核心平台的消息总线请求
 */

import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { MessageEnvelope, MessageHandler } from '../types/index.js';
import { ValidationError } from '../types/index.js';

/**
 * 消息控制器类
 */
export class MessageController {
  private readonly handlers: Map<string, MessageHandler> = new Map();

  /**
   * 注册消息处理器
   */
  registerHandler(action: string, handler: MessageHandler): void {
    this.handlers.set(action, handler);
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
