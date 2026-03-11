/**
 * Module Registry - 模块注册表
 *
 * 负责模块的注册、发现、读取 Manifest 和 Skill
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ModuleManifest, ModuleRegistryOptions, ModuleStatus } from '../types/index.js';

/**
 * 模块注册表类
 */
export class ModuleRegistry {
  private readonly modulesRoot: string;
  private readonly modules: Map<string, ModuleRegistryEntry>;
  private readonly skills: Map<string, SkillEntry>;

  constructor(options: ModuleRegistryOptions) {
    this.modulesRoot = options.modulesRoot;
    this.modules = new Map();
    this.skills = new Map();
  }

  /**
   * 初始化注册表，扫描并注册所有模块
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.modulesRoot)) {
      throw new Error(`Modules root directory not found: ${this.modulesRoot}`);
    }

    await this.scanAndRegisterModules();
  }

  /**
   * 扫描并注册所有模块
   */
  async scanAndRegisterModules(): Promise<number> {
    let registeredCount = 0;

    try {
      const entries = await readdir(this.modulesRoot, { withFileTypes: true });

      for (const entry of entries) {
        // 跳过非目录和隐藏目录
        if (!entry.isDirectory || entry.name.startsWith('.')) {
          continue;
        }

        const modulePath = join(this.modulesRoot, entry.name);
        const manifestPath = join(modulePath, 'module.json');

        // 检查是否有 module.json
        if (!existsSync(manifestPath)) {
          continue;
        }

        try {
          await this.registerModule(modulePath);
          registeredCount++;
        } catch (error) {
          console.error(`Failed to register module ${entry.name}:`, error);
        }
      }

    } catch (error) {
      console.error('Error scanning modules directory:', error);
    }

    return registeredCount;
  }

  /**
   * 注册单个模块
   */
  async registerModule(modulePath: string): Promise<ModuleRegistryEntry> {
    const manifestPath = join(modulePath, 'module.json');

    if (!existsSync(manifestPath)) {
      throw new Error(`Module manifest not found: ${manifestPath}`);
    }

    // 读取 Manifest
    const manifest = await this.readManifest(manifestPath);

    // 读取 Skill
    const skill = await this.readSkill(modulePath, manifest.moduleId);

    // 创建注册条目
    const entry: ModuleRegistryEntry = {
      moduleId: manifest.moduleId,
      manifest,
      skillContent: skill,
      modulePath,
      status: 'registered',
      pid: undefined,
      registeredAt: new Date().toISOString()
    };

    this.modules.set(manifest.moduleId, entry);
    this.skills.set(manifest.moduleId, {
      moduleId: manifest.moduleId,
      content: skill,
      path: join(modulePath, 'skills', 'SKILL.md')
    });

    return entry;
  }

  /**
   * 读取模块 Manifest
   */
  async readManifest(manifestPath: string): Promise<ModuleManifest> {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ModuleManifest;

    // 验证必需字段
    if (!manifest.moduleId || !manifest.version || !manifest.kind) {
      throw new Error(`Invalid manifest: missing required fields in ${manifestPath}`);
    }

    return manifest;
  }

  /**
   * 读取模块 Skill
   */
  async readSkill(modulePath: string, moduleId: string): Promise<string> {
    const skillPath = join(modulePath, 'skills', 'SKILL.md');

    if (!existsSync(skillPath)) {
      return `# ${moduleId}\n\nNo SKILL.md file found.`;
    }

    return await readFile(skillPath, 'utf-8');
  }

  /**
   * 更新模块状态
   */
  updateModuleStatus(moduleId: string, status: ModuleStatus, pid?: number): void {
    const entry = this.modules.get(moduleId);
    if (entry) {
      entry.status = status;
      entry.pid = pid;

      if (status === 'running') {
        entry.startedAt = new Date().toISOString();
      }
    }
  }

  /**
   * 获取模块注册信息
   */
  getModule(moduleId: string): ModuleRegistryEntry | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * 获取所有模块
   */
  getAllModules(): ModuleRegistryEntry[] {
    return Array.from(this.modules.values());
  }

  /**
   * 根据状态获取模块
   */
  getModulesByStatus(status: ModuleStatus): ModuleRegistryEntry[] {
    return Array.from(this.modules.values()).filter(m => m.status === status);
  }

  /**
   * 获取需要自动启动的模块
   */
  getAutoStartModules(): ModuleRegistryEntry[] {
    return Array.from(this.modules.values()).filter(
      m => m.manifest.startup?.autoStart === true && m.status === 'registered'
    );
  }

  /**
   * 获取守护模块
   */
  getDaemonModules(): ModuleRegistryEntry[] {
    return Array.from(this.modules.values()).filter(
      m => m.manifest.startup?.daemon === true
    );
  }

  /**
   * 获取模块 Skill 内容
   */
  getSkill(moduleId: string): string | undefined {
    return this.skills.get(moduleId)?.content;
  }

  /**
   * 获取所有 Skills
   */
  getAllSkills(): Map<string, string> {
    const skills = new Map<string, string>();
    for (const [moduleId, skillEntry] of this.skills.entries()) {
      skills.set(moduleId, skillEntry.content);
    }
    return skills;
  }

  /**
   * 获取模块能力列表
   */
  getModuleCapabilities(moduleId: string): ModuleManifest['capabilities'] {
    const capabilities = this.modules.get(moduleId)?.manifest.capabilities;
    return capabilities || [];
  }

  /**
   * 根据动作名查找模块
   */
  findModuleByAction(action: string): ModuleRegistryEntry | undefined {
    for (const entry of this.modules.values()) {
      const capabilities = entry.manifest.capabilities;
      if (capabilities && capabilities.some(cap => cap.action === action)) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * 获取模块健康检查配置
   */
  getHealthCheck(moduleId: string): ModuleManifest['healthCheck'] | undefined {
    return this.modules.get(moduleId)?.manifest.healthCheck;
  }

  /**
   * 获取模块启动配置
   */
  getStartupConfig(moduleId: string): ModuleManifest['startup'] {
    return this.modules.get(moduleId)?.manifest.startup || {};
  }

  /**
   * 获取统计数据
   */
  getStats(): ModuleRegistryStats {
    const stats: ModuleRegistryStats = {
      total: this.modules.size,
      byStatus: {},
      byKind: {}
    };

    for (const entry of this.modules.values()) {
      // 按状态统计
      stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;

      // 按类型统计
      const kind = entry.manifest.kind;
      stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
    }

    return stats;
  }

  /**
   * 导出为 JSON（用于调试）
   */
  toJSON(): Record<string, unknown> {
    return {
      modulesRoot: this.modulesRoot,
      modules: Array.from(this.modules.entries()).map(([id, entry]) => ({
        id,
        status: entry.status,
        kind: entry.manifest.kind,
        version: entry.manifest.version,
        capabilities: entry.manifest.capabilities?.length || 0
      }))
    };
  }
}

/**
 * 模块注册表条目
 */
export interface ModuleRegistryEntry {
  /** 模块 ID */
  moduleId: string;
  /** Manifest 内容 */
  manifest: ModuleManifest;
  /** Skill 内容 */
  skillContent: string;
  /** 模块路径 */
  modulePath: string;
  /** 当前状态 */
  status: ModuleStatus;
  /** 进程 ID（如果正在运行） */
  pid?: number;
  /** 注册时间 */
  registeredAt: string;
  /** 启动时间 */
  startedAt?: string;
}

/**
 * Skill 条目
 */
interface SkillEntry {
  /** 模块 ID */
  moduleId: string;
  /** Skill 内容 */
  content: string;
  /** Skill 文件路径 */
  path: string;
}

/**
 * 模块注册表统计数据
 */
export interface ModuleRegistryStats {
  /** 总模块数 */
  total: number;
  /** 按状态统计 */
  byStatus: Record<string, number>;
  /** 按类型统计 */
  byKind: Record<string, number>;
}
