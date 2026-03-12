import { randomUUID } from 'node:crypto';
import type { MessageBusOptions, MessageEnvelope, MessageHandler } from '../types.js';

interface PendingRequest {
  resolve: (value: MessageEnvelope) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

export interface MessageBusStats {
  totalHandlers: number;
  subscribedModules: number;
  pendingRequests: number;
  historySize: number;
}

export class MessageBus {
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly messageHistory: MessageEnvelope[] = [];
  private readonly maxHistorySize: number;

  constructor(options: MessageBusOptions = {}) {
    this.maxHistorySize = options.maxHistorySize || 1000;
  }

  send(envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>): string {
    const fullEnvelope: MessageEnvelope = {
      messageId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...envelope
    };

    this.addToHistory(fullEnvelope);
    this.routeMessage(fullEnvelope);
    return fullEnvelope.messageId;
  }

  async request(
    envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>,
    timeoutMs: number = 30000
  ): Promise<MessageEnvelope> {
    const fullEnvelope: MessageEnvelope = {
      messageId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...envelope
    };

    this.addToHistory(fullEnvelope);
    const promise = this.createPendingRequest(fullEnvelope.messageId, timeoutMs);

    try {
      this.routeMessage(fullEnvelope);
      return await promise;
    } finally {
      this.pendingRequests.delete(fullEnvelope.messageId);
    }
  }

  subscribe(toModule: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(toModule)) {
      this.handlers.set(toModule, new Set());
    }

    this.handlers.get(toModule)?.add(handler);
    return () => this.unsubscribe(toModule, handler);
  }

  unsubscribe(toModule: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(toModule);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(toModule);
    }
  }

  reply(originalMessage: MessageEnvelope, payload: unknown, isError: boolean = false): string {
    return this.send({
      fromModule: originalMessage.toModule,
      toModule: originalMessage.fromModule,
      action: `${originalMessage.action}_reply`,
      payload: isError ? { error: payload } : { result: payload },
      replyTo: originalMessage.fromModule,
      context: originalMessage.context,
      traceId: originalMessage.traceId,
      inReplyTo: originalMessage.messageId,
      timeoutMs: originalMessage.timeoutMs
    });
  }

  resolvePendingRequest(messageId: string, response: MessageEnvelope): boolean {
    const pending = this.pendingRequests.get(messageId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeoutHandle);
    pending.resolve(response);
    return true;
  }

  getAllHistory(): ReadonlyArray<MessageEnvelope> {
    return this.messageHistory;
  }

  getStats(): MessageBusStats {
    return {
      totalHandlers: Array.from(this.handlers.values()).reduce((sum, handlers) => sum + handlers.size, 0),
      subscribedModules: this.handlers.size,
      pendingRequests: this.pendingRequests.size,
      historySize: this.messageHistory.length
    };
  }

  private routeMessage(envelope: MessageEnvelope): void {
    if (envelope.inReplyTo) {
      this.resolvePendingRequest(envelope.inReplyTo, envelope);
    }

    const handlers = this.handlers.get(envelope.toModule);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      void Promise.resolve(handler(envelope)).catch((error) => {
        console.error(`Error in message handler for ${envelope.toModule}:`, error);
      });
    }
  }

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

  private addToHistory(envelope: MessageEnvelope): void {
    this.messageHistory.push(envelope);
    while (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }
}

export function createMessageBus(options?: MessageBusOptions): MessageBus {
  return new MessageBus(options);
}