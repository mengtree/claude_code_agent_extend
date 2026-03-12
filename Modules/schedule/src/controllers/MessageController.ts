import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMessageBusClient, type ModuleMessageBusClient } from '@agent-platform/module-message-bus-client';
import type { MessageEnvelope, MessageRequestHandler } from '../types/index.js';

interface PendingRequest {
  resolve: (envelope: MessageEnvelope) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class MessageController {
  private readonly handlers = new Map<string, MessageRequestHandler>();
  private messageBusClient?: ModuleMessageBusClient<MessageEnvelope>;
  private sseSubscription?: { unsubscribe: () => void };
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(
    private readonly moduleId: string,
    options?: {
      messageBusURL?: string;
      autoSubscribe?: boolean;
    }
  ) {
    if (options?.messageBusURL) {
      this.initMessageBus(options.messageBusURL, options.autoSubscribe ?? true);
    }
  }

  registerHandler(action: string, handler: MessageRequestHandler): void {
    this.handlers.set(action, handler);
  }

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
      return null;
    }

    return this.messageBusClient.send(config);
  }

  async requestFromBus(config: {
    toModule?: string;
    action: string;
    payload: unknown;
    replyTo?: string;
    callbackTopic?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<MessageEnvelope> {
    if (!this.messageBusClient) {
      throw new Error('Message bus client not initialized');
    }

    const traceId = randomUUID();
    const timeoutMs = config.timeoutMs ?? 120000;

    const pending = new Promise<MessageEnvelope>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(traceId);
        reject(new Error(`Message bus request timeout: ${traceId}`));
      }, timeoutMs);

      this.pendingRequests.set(traceId, {
        resolve,
        reject,
        timeoutHandle
      });
    });

    try {
      await this.messageBusClient.send({
        toModule: config.toModule,
        action: config.action,
        payload: config.payload,
        replyTo: config.replyTo ?? this.moduleId,
        callbackTopic: config.callbackTopic,
        traceId,
        context: config.context,
        timeoutMs
      });
    } catch (error) {
      const pendingRequest = this.pendingRequests.get(traceId);
      if (pendingRequest) {
        clearTimeout(pendingRequest.timeoutHandle);
        this.pendingRequests.delete(traceId);
      }
      throw error;
    }

    return pending;
  }

  shutdown(): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error('Message controller is shutting down'));
    }
    this.pendingRequests.clear();
    this.sseSubscription?.unsubscribe();
    this.messageBusClient?.shutdown();
  }

  async handleMessage(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const envelope = await this.readEnvelope(request);
      const handler = this.handlers.get(envelope.action);

      if (!handler) {
        throw new Error(`Unknown action: ${envelope.action}`);
      }

      const result = await handler(envelope);
      this.sendJson(response, 200, createReply(envelope, result ?? { ok: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private initMessageBus(baseURL: string, autoSubscribe: boolean): void {
    this.messageBusClient = createMessageBusClient<MessageEnvelope>(baseURL, this.moduleId);

    if (!autoSubscribe) {
      return;
    }

    this.sseSubscription = this.messageBusClient.subscribeSSE(
      {
        topics: [`module.${this.moduleId}.*`]
      },
      {
        onMessage: async (envelope) => {
          if (this.handlePendingReply(envelope)) {
            return;
          }

          const handler = this.handlers.get(envelope.action);

          if (!handler) {
            if ((envelope.action === 'reply' || envelope.action === 'error')) {
              return;
            }

            if (this.messageBusClient && envelope.replyTo) {
              await this.messageBusClient.reply(envelope, `Unknown action: ${envelope.action}`, true);
            }
            return;
          }

          try {
            const result = await handler(envelope);
            if (this.messageBusClient && envelope.replyTo && envelope.action !== 'reply' && envelope.action !== 'error') {
              await this.messageBusClient.reply(envelope, result);
            }
          } catch (error) {
            if (this.messageBusClient && envelope.replyTo && envelope.action !== 'reply' && envelope.action !== 'error') {
              await this.messageBusClient.reply(
                envelope,
                error instanceof Error ? error.message : String(error),
                true
              );
            }
          }
        },
        onError: (error) => {
          console.error(`[${this.moduleId}] Message bus error:`, error);
        },
        autoReconnect: true
      }
    );
  }

  private handlePendingReply(envelope: MessageEnvelope): boolean {
    const pending = this.pendingRequests.get(envelope.traceId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(envelope.traceId);

    if (envelope.action === 'error') {
      const payload = envelope.payload as { error?: unknown } | undefined;
      const message = typeof payload?.error === 'string'
        ? payload.error
        : JSON.stringify(payload?.error ?? 'Unknown message bus error');
      pending.reject(new Error(message));
      return true;
    }

    pending.resolve(envelope);
    return true;
  }

  private async readEnvelope(request: IncomingMessage): Promise<MessageEnvelope> {
    const bodyText = await new Promise<string>((resolve, reject) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => resolve(body));
      request.on('error', reject);
    });

    const body = bodyText.trim() ? JSON.parse(bodyText) as Partial<MessageEnvelope> : {};

    if (!body.action || !body.fromModule || !body.toModule || !body.replyTo) {
      throw new Error('Missing required fields in message envelope');
    }

    if (body.toModule !== this.moduleId) {
      throw new Error(`Message addressed to wrong module: ${body.toModule}`);
    }

    return {
      messageId: body.messageId || randomUUID(),
      traceId: body.traceId || randomUUID(),
      fromModule: body.fromModule,
      toModule: body.toModule,
      action: body.action,
      payload: body.payload,
      replyTo: body.replyTo,
      callbackTopic: body.callbackTopic,
      timeoutMs: body.timeoutMs,
      context: body.context || {},
      createdAt: body.createdAt || new Date().toISOString(),
      inReplyTo: body.inReplyTo
    };
  }

  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }
}

export function createReply(originalMessage: MessageEnvelope, payload: unknown, isError = false): MessageEnvelope {
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