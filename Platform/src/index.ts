import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPlatformRuntime } from './runtime/PlatformRuntime.js';
import { getConfig } from './utils/Config.js';
import { createLogger } from './utils/Logger.js';
import { ControlServer } from './control/ControlServer.js';

const VERSION = '0.1.0';

class PlatformApp {
  private readonly logger;
  private readonly runtime;
  private readonly controlServer;

  constructor(private readonly config: Awaited<ReturnType<typeof getConfig>>) {
    this.logger = createLogger(config.logLevel);
    this.runtime = createPlatformRuntime({
      modulesRoot: config.modulesRoot,
      healthCheckInterval: config.healthCheckInterval,
      maxRestarts: config.maxRestarts,
      restartBackoffMs: config.restartBackoffMs,
      logLevel: config.logLevel,
      moduleStartDelayMs: config.moduleStartDelayMs,
      startupDelayMs: config.startupDelayMs
    });
    this.controlServer = new ControlServer(this.runtime, VERSION, config.logLevel);
  }

  async start(): Promise<void> {
    this.logger.info('[PlatformApp] Starting platform bus...');
    await this.runtime.start();
    await this.controlServer.listen(this.config.port, this.config.host);
    this.logger.info(`[PlatformApp] Control plane started at http://${this.config.host}:${this.config.port}`);
    this.setupGracefulShutdown();
  }

  async stop(): Promise<void> {
    await this.controlServer.close();
    await this.runtime.stop();
    this.logger.info('[PlatformApp] Stopped');
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`[PlatformApp] Received ${signal}, shutting down...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  }
}

async function main(): Promise<void> {
  const config = await getConfig();
  const app = new PlatformApp(config);
  await app.start();
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error('Failed to start platform app:', error);
    process.exit(1);
  });
}

export { PlatformApp, VERSION };
export * from './types.js';
export { ModuleRegistry } from './registry/ModuleRegistry.js';
export { MessageBus, createMessageBus } from './messaging/MessageBus.js';
export { ModuleSupervisor } from './supervisor/ModuleSupervisor.js';
export { PlatformRuntime, createPlatformRuntime } from './runtime/PlatformRuntime.js';
export { ControlServer } from './control/ControlServer.js';

// MessageBusClient exports - 避免与 types.js 中的 MessageHandler 冲突
export type {
  MessageBusClientConfig,
  SubscriptionConfig,
  Subscription
} from './client/MessageBusClient.js';
export { MessageBusClient, createMessageBusClient } from './client/MessageBusClient.js';

// 重新导出 MessageHandler 但使用别名避免冲突
export type { MessageHandler as ClientMessageHandler } from './client/MessageBusClient.js';