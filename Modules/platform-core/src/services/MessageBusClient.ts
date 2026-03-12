/**
 * 消息总线客户端服务
 *
 * 供模块使用，通过 Platform 消息总线进行模块间通信
 */

import type { MessageEnvelope } from '../types/index.js';

/**
 * 消息处理回调
 */
export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

/**
 * SSE 订阅配置
 */
export interface SSESubscriptionConfig {
  /** 消息处理器 */
  onMessage: MessageHandler;
  /** 错误处理器 */
  onError?: (error: Error) => void;
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
 * SSE 订阅对象
 */
export interface SSESubscription {
  /** 取消订阅 */
  unsubscribe: () => void;
  /** 是否已连接 */
  isConnected: () => boolean;
}

/**
 * 发送消息配置
 */
export interface SendMessageConfig {
  /** 目标模块 */
  toModule?: string;
  /** 动作名称 */
  action: string;
  /** 消息载荷 */
  payload: unknown;
  /** 回复给哪个模块 */
  replyTo?: string;
  /** 回调主题 */
  callbackTopic?: string;
  /** 追踪 ID */
  traceId?: string;
  /** 上下文信息 */
  context?: Record<string, unknown>;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * 消息总线客户端类
 */
export class MessageBusClient {
  private readonly baseURL: string;
  private readonly module: string;
  private activeSubscriptions = new Set<EventSource>();
  private isShuttingDown = false;

  constructor(baseURL: string, module: string) {
    this.baseURL = baseURL;
    this.module = module;
  }

  /**
   * 发送消息到消息总线
   */
  async send(config: SendMessageConfig): Promise<{
    success: boolean;
    messageId: string;
    timestamp: string;
    error?: string;
  }> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    const body = {
      fromModule: this.module,
      toModule: config.toModule,
      action: config.action,
      payload: config.payload,
      replyTo: config.replyTo,
      callbackTopic: config.callbackTopic,
      traceId: config.traceId,
      context: config.context,
      timeoutMs: config.timeoutMs
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 发送回复消息
   */
  async reply(
    originalEnvelope: MessageEnvelope,
    payload: unknown,
    isError: boolean = false
  ): Promise<{ success: boolean; messageId: string; timestamp: string; error?: string }> {
    return this.send({
      toModule: originalEnvelope.replyTo || originalEnvelope.fromModule,
      action: isError ? 'error' : 'reply',
      payload: isError ? { error: payload } : { result: payload },
      replyTo: this.module,
      callbackTopic: originalEnvelope.callbackTopic,
      traceId: originalEnvelope.traceId,
      context: originalEnvelope.context as Record<string, unknown>,
      timeoutMs: originalEnvelope.timeoutMs
    });
  }

  /**
   * 订阅消息流 (SSE)
   *
   * Node.js 版本使用 fetch + ReadableStream 实现
   */
  subscribeSSE(
    options: {
      topics?: string[];
      filter?: {
        fromModule?: string;
        action?: string;
      };
    },
    config: SSESubscriptionConfig
  ): SSESubscription {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    const params = new URLSearchParams();
    params.append('module', this.module);

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

    const url = `${this.baseURL}/subscribe?${params.toString()}`;

    let abortController: AbortController | null = null;
    let isConnected = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    const reconnectDelay = config.reconnectDelay ?? 1000;

    const connect = async () => {
      if (this.isShuttingDown) {
        return;
      }

      abortController = new AbortController();

      try {
        const response = await fetch(url, {
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        isConnected = true;
        console.log(`[${this.module}] SSE connection opened`);
        config.onConnected?.();
        reconnectAttempts = 0;

        // 读取流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (this.isShuttingDown) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();

          if (done) {
            console.log(`[${this.module}] SSE stream ended`);
            isConnected = false;
            config.onDisconnected?.();

            // 尝试重连
            if (config.autoReconnect !== false && reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++;
              console.log(`[${this.module}] Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
              reconnectTimeout = setTimeout(() => {
                if (!this.isShuttingDown) {
                  void connect();
                }
              }, reconnectDelay * reconnectAttempts);
            } else {
              // 无法重连，自动退出模块进程
              console.error(`[${this.module}] SSE stream ended and cannot reconnect. Exiting...`);
              setTimeout(() => {
                process.exit(1);
              }, 100);
            }
            break;
          }

          // 解码数据
          buffer += decoder.decode(value, { stream: true });

          // 处理 SSE 格式
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6).trim();
            } else if (line === '') {
              // 空行表示事件结束
              if (currentData) {
                try {
                  const data = JSON.parse(currentData);

                  // 处理不同类型的事件
                  if (data.envelope) {
                    void config.onMessage(data.envelope);
                  } else if (currentEvent === 'connected') {
                    console.log(`[${this.module}] SSE connected:`, data);
                  } else if (currentEvent === 'heartbeat') {
                    // 心跳，保持连接
                  }
                } catch (error) {
                  console.error(`[${this.module}] Failed to parse SSE data:`, error);
                }
              }
              currentEvent = '';
              currentData = '';
            }
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          console.log(`[${this.module}] SSE connection aborted`);
        } else {
          console.error(`[${this.module}] SSE connection error:`, error);
          isConnected = false;
          config.onError?.(error as Error);

          // 尝试重连
          if (config.autoReconnect !== false && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`[${this.module}] Reconnecting after error... (${reconnectAttempts}/${maxReconnectAttempts})`);
            reconnectTimeout = setTimeout(() => {
              if (!this.isShuttingDown) {
                void connect();
              }
            }, reconnectDelay * reconnectAttempts);
          } else {
            // 无法重连，自动退出模块进程
            console.error(`[${this.module}] SSE connection error and cannot reconnect. Exiting...`);
            setTimeout(() => {
              process.exit(1);
            }, 100);
          }
        }
      }
    };

    // 开始连接
    void connect();

    return {
      unsubscribe: () => {
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        if (abortController) {
          abortController.abort();
        }
        isConnected = false;
        config.onDisconnected?.();
      },
      isConnected: () => isConnected
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
}

/**
 * 创建消息总线客户端
 */
export function createMessageBusClient(
  baseURL: string,
  module: string
): MessageBusClient {
  return new MessageBusClient(baseURL, module);
}
