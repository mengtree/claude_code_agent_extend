/**
 * Platform Core 消息客户端
 *
 * 负责通过统一消息 Envelope 与 platform-core 通信。
 */

import { randomUUID } from 'node:crypto';
import type { MessageEnvelope, PlatformCoreReplyPayload } from '../types/index.js';

/**
 * 发送用户消息的请求参数
 */
export interface SendUserMessageOptions {
  sessionId: string;
  message: string;
  claudeSessionId?: string;
  timeoutMs?: number;
}

/**
 * 平台消息客户端
 */
export class PlatformCoreMessageClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * 向 platform-core 发送用户消息
   */
  async sendUserMessage(options: SendUserMessageOptions): Promise<PlatformCoreReplyPayload> {
    const envelope: MessageEnvelope = {
      messageId: randomUUID(),
      traceId: randomUUID(),
      fromModule: 'sessions',
      toModule: 'platform-core',
      action: 'submit_user_message',
      payload: {
        message: options.message,
        timeoutMs: options.timeoutMs,
        claudeSessionId: options.claudeSessionId
      },
      replyTo: 'sessions',
      timeoutMs: options.timeoutMs ?? 120000,
      context: {
        sessionId: options.sessionId,
        claudeSessionId: options.claudeSessionId
      },
      createdAt: new Date().toISOString()
    };

    const response = await fetch(new URL('/messages', this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope)
    });

    const payload = await response.json() as MessageEnvelope | { error?: unknown; ok?: boolean };

    if (this.isMessageEnvelope(payload)) {
      const envelopeError = this.extractEnvelopeError(payload);
      if (envelopeError) {
        throw new Error(envelopeError);
      }
    }

    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String(payload.error)
        : `platform-core request failed with status ${response.status}`;
      throw new Error(message);
    }

    if (!this.isMessageEnvelope(payload)) {
      throw new Error('platform-core returned an invalid message envelope');
    }

    if (payload.inReplyTo !== envelope.messageId) {
      throw new Error('platform-core reply does not match the original request');
    }

    if (payload.action !== 'submit_user_message_reply') {
      throw new Error(`Unexpected reply action from platform-core: ${payload.action}`);
    }

    const result = payload.payload as { result?: PlatformCoreReplyPayload; error?: unknown };

    if (result && result.error) {
      throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
    }

    if (!result || !result.result) {
      throw new Error('platform-core reply does not contain a result payload');
    }

    return result.result;
  }

  /**
   * 从 reply envelope 提取错误信息
   */
  private extractEnvelopeError(envelope: MessageEnvelope): string | null {
    const payload = envelope.payload as { error?: unknown } | undefined;
    if (!payload || payload.error === undefined) {
      return null;
    }

    if (typeof payload.error === 'string') {
      return payload.error;
    }

    if (payload.error && typeof payload.error === 'object' && 'message' in payload.error) {
      return String((payload.error as { message: unknown }).message);
    }

    return JSON.stringify(payload.error);
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
}