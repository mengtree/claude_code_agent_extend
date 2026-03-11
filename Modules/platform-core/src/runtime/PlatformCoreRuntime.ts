/**
 * Platform Core - 平台核心运行时
 *
 * 整合 Module Registry、Message Bus、Module Supervisor
 * 提供统一的模块管理和消息通讯能力
 */

import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { ModuleRegistry } from '../registry/ModuleRegistry.js';
import { MessageBus, createMessageBus } from '../messaging/MessageBus.js';
import { ModuleSupervisor } from '../supervisor/ModuleSupervisor.js';
import { createLogger } from '../utils/Logger.js';
import type {
  MessageEnvelope
} from '../types/index.js';

/**
 * 平台核心运行时配置
 */
export interface PlatformCoreRuntimeOptions {
  /** 模块根目录 */
  modulesRoot?: string;
  /** 消息历史最大大小 */
  maxMessageHistory?: number;
  /** 健康检查间隔（毫秒） */
  healthCheckInterval?: number;
  /** 最大重启次数 */
  maxRestarts?: number;
  /** 重启退避时间（毫秒） */
  restartBackoffMs?: number;
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 平台核心运行时状态
 */
export interface PlatformCoreRuntimeStatus {
  /** 是否已启动 */
  isStarted: boolean;
  /** 模块统计 */
  modules: {
    total: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
  };
  /** 消息统计 */
  messaging: {
    totalHandlers: number;
    subscribedModules: number;
    pendingRequests: number;
    historySize: number;
  };
  /** 进程统计 */
  processes: {
    runningModules: number;
    totalRestarts: number;
    unhealthyModules: number;
  };
}

/**
 * 平台核心运行时类
 */
export class PlatformCoreRuntime {
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly registry: ModuleRegistry;
  private readonly messageBus: MessageBus;
  private readonly supervisor: ModuleSupervisor;
  private isStarted: boolean = false;

  constructor(options: PlatformCoreRuntimeOptions = {}) {
    // 初始化日志
    this.logger = createLogger(options.logLevel || 'info');

    // 获取模块根目录
    const modulesRoot = options.modulesRoot || resolve(cwd(), 'Modules');

    // 初始化组件
    this.registry = new ModuleRegistry({ modulesRoot });
    this.messageBus = createMessageBus({ maxHistorySize: options.maxMessageHistory });
    this.supervisor = new ModuleSupervisor({
      registry: this.registry,
      healthCheckInterval: options.healthCheckInterval,
      maxRestarts: options.maxRestarts,
      restartBackoffMs: options.restartBackoffMs
    });

    this.logger.info('[PlatformCoreRuntime] Initialized');
  }

  /**
   * 启动平台核心运行时
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('[PlatformCoreRuntime] Already started');
      return;
    }

    this.logger.info('[PlatformCoreRuntime] Starting...');

    // 1. 初始化模块注册表，扫描并注册所有模块
    const count = await this.registry.initialize();
    this.logger.info(`[PlatformCoreRuntime] Registered ${count} modules`);

    // 显示注册的模块
    const modules = this.registry.getAllModules();
    for (const module of modules) {
      this.logger.debug(`  - ${module.moduleId} (${module.manifest.kind}) v${module.manifest.version}`);
    }

    // 2. 设置模块间消息路由
    this.setupMessageRouting();

    // 3. 启动模块守护进程
    await this.supervisor.start();

    // 4. 监听模块事件
    this.setupModuleEventHandlers();

    this.isStarted = true;
    this.logger.info('[PlatformCoreRuntime] Started successfully');
  }

  /**
   * 停止平台核心运行时
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info('[PlatformCoreRuntime] Stopping...');

    // 停止模块守护进程
    await this.supervisor.stop();

    this.isStarted = false;
    this.logger.info('[PlatformCoreRuntime] Stopped');
  }

  /**
   * 设置模块间消息路由
   */
  private setupMessageRouting(): void {
    // 为每个模块订阅消息
    const modules = this.registry.getAllModules();

    for (const module of modules) {
      this.messageBus.subscribe(module.moduleId, (envelope: MessageEnvelope) => {
        this.logger.debug(`[MessageBus] ${envelope.fromModule} -> ${envelope.toModule}: ${envelope.action}`);

        // TODO: 将消息传递给目标模块
        // 这里需要根据模块的实现方式来调用
        // 可能是 HTTP 请求、IPC、或其他方式
      });
    }
  }

  /**
   * 设置模块事件监听器
   */
  private setupModuleEventHandlers(): void {
    this.supervisor.on('module:started', ({ moduleId, pid }: { moduleId: string; pid: number }) => {
      this.logger.info(`[Module] ${moduleId} started (PID: ${pid})`);
    });

    this.supervisor.on('module:stopped', ({ moduleId, exitCode }: { moduleId: string; exitCode: number | null }) => {
      this.logger.info(`[Module] ${moduleId} stopped (exit code: ${exitCode})`);
    });

    this.supervisor.on('module:restarted', ({ moduleId, restartCount }: { moduleId: string; restartCount: number }) => {
      this.logger.warn(`[Module] ${moduleId} restarted (${restartCount} times)`);
    });

    this.supervisor.on('module:failed', ({ moduleId, error }: { moduleId: string; error: string }) => {
      this.logger.error(`[Module] ${moduleId} failed: ${error}`);
    });

    this.supervisor.on('module:healthy', ({ moduleId }: { moduleId: string }) => {
      this.logger.debug(`[Module] ${moduleId} is now healthy`);
    });

    this.supervisor.on('module:unhealthy', ({ moduleId }: { moduleId: string }) => {
      this.logger.warn(`[Module] ${moduleId} is unhealthy`);
    });
  }

  /**
   * 获取模块注册表
   */
  getRegistry(): ModuleRegistry {
    return this.registry;
  }

  /**
   * 获取消息总线
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /**
   * 获取模块守护进程
   */
  getSupervisor(): ModuleSupervisor {
    return this.supervisor;
  }

  /**
   * 发送消息到模块
   */
  send(envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>): string {
    return this.messageBus.send(envelope);
  }

  /**
   * 发送请求并等待响应
   */
  async request(
    envelope: Omit<MessageEnvelope, 'messageId' | 'createdAt'>,
    timeoutMs?: number
  ): Promise<MessageEnvelope> {
    return await this.messageBus.request(envelope, timeoutMs);
  }

  /**
   * 启动指定模块
   */
  async startModule(moduleId: string): Promise<number> {
    this.logger.info(`[PlatformCoreRuntime] Starting module: ${moduleId}`);
    return await this.supervisor.startModule(moduleId);
  }

  /**
   * 停止指定模块
   */
  async stopModule(moduleId: string): Promise<boolean> {
    this.logger.info(`[PlatformCoreRuntime] Stopping module: ${moduleId}`);
    return await this.supervisor.stopModule(moduleId);
  }

  /**
   * 重启指定模块
   */
  async restartModule(moduleId: string): Promise<number> {
    this.logger.info(`[PlatformCoreRuntime] Restarting module: ${moduleId}`);
    return await this.supervisor.restartModule(moduleId);
  }

  /**
   * 获取运行时状态
   */
  getStatus(): PlatformCoreRuntimeStatus {
    const registryStats = this.registry.getStats();
    const messageBusStats = this.messageBus.getStats();
    const supervisorStats = this.supervisor.getStats();

    return {
      isStarted: this.isStarted,
      modules: registryStats,
      messaging: messageBusStats,
      processes: supervisorStats
    };
  }

  /**
   * 获取运行时信息（JSON 格式）
   */
  toJSON(): Record<string, unknown> {
    const status = this.getStatus();
    return {
      isStarted: status.isStarted,
      modules: status.modules,
      messaging: status.messaging,
      processes: status.processes
    };
  }
}

/**
 * 创建平台核心运行时实例
 */
export function createPlatformCoreRuntime(options?: PlatformCoreRuntimeOptions): PlatformCoreRuntime {
  return new PlatformCoreRuntime(options);
}
