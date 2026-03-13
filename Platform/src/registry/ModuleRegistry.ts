import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModuleManifest, ModuleRegistryOptions, ModuleStatus } from '../types.js';

export interface SkillEntry {
  moduleId: string;
  content: string;
  path?: string;
}

export interface ModuleRegistryEntry {
  moduleId: string;
  manifest: ModuleManifest;
  moduleConfig: Record<string, unknown>;
  skillContent: string;
  modulePath: string;
  status: ModuleStatus;
  pid?: number;
  registeredAt: string;
  startedAt?: string;
}

export interface ModuleRegistryStats {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, ModuleRegistryEntry>();
  private readonly skills = new Map<string, SkillEntry>();

  constructor(private readonly options: ModuleRegistryOptions) {}

  async initialize(): Promise<number> {
    if (!existsSync(this.options.modulesRoot)) {
      throw new Error(`Modules root directory not found: ${this.options.modulesRoot}`);
    }

    this.modules.clear();
    this.skills.clear();

    return this.scanAndRegisterModules();
  }

  async scanAndRegisterModules(): Promise<number> {
    let registeredCount = 0;
    const entries = await readdir(this.options.modulesRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const modulePath = join(this.options.modulesRoot, entry.name);
      const manifestPath = join(modulePath, 'module.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      await this.registerModule(modulePath);
      registeredCount++;
    }

    return registeredCount;
  }

  async registerModule(modulePath: string): Promise<ModuleRegistryEntry> {
    const manifestPath = join(modulePath, 'module.json');
    const manifest = await this.readManifest(manifestPath);
    const moduleConfig = await this.readModuleConfig(modulePath);
    const skill = await this.readSkill(modulePath, manifest.moduleId);

    const entry: ModuleRegistryEntry = {
      moduleId: manifest.moduleId,
      manifest,
      moduleConfig,
      skillContent: skill.content,
      modulePath,
      status: 'registered',
      registeredAt: new Date().toISOString()
    };

    this.modules.set(manifest.moduleId, entry);
    this.skills.set(manifest.moduleId, skill);
    return entry;
  }

  getModule(moduleId: string): ModuleRegistryEntry | undefined {
    return this.modules.get(moduleId);
  }

  getAllModules(): ModuleRegistryEntry[] {
    return Array.from(this.modules.values());
  }

  getAutoStartModules(): ModuleRegistryEntry[] {
    return this.getAllModules().filter((entry) => entry.manifest.startup?.autoStart === true);
  }

  getDaemonModules(): ModuleRegistryEntry[] {
    return this.getAllModules().filter((entry) => entry.manifest.startup?.daemon === true);
  }

  updateModuleStatus(moduleId: string, status: ModuleStatus, pid?: number): void {
    const entry = this.modules.get(moduleId);
    if (!entry) {
      return;
    }

    entry.status = status;
    entry.pid = pid;

    if (status === 'running') {
      entry.startedAt = new Date().toISOString();
    }
  }

  getStats(): ModuleRegistryStats {
    const stats: ModuleRegistryStats = {
      total: this.modules.size,
      byStatus: {},
      byKind: {}
    };

    for (const entry of this.modules.values()) {
      stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;
      stats.byKind[entry.manifest.kind] = (stats.byKind[entry.manifest.kind] || 0) + 1;
    }

    return stats;
  }

  private async readManifest(manifestPath: string): Promise<ModuleManifest> {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ModuleManifest;

    if (!manifest.moduleId || !manifest.version || !manifest.kind) {
      throw new Error(`Invalid manifest: ${manifestPath}`);
    }

    return manifest;
  }

  private async readSkill(modulePath: string, moduleId: string): Promise<SkillEntry> {
    const skillsRoot = join(modulePath, 'skills');
    if (!existsSync(skillsRoot)) {
      return {
        moduleId,
        content: `# ${moduleId}\n\nNo skill file found.`
      };
    }

    const entries = await readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(skillsRoot, entry.name, 'SKILL.md');
      if (!existsSync(candidate)) {
        continue;
      }

      return {
        moduleId,
        content: await readFile(candidate, 'utf-8'),
        path: candidate
      };
    }

    return {
      moduleId,
      content: `# ${moduleId}\n\nNo skill file found under skills/.`
    };
  }

  private async readModuleConfig(modulePath: string): Promise<Record<string, unknown>> {
    const configPath = join(modulePath, 'config.json');
    if (!existsSync(configPath)) {
      return {};
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
}