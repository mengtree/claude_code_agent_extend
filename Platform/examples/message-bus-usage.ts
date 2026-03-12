/**
 * 消息总线使用示例
 *
 * 展示如何在模块中使用消息总线客户端进行通讯
 */

import { createMessageBusClient } from '../src/client/MessageBusClient.js';
import type { MessageEnvelope } from '../src/types.js';

// ==================== 示例 1: 基本发送和订阅 ====================

async function basicExample() {
  // 创建客户端（platform-core 模块）
  const client = createMessageBusClient({
    baseURL: 'http://localhost:3000',
    module: 'platform-core',
    enableLogging: true
  });

  // 订阅所有发给我的消息
  const subscription = client.subscribe(
    {
      topics: ['module.platform-core.*'] // 订阅发给我的所有消息
    },
    {
      onMessage: async (envelope: MessageEnvelope) => {
        console.log('Received message:', envelope);
        console.log('From:', envelope.fromModule);
        console.log('Action:', envelope.action);
        console.log('Payload:', envelope.payload);

        // 处理消息...

        // 如果需要回复
        await client.send({
          toModule: envelope.fromModule,
          action: 'response',
          payload: { result: 'OK' },
          callbackTopic: `module.${envelope.fromModule}.reply`,
          context: envelope.context as Record<string, unknown>
        });
      },
      onError: (error) => {
        console.error('Subscription error:', error);
      },
      onConnected: () => {
        console.log('Connected to message bus');
      },
      onDisconnected: () => {
        console.log('Disconnected from message bus');
      },
      autoReconnect: true
    }
  );

  // 发送消息给 sessions 模块
  await client.send({
    toModule: 'sessions',
    action: 'create_session',
    payload: {
      userId: 'user-001',
      title: 'My Session'
    },
    callbackTopic: 'module.platform-core.reply',
    context: {
      sessionId: 'session-123',
      userId: 'user-001'
    }
  });

  // 清理
  // subscription.unsubscribe();
}

// ==================== 示例 2: 使用过滤器订阅 ====================

async function filteredSubscriptionExample() {
  const client = createMessageBusClient({
    baseURL: 'http://localhost:3000',
    module: 'platform-core'
  });

  // 只订阅来自 sessions 模块的 create_session 动作
  const subscription = client.subscribe(
    {
      filter: {
        fromModule: 'sessions',
        action: 'create_session'
      }
    },
    {
      onMessage: (envelope) => {
        console.log('New session created:', envelope.payload);
      }
    }
  );
}

// ==================== 示例 3: 广播消息 ====================

async function broadcastExample() {
  const client = createMessageBusClient({
    baseURL: 'http://localhost:3000',
    module: 'platform-core'
  });

  // 广播消息给所有订阅者（不指定 toModule）
  await client.send({
    action: 'system_shutdown',
    payload: { reason: 'maintenance' },
    callbackTopic: 'system.events'
  });
}

// ==================== 示例 4: 在模块控制器中使用 ====================

class SessionController {
  private messageBus: ReturnType<typeof createMessageBusClient>;

  constructor() {
    this.messageBus = createMessageBusClient({
      baseURL: 'http://localhost:3000',
      module: 'sessions'
    });

    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    // 订阅发给我的消息
    this.messageBus.subscribe(
      {
        topics: ['module.sessions.*']
      },
      {
        onMessage: this.handleMessage.bind(this)
      }
    );
  }

  private async handleMessage(envelope: MessageEnvelope) {
    switch (envelope.action) {
      case 'create_session':
        await this.createSession(envelope);
        break;
      case 'get_session':
        await this.getSession(envelope);
        break;
      default:
        console.warn('Unknown action:', envelope.action);
    }
  }

  private async createSession(envelope: MessageEnvelope) {
    const payload = envelope.payload as {
      userId?: string;
      title?: string;
    };

    // 创建会话逻辑...

    // 发送响应
    await this.messageBus.send({
      toModule: envelope.fromModule,
      action: 'session_created',
      payload: {
        sessionId: 'new-session-id',
        success: true
      },
      callbackTopic: `module.${envelope.fromModule}.reply`,
      context: envelope.context as Record<string, unknown>
    });
  }

  private async getSession(envelope: MessageEnvelope) {
    const payload = envelope.payload as {
      sessionId?: string;
    };

    // 获取会话逻辑...

    await this.messageBus.send({
      toModule: envelope.fromModule,
      action: 'session_data',
      payload: {
        sessionId: payload.sessionId
      },
      callbackTopic: `module.${envelope.fromModule}.reply`,
      context: envelope.context as Record<string, unknown>
    });
  }
}

export {
  basicExample,
  filteredSubscriptionExample,
  broadcastExample,
  SessionController
};
