/**
 * 平台核心模块主入口
 *
 * 本模块是平台的核心，提供：
 * - 模块运行时管理（Module Registry、Message Bus、Module Supervisor）
 * - Claude CLI SDK 对接能力
 * - 流式传输（SSE）支持
 * - HTTP API
 *
 * @module platform-core
 */

import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import { ClaudeSdkService } from './services/ClaudeSdkService.js';
import { SessionModel } from './models/Session.js';
import { QueryController } from './controllers/QueryController.js';
import { SessionController } from './controllers/SessionController.js';
import { HealthController } from './controllers/HealthController.js';
import { createRouter } from './routes/Router.js';
import { createLogger } from './utils/Logger.js';
import { getConfig } from './utils/Config.js';
import { createPlatformCoreRuntime, PlatformCoreRuntime } from './runtime/PlatformCoreRuntime.js';

/**
 * 平台核心应用类
 */
export class PlatformCoreApp {
  private readonly config: Awaited<ReturnType<typeof getConfig>>;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly runtime: PlatformCoreRuntime;
  private readonly sdkService: ClaudeSdkService;
  private readonly sessionModel: SessionModel;
  private readonly queryController: QueryController;
  private readonly sessionController: SessionController;
  private readonly healthController: HealthController;
  private readonly router: ReturnType<typeof createRouter>;
  private defaultSessionId?: string;

  constructor(config: ModuleConfig) {
    this.config = config as Awaited<ReturnType<typeof getConfig>>;
    this.logger = createLogger(this.config.logLevel);

    // 1. 创建平台核心运行时（负责模块管理）
    // modulesRoot 应该是 Modules 目录，即当前目录的父目录
    const modulesRoot = resolve(cwd(), '..');
    this.runtime = createPlatformCoreRuntime({
      modulesRoot,
      logLevel: this.config.logLevel,
      healthCheckInterval: 15000,
      maxRestarts: 3,
      restartBackoffMs: 5000
    });

    // 获取数据目录路径
    const workspacePath = cwd();
    const dataDir = resolve(workspacePath, 'Modules', 'platform-core', 'runtime', 'data');

    // 初始化服务
    this.sdkService = new ClaudeSdkService();
    this.sessionModel = new SessionModel({ dataDir });

    // 初始化控制器
    this.queryController = new QueryController(
      this.sdkService,
      () => this.defaultSessionId
    );
    this.sessionController = new SessionController(this.sessionModel);
    this.healthController = new HealthController('0.1.0');

    // 初始化路由器
    this.router = createRouter(
      this.queryController,
      this.sessionController,
      this.healthController,
      this.sessionModel
    );
  }

  /**
   * 启动应用
   */
  async start(): Promise<void> {
    this.logger.info('Starting Platform Core Module...');

    // 1. 启动平台核心运行时（扫描并加载所有模块）
    this.logger.info('Initializing Platform Core Runtime...');
    await this.runtime.start();

    // 2. 初始化会话存储
    await this.sessionModel.initialize();
    this.logger.info('Session storage initialized');

    // 3. 设置默认会话 ID（可选）
    // this.defaultSessionId = await this.getOrCreateDefaultSession();

    // 4. 启动 HTTP 服务器
    const { port, host } = this.config;
    
    this.logger.info(`Platform Core Module: Starting HTTP server on http://${host}:${port}...`);
    await this.router.listen(port, host);

    this.logger.info(`Platform Core Module started on http://${host}:${port}`);
    this.logger.info(`Health check: http://${host}:${port}/health`);
    this.logger.info('Runtime status:', this.runtime.getStatus());

    // 设置优雅关闭
    this.setupGracefulShutdown();
  }

  /**
   * 停止应用
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Platform Core Module...');

    // 取消所有活动查询
    this.sdkService.cancelAllQueries();

    // 停止 HTTP 服务器
    await this.router.close();

    // 停止平台核心运行时（停止所有模块）
    await this.runtime.stop();

    this.logger.info('Platform Core Module stopped');
  }

  /**
   * 获取或创建默认会话
   */
  // @ts-ignore - 方法保留供未来使用
  private async getOrCreateDefaultSession(): Promise<string | undefined> {
    try {
      // 尝试获取第一个活跃会话
      const sessions = await this.sessionModel.list({
        limit: 1,
        status: 'active'
      });

      if (sessions.length > 0) {
        return sessions[0].id;
      }

      // 创建新会话
      const newSession = await this.sessionModel.create({});
      this.logger.info(`Created default session: ${newSession.id}`);
      return newSession.id;
    } catch (error) {
      this.logger.error('Failed to get or create default session:', error);
      return undefined;
    }
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

  /**
   * 获取平台核心运行时
   */
  getRuntime(): PlatformCoreRuntime {
    return this.runtime;
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
export { ModuleRegistry } from './registry/ModuleRegistry.js';
export { MessageBus, createMessageBus } from './messaging/MessageBus.js';
export { ModuleSupervisor } from './supervisor/ModuleSupervisor.js';
export { createPlatformCoreRuntime, PlatformCoreRuntime } from './runtime/PlatformCoreRuntime.js';

// 类型导入（用于 TypeScript）
import type { ModuleConfig } from './types/index.js';
