/**
 * Module Supervisor - 模块守护进程
 *
 * 负责模块进程生命周期和故障恢复
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ModuleManifest, HealthCheckResult } from '../types/index.js';
import type { ModuleRegistry } from '../registry/ModuleRegistry.js';

/**
 * 模块进程信息
 */
interface ModuleProcess {
  /** 模块 ID */
  moduleId: string;
  /** 子进程 */
  process: ChildProcess;
  /** 重启次数 */
  restartCount: number;
  /** 最后重启时间 */
  lastRestartAt?: Date;
  /** 最后健康检查时间 */
  lastHealthCheckAt?: Date;
  /** 健康检查失败次数 */
  healthCheckFailures: number;
  /** 启动时间 */
  startedAt: Date;
}

/**
 * 模块守护进程选项
 */
export interface ModuleSupervisorOptions {
  /** 注册表实例 */
  registry: ModuleRegistry;
  /** 健康检查间隔（毫秒） */
  healthCheckInterval?: number;
  /** 最大重启次数 */
  maxRestarts?: number;
  /** 重启退避时间（毫秒） */
  restartBackoffMs?: number;
}

/**
 * 健康检查结果
 */
export interface HealthCheckOptions {
  /** 是否执行健康检查 */
  enabled: boolean;
  /** 检查间隔（毫秒） */
  intervalMs: number;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 失败阈值 */
  unhealthyThreshold: number;
}

/**
 * 模块事件
 */
export interface ModuleEvents {
  'module:started': { moduleId: string; pid: number };
  'module:stopped': { moduleId: string; exitCode: number | null };
  'module:restarted': { moduleId: string; restartCount: number };
  'module:failed': { moduleId: string; error: string };
  'module:healthy': { moduleId: string };
  'module:unhealthy': { moduleId: string };
}

/**
 * 模块守护进程类
 */
export class ModuleSupervisor extends EventEmitter {
  private readonly registry: ModuleRegistry;
  private readonly processes: Map<string, ModuleProcess>;
  private readonly healthCheckInterval: number;
  private readonly maxRestarts: number;
  private readonly restartBackoffMs: number;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(options: ModuleSupervisorOptions) {
    super();
    this.registry = options.registry;
    this.processes = new Map();
    this.healthCheckInterval = options.healthCheckInterval || 15000;
    this.maxRestarts = options.maxRestarts || 3;
    this.restartBackoffMs = options.restartBackoffMs || 5000;
  }

  /**
   * 启动守护进程
   */
  async start(): Promise<void> {
    console.log('[ModuleSupervisor] Starting module supervisor...');

    // 启动需要自动启动的模块
    const autoStartModules = this.registry.getAutoStartModules();
    for (const module of autoStartModules) {
      try {
        await this.startModule(module.moduleId);
      } catch (error) {
        console.error(`[ModuleSupervisor] Failed to start module ${module.moduleId}:`, error);
      }
    }

    // 启动健康检查定时器
    this.startHealthCheck();

    console.log(`[ModuleSupervisor] Started with ${this.processes.size} modules`);
  }

  /**
   * 停止守护进程
   */
  async stop(): Promise<void> {
    console.log('[ModuleSupervisor] Stopping module supervisor...');

    // 停止健康检查
    this.stopHealthCheck();

    // 停止所有模块
    const stopPromises = Array.from(this.processes.keys()).map(moduleId =>
      this.stopModule(moduleId)
    );

    await Promise.allSettled(stopPromises);

    console.log('[ModuleSupervisor] Stopped');
  }

  /**
   * 启动模块
   */
  async startModule(moduleId: string): Promise<number> {
    const entry = this.registry.getModule(moduleId);
    if (!entry) {
      throw new Error(`Module not found: ${moduleId}`);
    }

    // 检查是否已经运行
    if (this.processes.has(moduleId)) {
      const existing = this.processes.get(moduleId)!;
      if (existing.process.pid && existing.process.exitCode === null) {
        console.log(`[ModuleSupervisor] Module ${moduleId} already running (PID: ${existing.process.pid})`);
        return existing.process.pid!;
      }
    }

    const manifest = entry.manifest;
    const modulePath = entry.modulePath;

    // 构建启动命令
    const command = manifest.entry.command;
    const args = manifest.entry.args || [];

    // 设置工作目录
    const cwd = modulePath;

    console.log(`[ModuleSupervisor] Starting module ${moduleId}...`);

    // 启动进程
    const childProcess = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env },
      detached: false
    });

    // 创建进程信息
    const moduleProcess: ModuleProcess = {
      moduleId,
      process: childProcess,
      restartCount: 0,
      healthCheckFailures: 0,
      startedAt: new Date()
    };

    // 设置进程退出处理
    childProcess.on('exit', (code, signal) => {
      this.handleProcessExit(moduleId, code, signal);
    });

    childProcess.on('error', (error) => {
      console.error(`[ModuleSupervisor] Module ${moduleId} process error:`, error);
      this.handleProcessError(moduleId, error);
    });

    // 记录输出（可选）
    childProcess.stdout?.on('data', (data) => {
      console.log(`[${moduleId}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data) => {
      console.error(`[${moduleId}] ${data.toString().trim()}`);
    });

    // 保存进程信息
    this.processes.set(moduleId, moduleProcess);

    // 更新注册表状态
    this.registry.updateModuleStatus(moduleId, 'running', childProcess.pid);

    // 发出事件
    this.emit('module:started', { moduleId, pid: childProcess.pid! });

    console.log(`[ModuleSupervisor] Module ${moduleId} started (PID: ${childProcess.pid})`);

    return childProcess.pid!;
  }

  /**
   * 停止模块
   */
  async stopModule(moduleId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const moduleProcess = this.processes.get(moduleId);
    if (!moduleProcess) {
      console.warn(`[ModuleSupervisor] Module ${moduleId} not running`);
      return false;
    }

    console.log(`[ModuleSupervisor] Stopping module ${moduleId} (PID: ${moduleProcess.process.pid})...`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 超时后强制杀死
        moduleProcess.process.kill('SIGKILL');
        resolve(false);
      }, 5000);

      moduleProcess.process.once('exit', () => {
        clearTimeout(timeout);
        this.processes.delete(moduleId);
        this.registry.updateModuleStatus(moduleId, 'stopped');
        this.emit('module:stopped', { moduleId, exitCode: null });
        resolve(true);
      });

      moduleProcess.process.kill(signal);
    });
  }

  /**
   * 重启模块
   */
  async restartModule(moduleId: string): Promise<number> {
    console.log(`[ModuleSupervisor] Restarting module ${moduleId}...`);

    await this.stopModule(moduleId);

    // 等待一段时间再启动
    await this.delay(this.restartBackoffMs);

    return await this.startModule(moduleId);
  }

  /**
   * 处理进程退出
   */
  private async handleProcessExit(moduleId: string, code: number | null, signal: string | null): Promise<void> {
    const moduleProcess = this.processes.get(moduleId);
    if (!moduleProcess) {
      return;
    }

    const entry = this.registry.getModule(moduleId);
    const isDaemon = entry?.manifest.startup?.daemon;

    console.log(`[ModuleSupervisor] Module ${moduleId} exited (code: ${code}, signal: ${signal})`);

    // 如果是守护进程且非正常退出，尝试重启
    if (isDaemon && code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      const restartPolicy = entry?.manifest.startup?.restartPolicy || 'on-failure';

      if (restartPolicy === 'on-failure' || restartPolicy === 'always') {
        if (moduleProcess.restartCount < this.maxRestarts) {
          moduleProcess.restartCount++;
          moduleProcess.lastRestartAt = new Date();

          console.log(`[ModuleSupervisor] Restarting module ${moduleId} (attempt ${moduleProcess.restartCount}/${this.maxRestarts})...`);

          try {
            await this.delay(this.restartBackoffMs);
            await this.startModule(moduleId);

            // 更新进程信息的重启计数
            const newProcess = this.processes.get(moduleId);
            if (newProcess) {
              newProcess.restartCount = moduleProcess.restartCount;
              newProcess.lastRestartAt = moduleProcess.lastRestartAt;
            }

            this.emit('module:restarted', { moduleId, restartCount: moduleProcess.restartCount });
          } catch (error) {
            console.error(`[ModuleSupervisor] Failed to restart module ${moduleId}:`, error);
            this.emit('module:failed', { moduleId, error: String(error) });
          }
        } else {
          console.error(`[ModuleSupervisor] Module ${moduleId} exceeded max restarts (${this.maxRestarts})`);
          this.emit('module:failed', { moduleId, error: 'Exceeded max restarts' });
        }
      }
    }

    // 清理进程信息
    this.processes.delete(moduleId);
    this.registry.updateModuleStatus(moduleId, 'stopped');
  }

  /**
   * 处理进程错误
   */
  private handleProcessError(moduleId: string, error: Error): void {
    console.error(`[ModuleSupervisor] Module ${moduleId} error:`, error);
    this.emit('module:failed', { moduleId, error: error.message });
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  /**
   * 停止健康检查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * 执行健康检查
   */
  private async performHealthChecks(): Promise<void> {
    const daemonModules = this.registry.getDaemonModules();

    for (const entry of daemonModules) {
      const moduleId = entry.moduleId;
      const healthCheck = entry.manifest.healthCheck;

      if (!healthCheck || healthCheck.type !== 'http') {
        continue;
      }

      const moduleProcess = this.processes.get(moduleId);
      if (!moduleProcess) {
        continue;
      }

      try {
        const result = await this.checkHealth(moduleId, healthCheck);

        if (result.healthy) {
          // 健康检查成功，重置失败计数
          if (moduleProcess.healthCheckFailures > 0) {
            console.log(`[ModuleSupervisor] Module ${moduleId} is now healthy`);
            this.emit('module:healthy', { moduleId });
          }
          moduleProcess.healthCheckFailures = 0;
        } else {
          // 健康检查失败
          moduleProcess.healthCheckFailures++;
          console.warn(`[ModuleSupervisor] Module ${moduleId} health check failed (${moduleProcess.healthCheckFailures}/${healthCheck.unhealthyThreshold || 3})`);

          if (moduleProcess.healthCheckFailures >= (healthCheck.unhealthyThreshold || 3)) {
            this.emit('module:unhealthy', { moduleId });

            // 标记为不健康
            this.registry.updateModuleStatus(moduleId, 'unhealthy');

            // 对于守护进程，尝试重启
            if (entry.manifest.startup?.daemon && entry.manifest.startup?.restartPolicy !== 'never') {
              console.log(`[ModuleSupervisor] Restarting unhealthy module ${moduleId}...`);
              await this.restartModule(moduleId);
            }
          }
        }

        moduleProcess.lastHealthCheckAt = new Date();

      } catch (error) {
        console.error(`[ModuleSupervisor] Health check error for ${moduleId}:`, error);
      }
    }
  }

  /**
   * 检查模块健康状态
   */
  private async checkHealth(moduleId: string, healthCheck: ModuleManifest['healthCheck']): Promise<HealthCheckResult> {
    const moduleProcess = this.processes.get(moduleId);
    if (!moduleProcess) {
      return { healthy: false, message: 'Module not running' };
    }

    if (!healthCheck || healthCheck.type !== 'http') {
      return { healthy: true, message: 'Health check not implemented' };
    }

    const startTime = Date.now();
    const timeout = healthCheck?.timeoutMs || 3000;
    const healthPath = healthCheck?.path || '/health';

    try {
      const response = await this.fetchHTTP(
        `http://127.0.0.1:${this.getModulePort(moduleId)}${healthPath}`,
        { timeout }
      );

      const duration = Date.now() - startTime;
      const healthy = response.statusCode === 200;

      return {
        healthy,
        message: healthy ? 'OK' : `HTTP ${response.statusCode}`,
        statusCode: response.statusCode,
        duration
      };

    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 获取模块端口（简化版，实际应该从配置中读取）
   */
  private getModulePort(moduleId: string): number {
    // 简化实现：使用环境变量或默认端口
    // 实际应该从模块配置中读取
    const portEnv = process.env[`${moduleId.toUpperCase()}_PORT`];
    if (portEnv) {
      return parseInt(portEnv, 10);
    }

    // 根据模块 ID 分配默认端口
    const portMap: Record<string, number> = {
      'platform-core': 3001,
      'im': 3010,
      'schedule': 3020,
      'config': 3030
    };

    return portMap[moduleId] || 3000;
  }

  /**
   * 简单的 HTTP 请求（不依赖外部库）
   */
  private async fetchHTTP(url: string, options: { timeout?: number } = {}): Promise<{ statusCode: number }> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 5000;
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Request timeout: ${url}`));
      }, timeout);

      const req = require('http').get(url, (res: any) => {
        clearTimeout(timer);
        resolve({ statusCode: res.statusCode });
      });

      req.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      req.setTimeout(timeout);
    });
  }

  /**
   * 获取运行中的模块列表
   */
  getRunningModules(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * 获取模块进程信息
   */
  getModuleProcess(moduleId: string): ModuleProcess | undefined {
    return this.processes.get(moduleId);
  }

  /**
   * 获取所有模块进程信息
   */
  getAllProcesses(): ReadonlyArray<ModuleProcess> {
    return Array.from(this.processes.values());
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计数据
   */
  getStats(): ModuleSupervisorStats {
    const stats: ModuleSupervisorStats = {
      runningModules: this.processes.size,
      totalRestarts: Array.from(this.processes.values()).reduce((sum, p) => sum + p.restartCount, 0),
      unhealthyModules: 0
    };

    for (const proc of this.processes.values()) {
      if (proc.healthCheckFailures > 0) {
        stats.unhealthyModules++;
      }
    }

    return stats;
  }
}

/**
 * 模块守护进程统计数据
 */
export interface ModuleSupervisorStats {
  /** 运行中的模块数 */
  runningModules: number;
  /** 总重启次数 */
  totalRestarts: number;
  /** 不健康的模块数 */
  unhealthyModules: number;
}
