/**
 * Sessions Module - 会话管理模块主入口
 *
 * 本模块负责：
 * - 会话创建、查询、管理和删除
 * - 多渠道会话映射
 * - 与核心平台的消息总线通信
 * - HTTP API 服务
 *
 * @module sessions
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionModel } from './models/Session.js';
import { SessionController } from './controllers/SessionController.js';
import { HealthController } from './controllers/HealthController.js';
import { MessageController } from './controllers/MessageController.js';
import { PlaygroundController } from './controllers/PlaygroundController.js';
import { PlatformCoreMessageClient } from './services/PlatformCoreMessageClient.js';
import { AsyncMessageService } from './services/AsyncMessageService.js';
import { SSEManager } from './services/SSEManager.js';
import { createRouter } from './routes/Router.js';
import { createLogger } from './utils/Logger.js';
import { getConfig } from './utils/Config.js';
import type { SessionsConfig } from './types/index.js';

/**
 * Sessions 模块应用类
 */
export class SessionsApp {
  private readonly config: Awaited<ReturnType<typeof getConfig>>;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly sessionModel: SessionModel;
  private readonly sessionController: SessionController;
  private readonly healthController: HealthController;
  private readonly messageController: MessageController;
  private readonly playgroundController: PlaygroundController;
  private readonly platformCoreClient: PlatformCoreMessageClient;
  private readonly asyncMessageService: AsyncMessageService;
  private readonly sseManager: SSEManager;
  private readonly router: ReturnType<typeof createRouter>;
  private isStopping = false;
  private isInitialized = false;
  private readonly routePrefix: string;

  constructor(config: SessionsConfig, options?: { moduleRoot?: string; routePrefix?: string; platformBaseUrl?: string }) {
    this.config = config as Awaited<ReturnType<typeof getConfig>>;
    this.logger = createLogger(this.config.logLevel);
    this.routePrefix = options?.routePrefix || '/plugin/sessions';
    const moduleRoot = options?.moduleRoot || resolve(fileURLToPath(new URL('..', import.meta.url)));

    // 获取数据目录路径
    const dataDir = isAbsolute(this.config.dataDir)
      ? this.config.dataDir
      : resolve(moduleRoot, this.config.dataDir);

    // 初始化模型
    this.sessionModel = new SessionModel({ dataDir });
    this.platformCoreClient = new PlatformCoreMessageClient(options?.platformBaseUrl || this.config.platformCoreUrl);

    // 初始化异步消息服务
    this.asyncMessageService = new AsyncMessageService(
      this.sessionModel,
      this.platformCoreClient,
      (this.config as any).asyncMessage || {
        maxConcurrentTasks: 10,
        taskTimeoutMs: 300000, // 5 分钟
        maxRetries: 2
      }
    );

    // 初始化 SSE 管理器
    this.sseManager = new SSEManager();
    this.asyncMessageService.setSSEManager(this.sseManager);

    // 初始化控制器
    this.sessionController = new SessionController(
      this.sessionModel,
      this.platformCoreClient,
      this.asyncMessageService,
      this.sseManager
    );
    this.healthController = HealthController ? new HealthController('0.1.0') : null as any;

    // 初始化消息控制器（连接到 Platform 消息总线）
    const messageBusURL = this.config.messageBusURL || 'http://localhost:3000';
    this.messageController = new MessageController('sessions', {
      messageBusURL,
      autoSubscribe: true
    });

    this.playgroundController = new PlaygroundController(this.routePrefix);

    // 设置消息处理
    this.setupMessageHandlers();

    // 初始化路由器
    this.router = createRouter({
      sessionController: this.sessionController,
      healthController: this.healthController,
      messageController: this.messageController,
      playgroundController: this.playgroundController,
      sessionModel: this.sessionModel
    });
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    // 注册消息处理器
    this.messageController.registerHandler('create_session', async (envelope) => {
      const payload = envelope.payload as {
        externalSource?: string;
        externalConversationId?: string;
      };

      const session = await this.sessionModel.create(payload);

      this.logger.info(`Created session: ${session.id}`);

      // TODO: 发送回复给核心平台
      // 这里需要实现与 platform-core 的消息总线通信
    });

    this.messageController.registerHandler('get_session', async (envelope) => {
      const payload = envelope.payload as { sessionId: string };
      const session = await this.sessionModel.findById(payload.sessionId);

      if (!session) {
        this.logger.warn(`Session not found: ${payload.sessionId}`);
        return;
      }

      this.logger.info(`Retrieved session: ${session.id}`);
      // TODO: 发送回复
    });

    this.messageController.registerHandler('list_sessions', async (envelope) => {
      const payload = envelope.payload as {
        limit?: number;
        status?: 'active' | 'deleted';
      };

      const sessions = await this.sessionModel.list(payload);

      this.logger.info(`Listed sessions: ${sessions.length} sessions`);
      // TODO: 发送回复
    });

    this.messageController.registerHandler('delete_session', async (envelope) => {
      const payload = envelope.payload as { sessionId: string };
      const deleted = await this.sessionModel.delete(payload.sessionId);

      if (deleted) {
        this.logger.info(`Deleted session: ${payload.sessionId}`);
      } else {
        this.logger.warn(`Session not found for deletion: ${payload.sessionId}`);
      }
      // TODO: 发送回复
    });

    this.messageController.registerHandler('find_by_external', async (envelope) => {
      const payload = envelope.payload as {
        source: string;
        conversationId: string;
      };

      const session = await this.sessionModel.findByExternalMapping(
        payload.source,
        payload.conversationId
      );

      if (session) {
        this.logger.info(`Found session by external mapping: ${session.id}`);
      } else {
        this.logger.info(`No session found for external mapping: ${payload.source}/${payload.conversationId}`);
      }
      // TODO: 发送回复
    });

    this.messageController.registerHandler('update_session', async (envelope) => {
      const payload = envelope.payload as {
        sessionId: string;
        claudeSessionId?: string;
        status?: 'active' | 'deleted';
      };

      const session = await this.sessionModel.update(
        payload.sessionId,
        {
          claudeSessionId: payload.claudeSessionId,
          status: payload.status
        }
      );

      if (session) {
        this.logger.info(`Updated session: ${session.id}`);
      } else {
        this.logger.warn(`Session not found for update: ${payload.sessionId}`);
      }
      // TODO: 发送回复
    });
  }

  /**
   * 启动应用
   */
  async start(): Promise<void> {
    this.logger.info('Starting Sessions Module...');

    await this.initialize();

    // 启动 HTTP 服务器
    const { port, host } = this.config;

    this.logger.info(`Sessions Module: Starting HTTP server on http://${host}:${port}...`);

    await this.router.listen(port, host);

    this.logger.info(`Sessions Module started on http://${host}:${port}`);
    this.logger.info(`Health check: http://${host}:${port}/health`);
  this.logger.info(`Playground: ${this.routePrefix}`);
    this.logger.info(`Platform Core Messages: ${this.config.platformCoreUrl}/messages`);
    this.logger.info('Ready to accept requests');

    // 设置优雅关闭
    this.setupGracefulShutdown();
  }

  /**
   * 停止应用
   */
  async stop(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;
    this.logger.info('Stopping Sessions Module...');

    // 停止 HTTP 服务器
    await this.router.close();

    // 关闭异步消息服务
    this.asyncMessageService.shutdown();

    // 关闭 SSE 管理器
    this.sseManager.shutdown();

    // 关闭消息控制器
    this.messageController.shutdown();

    this.logger.info('Sessions Module stopped');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.sessionModel.initialize();
    this.logger.info('Session storage initialized');
    this.isInitialized = true;
  }

  async handleHttpRequest(subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<boolean> {
    await this.initialize();
    await this.router.handle(request, response, subPath);
    return true;
  }

  /**
   * 设置优雅关闭
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    // 加载配置
    const config = await getConfig();

    // 创建并启动应用
    const app = new SessionsApp(config);
    await app.start();

  } catch (error) {
    console.error('Failed to start Sessions Module:', error);
    process.exit(1);
  }
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  const entryPath = resolve(process.argv[1]);
  const modulePath = resolve(fileURLToPath(import.meta.url));

  return entryPath === modulePath;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

// 导出类型和类
export * from './types/index.js';
export { SessionModel } from './models/Session.js';
export { SessionController } from './controllers/SessionController.js';
export { HealthController } from './controllers/HealthController.js';
export { MessageController } from './controllers/MessageController.js';
export { createRouter } from './routes/Router.js';
export { createLogger } from './utils/Logger.js';
export { getConfig, loadConfig, loadConfigFromEnv } from './utils/Config.js';

export async function createPlugin(context: {
  modulePath: string;
  routePrefix: string;
  platformBaseUrl: string;
  config: Record<string, unknown>;
}): Promise<{
  initialize: () => Promise<void>;
  dispose: () => Promise<void>;
  handleHttpRequest: (subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<boolean>;
  getMetadata: () => { displayName: string; description: string; hasUi: true; homePath: string };
}> {
  const app = new SessionsApp(context.config as SessionsConfig, {
    moduleRoot: context.modulePath,
    routePrefix: context.routePrefix,
    platformBaseUrl: context.platformBaseUrl
  });

  return {
    initialize: async () => {
      await app.initialize();
    },
    dispose: async () => {
      await app.stop();
    },
    handleHttpRequest: async (subPath, request, response) => app.handleHttpRequest(subPath, request, response),
    getMetadata: () => ({
      displayName: 'Sessions 对话面板',
      description: '会话管理与异步对话插件',
      hasUi: true,
      homePath: '/playground'
    })
  };
}
