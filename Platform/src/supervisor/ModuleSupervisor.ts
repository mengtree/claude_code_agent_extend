import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';
import type { HealthCheckResult, ModuleManifest } from '../types.js';
import type { ModuleRegistry } from '../registry/ModuleRegistry.js';
import { createLogger } from '../utils/Logger.js';

interface ModuleProcess {
  moduleId: string;
  process: ChildProcess;
  restartCount: number;
  lastRestartAt?: Date;
  lastHealthCheckAt?: Date;
  healthCheckFailures: number;
  startedAt: Date;
}

export interface ModuleSupervisorOptions {
  registry: ModuleRegistry;
  healthCheckInterval?: number;
  maxRestarts?: number;
  restartBackoffMs?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** 全局模块启动延迟（毫秒），每个模块启动之间间隔 */
  moduleStartDelayMs?: number;
  /** 模块启动前的全局延迟（毫秒） */
  startupDelayMs?: number;
}

export interface ModuleSupervisorStats {
  runningModules: number;
  totalRestarts: number;
  unhealthyModules: number;
}

export class ModuleSupervisor extends EventEmitter {
  private readonly processes = new Map<string, ModuleProcess>();
  private readonly healthCheckInterval: number;
  private readonly maxRestarts: number;
  private readonly restartBackoffMs: number;
  private readonly moduleStartDelayMs: number;
  private readonly startupDelayMs: number;
  private readonly logger;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(
    private readonly options: ModuleSupervisorOptions
  ) {
    super();
    this.healthCheckInterval = options.healthCheckInterval || 15000;
    this.maxRestarts = options.maxRestarts || 3;
    this.restartBackoffMs = options.restartBackoffMs || 5000;
    this.moduleStartDelayMs = options.moduleStartDelayMs || 1000;
    this.startupDelayMs = options.startupDelayMs || 0;
    this.logger = createLogger(options.logLevel || 'info');
  }

  async start(): Promise<void> {
    this.logger.info('[ModuleSupervisor] Starting module supervisor...');

    // 立即启动健康检查
    this.startHealthCheck();

    // 异步启动模块，不阻塞主线程
    void this.startModulesAsync();

    this.logger.info('[ModuleSupervisor] Module startup initiated in background');
  }

  /**
   * 异步启动所有模块
   */
  private async startModulesAsync(): Promise<void> {
    // 全局启动延迟
    if (this.startupDelayMs > 0) {
      this.logger.info(`[ModuleSupervisor] Waiting ${this.startupDelayMs}ms before starting modules...`);
      await this.delay(this.startupDelayMs);
    }

    const autoStartModules = this.options.registry.getAutoStartModules();
    let startedCount = 0;

    for (let i = 0; i < autoStartModules.length; i++) {
      const module = autoStartModules[i];

      try {
        // 使用模块配置的延迟或全局延迟
        const delayMs = module.manifest.startup?.delayMs || this.moduleStartDelayMs;

        if (i > 0 && delayMs > 0) {
          this.logger.info(`[ModuleSupervisor] Waiting ${delayMs}ms before starting ${module.moduleId}...`);
          await this.delay(delayMs);
        }

        await this.startModule(module.moduleId);
        startedCount++;
        this.logger.info(`[ModuleSupervisor] Progress: ${startedCount}/${autoStartModules.length} modules started`);
      } catch (error) {
        this.logger.error(`[ModuleSupervisor] Failed to start module ${module.moduleId}:`, error);
      }
    }

    this.logger.info(`[ModuleSupervisor] All modules started: ${startedCount}/${autoStartModules.length}`);
    this.emit('all-modules-started', { total: startedCount });
  }

  async stop(): Promise<void> {
    this.logger.info('[ModuleSupervisor] Stopping module supervisor...');
    this.stopHealthCheck();

    const stopPromises = Array.from(this.processes.keys()).map((moduleId) => this.stopModule(moduleId));
    await Promise.allSettled(stopPromises);

    this.logger.info('[ModuleSupervisor] Stopped');
  }

  async startModule(moduleId: string): Promise<number> {
    const entry = this.options.registry.getModule(moduleId);
    if (!entry) {
      throw new Error(`Module not found: ${moduleId}`);
    }

    const existing = this.processes.get(moduleId);
    if (existing?.process.pid && existing.process.exitCode === null) {
      return existing.process.pid;
    }

    this.options.registry.updateModuleStatus(moduleId, 'starting');
    this.logger.info(`[ModuleSupervisor] Starting module ${moduleId}...`);

    const childProcess = spawn(entry.manifest.entry.command, entry.manifest.entry.args || [], {
      cwd: entry.modulePath,
      stdio: 'pipe',
      env: this.createModuleEnvironment(moduleId, entry.modulePath),
      detached: false
    });

    const moduleProcess: ModuleProcess = {
      moduleId,
      process: childProcess,
      restartCount: existing?.restartCount || 0,
      lastRestartAt: existing?.lastRestartAt,
      healthCheckFailures: 0,
      startedAt: new Date()
    };

    childProcess.on('exit', (code, signal) => {
      void this.handleProcessExit(moduleId, code, signal);
    });

    childProcess.on('error', (error) => {
      this.logger.error(`[ModuleSupervisor] Module ${moduleId} process error:`, error);
      this.emit('module:failed', { moduleId, error: error.message });
    });

    childProcess.stdout?.on('data', (data) => {
      this.logger.info(`[${moduleId}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data) => {
      this.logger.error(`[${moduleId}] ${data.toString().trim()}`);
    });

    this.processes.set(moduleId, moduleProcess);
    this.options.registry.updateModuleStatus(moduleId, 'running', childProcess.pid);
    this.emit('module:started', { moduleId, pid: childProcess.pid });

    return childProcess.pid || 0;
  }

  async stopModule(moduleId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const moduleProcess = this.processes.get(moduleId);
    if (!moduleProcess) {
      return false;
    }

    this.options.registry.updateModuleStatus(moduleId, 'stopped');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        moduleProcess.process.kill('SIGKILL');
        resolve(false);
      }, 5000);

      moduleProcess.process.once('exit', () => {
        clearTimeout(timeout);
        this.processes.delete(moduleId);
        this.emit('module:stopped', { moduleId, exitCode: null });
        resolve(true);
      });

      moduleProcess.process.kill(signal);
    });
  }

  async restartModule(moduleId: string): Promise<number> {
    this.options.registry.updateModuleStatus(moduleId, 'restarting');
    await this.stopModule(moduleId);
    await this.delay(this.restartBackoffMs);
    return this.startModule(moduleId);
  }

  getAllProcesses(): ReadonlyArray<ModuleProcess> {
    return Array.from(this.processes.values());
  }

  getStats(): ModuleSupervisorStats {
    let unhealthyModules = 0;

    for (const processInfo of this.processes.values()) {
      if (processInfo.healthCheckFailures > 0) {
        unhealthyModules++;
      }
    }

    return {
      runningModules: this.processes.size,
      totalRestarts: Array.from(this.processes.values()).reduce((sum, item) => sum + item.restartCount, 0),
      unhealthyModules
    };
  }

  private async handleProcessExit(
    moduleId: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): Promise<void> {
    const moduleProcess = this.processes.get(moduleId);
    if (!moduleProcess) {
      return;
    }

    const entry = this.options.registry.getModule(moduleId);
    this.processes.delete(moduleId);
    this.options.registry.updateModuleStatus(moduleId, 'stopped');

    if (!entry?.manifest.startup?.daemon || code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }

    const restartPolicy = entry.manifest.startup.restartPolicy || 'on-failure';
    const restartLimit = entry.manifest.startup.restartMaxRetries ?? this.maxRestarts;
    if (restartPolicy === 'never' || moduleProcess.restartCount >= restartLimit) {
      this.emit('module:failed', { moduleId, error: 'Exceeded max restarts' });
      return;
    }

    moduleProcess.restartCount += 1;
    moduleProcess.lastRestartAt = new Date();
    this.emit('module:restarted', { moduleId, restartCount: moduleProcess.restartCount });

    await this.delay(entry.manifest.startup.restartBackoffMs ?? this.restartBackoffMs);
    this.processes.set(moduleId, moduleProcess);
    await this.startModule(moduleId);
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private async performHealthChecks(): Promise<void> {
    for (const entry of this.options.registry.getDaemonModules()) {
      const moduleProcess = this.processes.get(entry.moduleId);
      if (!moduleProcess || entry.manifest.healthCheck?.type !== 'http') {
        continue;
      }

      const result = await this.checkHealth(entry.moduleId, entry.manifest.healthCheck);
      if (result.healthy) {
        moduleProcess.healthCheckFailures = 0;
        moduleProcess.lastHealthCheckAt = new Date();
        continue;
      }

      moduleProcess.healthCheckFailures += 1;
      if (moduleProcess.healthCheckFailures >= (entry.manifest.healthCheck.unhealthyThreshold || 3)) {
        this.options.registry.updateModuleStatus(entry.moduleId, 'unhealthy');
        this.emit('module:unhealthy', { moduleId: entry.moduleId });

        if (entry.manifest.startup?.restartPolicy !== 'never') {
          await this.restartModule(entry.moduleId);
        }
      }
    }
  }

  private async checkHealth(
    moduleId: string,
    healthCheck: ModuleManifest['healthCheck']
  ): Promise<HealthCheckResult> {
    if (!healthCheck || healthCheck.type !== 'http') {
      return { healthy: true, message: 'No HTTP health check configured' };
    }

    const startTime = Date.now();
    try {
      const response = await this.fetchHttp(
        `http://127.0.0.1:${this.getModulePort(moduleId)}${healthCheck.path || '/health'}`,
        healthCheck.timeoutMs || 3000
      );

      return {
        healthy: response.statusCode === 200,
        message: response.statusCode === 200 ? 'OK' : `HTTP ${response.statusCode}`,
        statusCode: response.statusCode,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private createModuleEnvironment(moduleId: string, modulePath: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const config = this.readModuleConfig(modulePath);
    const prefix = this.getModuleEnvPrefix(moduleId);
    const configPath = join(modulePath, 'config.json');

    env[`${prefix}_CONFIG`] = configPath;

    if (typeof config.port === 'number' && Number.isInteger(config.port)) {
      env[`${prefix}_PORT`] = String(config.port);
    }

    if (typeof config.host === 'string' && config.host.length > 0) {
      env[`${prefix}_HOST`] = config.host;
    }

    if (typeof config.logLevel === 'string') {
      env[`${prefix}_LOG_LEVEL`] = config.logLevel;
    }

    return env;
  }

  private readModuleConfig(modulePath: string): Record<string, unknown> {
    const configPath = join(modulePath, 'config.json');
    if (!existsSync(configPath)) {
      return {};
    }

    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private getModulePort(moduleId: string): number {
    const entry = this.options.registry.getModule(moduleId);
    if (entry) {
      const config = this.readModuleConfig(entry.modulePath);
      if (typeof config.port === 'number' && Number.isInteger(config.port)) {
        return config.port;
      }
    }

    return 3000;
  }

  private getModuleEnvPrefix(moduleId: string): string {
    return moduleId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  }

  private fetchHttp(url: string, timeout: number): Promise<{ statusCode: number }> {
    return new Promise((resolve, reject) => {
      const req = httpGet(url, (res) => {
        clearTimeout(timer);
        resolve({ statusCode: res.statusCode ?? 0 });
        res.resume();
      });

      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Request timeout: ${url}`));
      }, timeout);

      req.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}