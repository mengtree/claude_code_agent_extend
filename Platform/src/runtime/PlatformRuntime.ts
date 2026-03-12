import { createMessageBus, type MessageBus } from '../messaging/MessageBus.js';
import { ModuleRegistry } from '../registry/ModuleRegistry.js';
import { ModuleSupervisor } from '../supervisor/ModuleSupervisor.js';
import type { MessageEnvelope, PlatformRuntimeOptions, PlatformRuntimeStatus } from '../types.js';
import { createLogger } from '../utils/Logger.js';

export class PlatformRuntime {
  private readonly logger;
  private readonly registry: ModuleRegistry;
  private readonly messageBus: MessageBus;
  private readonly supervisor: ModuleSupervisor;
  private isStarted = false;

  constructor(options: PlatformRuntimeOptions) {
    this.logger = createLogger(options.logLevel || 'info');
    this.registry = new ModuleRegistry({ modulesRoot: options.modulesRoot });
    this.messageBus = createMessageBus({ maxHistorySize: options.maxMessageHistory });
    this.supervisor = new ModuleSupervisor({
      registry: this.registry,
      healthCheckInterval: options.healthCheckInterval,
      maxRestarts: options.maxRestarts,
      restartBackoffMs: options.restartBackoffMs,
      logLevel: options.logLevel,
      moduleStartDelayMs: options.moduleStartDelayMs,
      startupDelayMs: options.startupDelayMs
    });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    const count = await this.registry.initialize();
    this.logger.info(`[PlatformRuntime] Registered ${count} modules`);

    this.setupMessageRouting();
    this.setupSupervisorEvents();
    await this.supervisor.start();

    this.isStarted = true;
    this.logger.info('[PlatformRuntime] Started');
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    await this.supervisor.stop();
    this.isStarted = false;
    this.logger.info('[PlatformRuntime] Stopped');
  }

  async startModule(moduleId: string): Promise<number> {
    return this.supervisor.startModule(moduleId);
  }

  async stopModule(moduleId: string): Promise<boolean> {
    return this.supervisor.stopModule(moduleId);
  }

  async restartModule(moduleId: string): Promise<number> {
    return this.supervisor.restartModule(moduleId);
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

  getSupervisor(): ModuleSupervisor {
    return this.supervisor;
  }

  getStatus(): PlatformRuntimeStatus {
    return {
      isStarted: this.isStarted,
      modules: this.registry.getStats(),
      messaging: this.messageBus.getStats(),
      processes: this.supervisor.getStats()
    };
  }

  private setupMessageRouting(): void {
    for (const module of this.registry.getAllModules()) {
      this.messageBus.subscribe(module.moduleId, (envelope) => {
        this.logger.debug(`[MessageBus] ${envelope.fromModule} -> ${envelope.toModule}: ${envelope.action}`);
      });
    }
  }

  private setupSupervisorEvents(): void {
    this.supervisor.on('module:started', ({ moduleId, pid }) => {
      this.logger.info(`[Module] ${moduleId} started (PID: ${pid})`);
    });

    this.supervisor.on('module:stopped', ({ moduleId, exitCode }) => {
      this.logger.info(`[Module] ${moduleId} stopped (exit code: ${exitCode})`);
    });

    this.supervisor.on('module:restarted', ({ moduleId, restartCount }) => {
      this.logger.warn(`[Module] ${moduleId} restarted (${restartCount} times)`);
    });

    this.supervisor.on('module:failed', ({ moduleId, error }) => {
      this.logger.error(`[Module] ${moduleId} failed: ${error}`);
    });

    this.supervisor.on('module:unhealthy', ({ moduleId }) => {
      this.logger.warn(`[Module] ${moduleId} is unhealthy`);
    });
  }
}

export function createPlatformRuntime(options: PlatformRuntimeOptions): PlatformRuntime {
  return new PlatformRuntime(options);
}