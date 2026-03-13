/**
 * 平台核心模块主入口
 *
 * 本模块是平台中的智能体核心，提供：
 * - Claude CLI SDK 对接能力
 * - 流式传输（SSE）支持
 * - HTTP API
 * - 消息总线通讯
 *
 * @module platform-core
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeSdkService } from './services/ClaudeSdkService.js';
import { SessionModel } from './models/Session.js';
import { QueryController } from './controllers/QueryController.js';
import { SessionController } from './controllers/SessionController.js';
import { HealthController } from './controllers/HealthController.js';
import { MessageController, createReply } from './controllers/MessageController.js';
import { createRouter } from './routes/Router.js';
import { createLogger } from './utils/Logger.js';
import { getConfig } from './utils/Config.js';

/**
 * 平台核心应用类
 */
export class PlatformCoreApp {
  private readonly config: Awaited<ReturnType<typeof getConfig>>;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly sdkService: ClaudeSdkService;
  private readonly sessionModel: SessionModel;
  private readonly queryController: QueryController;
  private readonly sessionController: SessionController;
  private readonly healthController: HealthController;
  private readonly messageController: MessageController;
  private readonly router: ReturnType<typeof createRouter>;
  private readonly moduleRoot: string;
  private isInitialized = false;

  constructor(config: ModuleConfig, options?: { moduleRoot?: string }) {
    this.config = config as Awaited<ReturnType<typeof getConfig>>;
    this.logger = createLogger(this.config.logLevel);
    this.moduleRoot = options?.moduleRoot || resolve(fileURLToPath(new URL('..', import.meta.url)));

    // 获取数据目录路径
    const dataDir = resolve(this.moduleRoot, 'runtime', 'data');

    // 初始化服务
    this.sdkService = new ClaudeSdkService();
    this.sessionModel = new SessionModel({ dataDir });

    // 初始化控制器
    this.queryController = new QueryController(this.sdkService);
    this.sessionController = new SessionController(this.sessionModel);
    this.healthController = new HealthController('0.1.0');

    // 初始化消息控制器（可选：连接到 Platform 消息总线）
    const messageBusURL = (config as any).messageBusURL; // 从配置获取
    this.messageController = new MessageController('platform-core', {
      messageBusURL,
      autoSubscribe: true
    });

    this.setupMessageHandlers();

    // 初始化路由器
    this.router = createRouter(
      this.queryController,
      this.sessionController,
      this.healthController,
      this.messageController,
      this.sessionModel
    );
  }

  /**
   * 注册通用消息处理器
   */
  private setupMessageHandlers(): void {
    this.messageController.registerHandler('submit_user_message', async (envelope) => {
      const payload = envelope.payload as {
        message?: string;
        systemPrompt?: string;
        model?: string;
        timeoutMs?: number;
        claudeSessionId?: string;
        workingDirectory?: string;
      };
      const context = envelope.context as {
        sessionId?: string;
        claudeSessionId?: string;
        workingDirectory?: string;
      };

      if (!payload.message || typeof payload.message !== 'string') {
        throw new Error('payload.message is required');
      }

      const result = await this.sdkService.execute({
        prompt: payload.message,
        sessionId: context.sessionId,
        claudeSessionId: payload.claudeSessionId || context.claudeSessionId,
        systemPrompt: payload.systemPrompt,
        model: payload.model,
        timeoutMs: payload.timeoutMs,
        workingDirectory: payload.workingDirectory || context.workingDirectory || this.moduleRoot
      });

      return createReply(envelope, {
        ok: result.ok,
        response: result.result,
        sessionId: result.sessionId,
        claudeSessionId: result.claudeSessionId,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        stopReason: result.stopReason,
        raw: result.raw
      });
    });
  }

  /**
   * 启动应用
   */
  async start(): Promise<void> {
    this.logger.info('Starting Platform Core Agent Module...');

    await this.initialize();

    // 启动 HTTP 服务器
    const { port, host } = this.config;
    
    this.logger.info(`Platform Core Module: Starting HTTP server on http://${host}:${port}...`);
    await this.router.listen(port, host);

    this.logger.info(`Platform Core Module started on http://${host}:${port}`);
    this.logger.info(`Health check: http://${host}:${port}/health`);

    // 设置优雅关闭
    this.setupGracefulShutdown();
  }

  /**
   * 停止应用
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Platform Core Agent Module...');

    // 取消所有活动查询
    this.sdkService.cancelAllQueries();
    this.messageController.shutdown();

    // 停止 HTTP 服务器
    await this.router.close();

    this.logger.info('Platform Core Module stopped');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.sessionModel.initialize();
    this.logger.info('Session storage initialized');
    this.isInitialized = true;
  }

  async handleHttpRequest(subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    await this.initialize();
    await this.router.handle(request, response, subPath);
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
    const app = new PlatformCoreApp(config);
    await app.start();

  } catch (error) {
    console.error('Failed to start Platform Core Module:', error);
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
export { ClaudeSdkService } from './services/ClaudeSdkService.js';
export { SessionModel } from './models/Session.js';
export { QueryController } from './controllers/QueryController.js';
export { SessionController } from './controllers/SessionController.js';
export { HealthController } from './controllers/HealthController.js';
export { createRouter } from './routes/Router.js';
export { createLogger } from './utils/Logger.js';
export { getConfig, loadConfig, loadConfigFromEnv } from './utils/Config.js';

// 类型导入（用于 TypeScript）
import type { ModuleConfig } from './types/index.js';

export async function createPlugin(context: {
  modulePath: string;
  config: Record<string, unknown>;
}): Promise<{
  initialize: () => Promise<void>;
  dispose: () => Promise<void>;
  handleHttpRequest: (subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<boolean>;
  getMetadata: () => { displayName: string; description: string; hasUi: false; homePath: string };
}> {
  const config = context.config as ModuleConfig;
  const app = new PlatformCoreApp(config, { moduleRoot: context.modulePath });

  return {
    initialize: async () => {
      await app.initialize();
    },
    dispose: async () => {
      await app.stop();
    },
    handleHttpRequest: async (subPath, request, response) => {
      await app.handleHttpRequest(subPath, request, response);
      return true;
    },
    getMetadata: () => ({
      displayName: 'Platform Core',
      description: 'Claude SDK 查询、会话和消息回复能力',
      hasUi: false,
      homePath: '/health'
    })
  };
}
