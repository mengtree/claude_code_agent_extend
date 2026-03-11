/**
 * Message Bus - 消息总线
 *
 * 负责模块间的统一通讯
 */

import { randomUUID } from 'node:crypto';
import type { MessageEnvelope, MessageHandler, MessageBusOptions } from '../types/index.js';

/**
 * 消息总线类
 */
export class MessageBus {
  private readonly handlers: Map<string, Set<MessageHandler>>;
  private readonly pendingRequests: Map<string, PendingRequest>;
  private readonly messageHistory: MessageEnvelope[];
  private readonly maxHistorySize: number;

  constructor(options: MessageBusOptions = {}) {
    this.handlers = new Map();
    this.pendingRequests = new Map();
    this.messageHistory = [];
    this.maxHistorySize = options.maxHistorySize || 1000;
  }

  /**
   * 发送消息（不等待响应）
   */
  send(envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>): string {
    const fullEnvelope: MessageEnvelope = {
      messageId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...envelope
    };

    // 记录消息历史
    this.addToHistory(fullEnvelope);

    // 路由消息
    this.routeMessage(fullEnvelope);

    return fullEnvelope.messageId;
  }

  /**
   * 发送消息并等待响应
   */
  async request(
    envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>,
    timeoutMs: number = 30000
  ): Promise<MessageEnvelope> {
    const fullEnvelope: MessageEnvelope = {
      messageId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...envelope
    };

    // 记录消息历史
    this.addToHistory(fullEnvelope);

    // 创建待处理的请求
    const requestId = fullEnvelope.messageId;
    const promise = this.createPendingRequest(requestId, timeoutMs);

    try {
      // 路由消息
      this.routeMessage(fullEnvelope);

      // 等待响应
      return await promise;
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * 订阅消息（处理发给指定模块的消息）
   */
  subscribe(toModule: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(toModule)) {
      this.handlers.set(toModule, new Set());
    }

    this.handlers.get(toModule)!.add(handler);

    // 返回取消订阅函数
    return () => this.unsubscribe(toModule, handler);
  }

  /**
   * 取消订阅
   */
  unsubscribe(toModule: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(toModule);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(toModule);
      }
    }
  }

  /**
   * 回复消息
   */
  reply(originalMessage: MessageEnvelope, payload: unknown, isError: boolean = false): string {
    const replyEnvelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'> = {
      fromModule: originalMessage.toModule,
      toModule: originalMessage.fromModule,
      action: `${originalMessage.action}_reply`,
      payload: isError ? { error: payload } : { result: payload },
      replyTo: originalMessage.fromModule,
      context: originalMessage.context,
      traceId: originalMessage.traceId,
      inReplyTo: originalMessage.messageId,
      timeoutMs: originalMessage.timeoutMs
    };

    return this.send(replyEnvelope);
  }

  /**
   * 路由消息到目标模块的处理程序
   */
  private routeMessage(envelope: MessageEnvelope): void {
    const handlers = this.handlers.get(envelope.toModule);

    if (!handlers || handlers.size === 0) {
      // 没有处理器，记录警告
      console.warn(`No handlers registered for module: ${envelope.toModule}`);
      return;
    }

    // 调用所有处理器
    for (const handler of handlers) {
      try {
        handler(envelope);
      } catch (error) {
        console.error(`Error in message handler for ${envelope.toModule}:`, error);
      }
    }
  }

  /**
   * 创建待处理的请求
   */
  private createPendingRequest(requestId: string, timeoutMs: number): Promise<MessageEnvelope> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Message request timeout: ${requestId}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutHandle
      });
    });
  }

  /**
   * 解析待处理的请求（当收到回复时调用）
   */
  resolvePendingRequest(messageId: string, response: MessageEnvelope): boolean {
    const pending = this.pendingRequests.get(messageId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve(response);
      return true;
    }
    return false;
  }

  /**
   * 添加消息到历史记录
   */
  private addToHistory(envelope: MessageEnvelope): void {
    this.messageHistory.push(envelope);

    // 限制历史记录大小
    while (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }

  /**
   * 根据 traceId 获取消息历史
   */
  getHistoryByTrace(traceId: string): MessageEnvelope[] {
    return this.messageHistory.filter(m => m.traceId === traceId);
  }

  /**
   * 根据 messageId 获取消息
   */
  getMessage(messageId: string): MessageEnvelope | undefined {
    return this.messageHistory.find(m => m.messageId === messageId);
  }

  /**
   * 获取所有消息历史
   */
  getAllHistory(): ReadonlyArray<MessageEnvelope> {
    return this.messageHistory;
  }

  /**
   * 清空消息历史
   */
  clearHistory(): void {
    this.messageHistory.length = 0;
  }

  /**
   * 获取统计数据
   */
  getStats(): MessageBusStats {
    return {
      totalHandlers: Array.from(this.handlers.values()).reduce((sum, set) => sum + set.size, 0),
      subscribedModules: this.handlers.size,
      pendingRequests: this.pendingRequests.size,
      historySize: this.messageHistory.length
    };
  }

  /**
   * 导出为 JSON（用于调试）
   */
  toJSON(): Record<string, unknown> {
    return {
      handlers: Object.fromEntries(
        Array.from(this.handlers.entries()).map(([module, handlers]) => [
          module,
          handlers.size
        ])
      ),
      pendingRequests: this.pendingRequests.size,
      historySize: this.messageHistory.length
    };
  }
}

/**
 * 待处理的请求
 */
interface PendingRequest {
  resolve: (value: MessageEnvelope) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

/**
 * 消息总线统计数据
 */
export interface MessageBusStats {
  /** 总处理器数 */
  totalHandlers: number;
  /** 已订阅的模块数 */
  subscribedModules: number;
  /** 待处理的请求数 */
  pendingRequests: number;
  /** 历史记录大小 */
  historySize: number;
}

/**
 * 创建消息总线实例
 */
export function createMessageBus(options?: MessageBusOptions): MessageBus {
  return new MessageBus(options);
}
