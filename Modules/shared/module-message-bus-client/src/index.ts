export interface MessageEnvelopeLike {
  fromModule: string;
  toModule: string;
  action: string;
  payload: unknown;
  replyTo: string;
  callbackTopic?: string;
  traceId: string;
  timeoutMs?: number;
  context: Record<string, unknown>;
}

export type MessageHandler<TEnvelope extends MessageEnvelopeLike = MessageEnvelopeLike> = (
  envelope: TEnvelope
) => void | Promise<void>;

export interface SSESubscriptionConfig<TEnvelope extends MessageEnvelopeLike = MessageEnvelopeLike> {
  onMessage: MessageHandler<TEnvelope>;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface SSESubscription {
  unsubscribe: () => void;
  isConnected: () => boolean;
}

export interface SendMessageConfig {
  toModule?: string;
  action: string;
  payload: unknown;
  replyTo?: string;
  callbackTopic?: string;
  traceId?: string;
  context?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SendMessageResult {
  success: boolean;
  messageId: string;
  timestamp: string;
  error?: string;
}

export interface ModuleMessageBusClientOptions {
  baseURL: string;
  module: string;
  requestTimeoutMs?: number;
  terminateOnPermanentDisconnect?: boolean;
}

export class ModuleMessageBusClient<TEnvelope extends MessageEnvelopeLike = MessageEnvelopeLike> {
  private readonly baseURL: string;
  private readonly module: string;
  private readonly requestTimeoutMs: number;
  private readonly terminateOnPermanentDisconnect: boolean;
  private isShuttingDown = false;

  constructor(options: ModuleMessageBusClientOptions) {
    this.baseURL = options.baseURL;
    this.module = options.module;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    this.terminateOnPermanentDisconnect = options.terminateOnPermanentDisconnect ?? true;
  }

  async send(config: SendMessageConfig): Promise<SendMessageResult> {
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
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

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

      return await response.json() as SendMessageResult;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async reply(
    originalEnvelope: TEnvelope,
    payload: unknown,
    isError: boolean = false
  ): Promise<SendMessageResult> {
    return this.send({
      toModule: originalEnvelope.replyTo || originalEnvelope.fromModule,
      action: isError ? 'error' : 'reply',
      payload: isError ? { error: payload } : { result: payload },
      replyTo: this.module,
      callbackTopic: originalEnvelope.callbackTopic,
      traceId: originalEnvelope.traceId,
      context: originalEnvelope.context,
      timeoutMs: originalEnvelope.timeoutMs
    });
  }

  subscribeSSE(
    options: {
      topics?: string[];
      filter?: {
        fromModule?: string;
        action?: string;
      };
    },
    config: SSESubscriptionConfig<TEnvelope>
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
        config.onConnected?.();
        reconnectAttempts = 0;

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
            isConnected = false;
            config.onDisconnected?.();

            if (config.autoReconnect !== false && reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++;
              reconnectTimeout = setTimeout(() => {
                if (!this.isShuttingDown) {
                  void connect();
                }
              }, reconnectDelay * reconnectAttempts);
            } else {
              this.handlePermanentDisconnect('SSE stream ended and cannot reconnect');
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
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
              if (currentData) {
                try {
                  const data = JSON.parse(currentData) as TEnvelope | { envelope?: TEnvelope };

                  if ('envelope' in data && data.envelope) {
                    void config.onMessage(data.envelope);
                  } else if (currentEvent === 'message' || currentEvent === 'callback') {
                    void config.onMessage(data as TEnvelope);
                  }
                } catch (error) {
                  config.onError?.(error as Error);
                }
              }
              currentEvent = '';
              currentData = '';
            }
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        isConnected = false;
        config.onError?.(error as Error);

        if (config.autoReconnect !== false && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          reconnectTimeout = setTimeout(() => {
            if (!this.isShuttingDown) {
              void connect();
            }
          }, reconnectDelay * reconnectAttempts);
        } else {
          this.handlePermanentDisconnect('SSE connection error and cannot reconnect');
        }
      }
    };

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

  shutdown(): void {
    this.isShuttingDown = true;
  }

  private handlePermanentDisconnect(message: string): void {
    if (!this.terminateOnPermanentDisconnect) {
      return;
    }

    setTimeout(() => {
      console.error(`[${this.module}] ${message}. Exiting...`);
      process.exit(1);
    }, 100);
  }
}

export function createMessageBusClient<TEnvelope extends MessageEnvelopeLike = MessageEnvelopeLike>(
  baseURL: string,
  module: string,
  options?: Omit<ModuleMessageBusClientOptions, 'baseURL' | 'module'>
): ModuleMessageBusClient<TEnvelope> {
  return new ModuleMessageBusClient<TEnvelope>({
    baseURL,
    module,
    ...options
  });
}