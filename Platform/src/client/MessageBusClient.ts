/**
 * 消息总线客户端 SDK
 *
 * 供各个模块使用，用于发送消息和订阅消息流
 */

import type { MessageEnvelope } from '../types.js';

/**
 * 消息处理回调
 */
export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

/**
 * 错误处理回调
 */
export type ErrorHandler = (error: Error) => void | Promise<void>;

/**
 * 订阅配置
 */
export interface SubscriptionConfig {
  /** 消息处理器 */
  onMessage: MessageHandler;
  /** 错误处理器 */
  onError?: ErrorHandler;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** 断开连接回调 */
  onDisconnected?: () => void;
  /** 是否自动重连 */
  autoReconnect?: boolean;
  /** 重连延迟（毫秒） */
  reconnectDelay?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

/**
 * 订阅对象
 */
export interface Subscription {
  /** 取消订阅 */
  unsubscribe: () => void;
  /** 是否已连接 */
  isConnected: () => boolean;
}

/**
 * 消息总线客户端配置
 */
export interface MessageBusClientConfig {
  /** 消息总线基础 URL */
  baseURL: string;
  /** 当前模块 ID */
  module: string;
  /** 默认超时时间（毫秒） */
  timeout?: number;
  /** 请求超时时间（毫秒） */
  requestTimeout?: number;
  /** 是否启用消息日志 */
  enableLogging?: boolean;
}

/**
 * 消息总线客户端类
 */
export class MessageBusClient {
  private readonly config: Required<MessageBusClientConfig>;
  private activeSubscriptions = new Set<EventSource>();
  private isShuttingDown = false;

  constructor(config: MessageBusClientConfig) {
    this.config = {
      baseURL: config.baseURL,
      module: config.module,
      timeout: config.timeout ?? 30000,
      requestTimeout: config.requestTimeout ?? 10000,
      enableLogging: config.enableLogging ?? false
    };
  }

  /**
   * 发送消息
   */
  async send(request: {
    toModule?: string;
    action: string;
    payload: unknown;
    replyTo?: string;
    callbackTopic?: string;
    traceId?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; error?: string }> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    const body = {
      ...request,
      fromModule: this.config.module
    };

    const url = `${this.config.baseURL}/messages`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as {
        success: boolean;
        messageId: string;
        timestamp: string;
        error?: string;
      };
      this.log('Sent message:', result);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      this.log('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * 订阅消息流 (SSE)
   */
  subscribe(
    options: {
      topics?: string[];
      filter?: {
        fromModule?: string;
        action?: string;
      };
    },
    config: SubscriptionConfig
  ): Subscription {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    const params = new URLSearchParams();
    params.append('module', this.config.module);

    if (options.topics) {
      for (const topic of options.topics) {
        params.append('topics', topic);
      }
    }

    if (options.filter?.fromModule) {
      params.append('filter.fromModule', options.filter.fromModule);
    }

    if (options.filter?.action) {
      params.append('filter.action', options.filter.action);
    }

    const url = `${this.config.baseURL}/subscribe?${params.toString()}`;

    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    const reconnectDelay = config.reconnectDelay ?? 1000;

    const createEventSource = () => {
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        this.log(`SSE connection opened for module: ${this.config.module}`);
        config.onConnected?.();
        reconnectAttempts = 0;
      };

      // 监听 message 事件
      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.envelope) {
            config.onMessage(data.envelope);
          }
        } catch (error) {
          this.log('Failed to parse SSE message:', error);
        }
      });

      // 监听 callback 事件
      eventSource.addEventListener('callback', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.envelope) {
            config.onMessage(data.envelope);
          }
        } catch (error) {
          this.log('Failed to parse SSE callback:', error);
        }
      });

      eventSource.addEventListener('error', (event) => {
        this.log('SSE error:', event);

        const shouldReconnect = config.autoReconnect !== false &&
          reconnectAttempts < maxReconnectAttempts;

        if (shouldReconnect && eventSource?.readyState === EventSource.CLOSED) {
          reconnectAttempts++;
          this.log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);

          setTimeout(() => {
            if (!this.isShuttingDown) {
              createEventSource();
            }
          }, reconnectDelay * reconnectAttempts);
        } else if (!shouldReconnect) {
          config.onError?.(new Error('SSE connection failed'));
          config.onDisconnected?.();
        }
      });

      // 心跳事件
      eventSource.addEventListener('heartbeat', () => {
        // 保持连接活跃
      });

      this.activeSubscriptions.add(eventSource);
    };

    createEventSource();

    return {
      unsubscribe: () => {
        if (eventSource) {
          eventSource.close();
          this.activeSubscriptions.delete(eventSource);
          eventSource = null;
        }
        config.onDisconnected?.();
      },
      isConnected: () => {
        return eventSource?.readyState === EventSource.OPEN;
      }
    };
  }

  /**
   * 关闭客户端
   */
  shutdown(): void {
    this.isShuttingDown = true;

    for (const eventSource of this.activeSubscriptions) {
      eventSource.close();
    }

    this.activeSubscriptions.clear();
  }

  /**
   * 日志输出
   */
  private log(...args: unknown[]): void {
    if (this.config.enableLogging) {
      console.log(`[MessageBusClient:${this.config.module}]`, ...args);
    }
  }
}

/**
 * 创建消息总线客户端
 */
export function createMessageBusClient(config: MessageBusClientConfig): MessageBusClient {
  return new MessageBusClient(config);
}
