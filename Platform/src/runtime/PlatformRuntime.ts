import { createMessageBus, type MessageBus } from '../messaging/MessageBus.js';
import { ModuleRegistry } from '../registry/ModuleRegistry.js';
import { PluginManager } from '../plugins/PluginManager.js';
import type { LoadedPluginInfo, MessageEnvelope, PlatformRuntimeOptions, PlatformRuntimeStatus } from '../types.js';
import { createLogger } from '../utils/Logger.js';

export class PlatformRuntime {
  private readonly logger;
  private readonly registry: ModuleRegistry;
  private readonly messageBus: MessageBus;
  private readonly pluginManager: PluginManager;
  private isStarted = false;

  constructor(options: PlatformRuntimeOptions) {
    this.logger = createLogger(options.logLevel || 'info');
    this.registry = new ModuleRegistry({ modulesRoot: options.modulesRoot });
    this.messageBus = createMessageBus({ maxHistorySize: options.maxMessageHistory });
    this.pluginManager = new PluginManager({
      registry: this.registry,
      host: options.host || '127.0.0.1',
      port: options.port || 3200,
      logLevel: options.logLevel,
    });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    const count = await this.registry.initialize();
    this.logger.info(`[PlatformRuntime] Registered ${count} modules`);

    this.setupMessageRouting();
    this.setupPluginEvents();
    await this.pluginManager.start();

    this.isStarted = true;
    this.logger.info('[PlatformRuntime] Started');
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    await this.pluginManager.stop();
    this.isStarted = false;
    this.logger.info('[PlatformRuntime] Stopped');
  }

  async startModule(moduleId: string): Promise<number> {
    await this.pluginManager.loadPlugin(moduleId);
    return 0;
  }

  async stopModule(moduleId: string): Promise<boolean> {
    return this.pluginManager.unloadPlugin(moduleId);
  }

  async restartModule(moduleId: string): Promise<number> {
    await this.pluginManager.reloadPlugin(moduleId);
    return 0;
  }

  send(envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>): string {
    return this.messageBus.send(envelope);
  }

  async request(
    envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>,
    timeoutMs?: number
  ): Promise<MessageEnvelope> {
    return this.messageBus.request(envelope, timeoutMs);
  }

  getRegistry(): ModuleRegistry {
    return this.registry;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getLoadedPlugins(): LoadedPluginInfo[] {
    return this.pluginManager.getLoadedPlugins();
  }

  async handlePluginRequest(moduleId: string, subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<boolean> {
    return this.pluginManager.handleHttpRequest(moduleId, subPath, request, response);
  }

  getStatus(): PlatformRuntimeStatus {
    return {
      isStarted: this.isStarted,
      modules: this.registry.getStats(),
      messaging: this.messageBus.getStats(),
      plugins: this.pluginManager.getStats()
    };
  }

  private setupMessageRouting(): void {
    for (const module of this.registry.getAllModules()) {
      this.messageBus.subscribe(module.moduleId, (envelope) => {
        this.logger.debug(`[MessageBus] ${envelope.fromModule} -> ${envelope.toModule}: ${envelope.action}`);
      });
    }
  }

  private setupPluginEvents(): void {
    this.pluginManager.on('plugin:loaded', ({ moduleId }) => {
      this.logger.info(`[Plugin] ${moduleId} loaded`);
    });

    this.pluginManager.on('plugin:unloaded', ({ moduleId }) => {
      this.logger.info(`[Plugin] ${moduleId} unloaded`);
    });
  }
}

export function createPlatformRuntime(options: PlatformRuntimeOptions): PlatformRuntime {
  return new PlatformRuntime(options);
}