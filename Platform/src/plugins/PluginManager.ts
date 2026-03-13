import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModuleRegistry, ModuleRegistryEntry } from '../registry/ModuleRegistry.js';
import type {
  LoadedPluginInfo,
  PlatformPlugin,
  PlatformPluginContext
} from '../types.js';
import { createLogger } from '../utils/Logger.js';

interface LoadedPluginRecord {
  moduleId: string;
  entry: ModuleRegistryEntry;
  plugin: PlatformPlugin;
  routePrefix: string;
  loadedAt: string;
  updatedAt: string;
}

interface PluginFactoryModule {
  createPlugin?: (context: PlatformPluginContext) => Promise<PlatformPlugin> | PlatformPlugin;
  default?: ((context: PlatformPluginContext) => Promise<PlatformPlugin> | PlatformPlugin) | {
    createPlugin?: (context: PlatformPluginContext) => Promise<PlatformPlugin> | PlatformPlugin;
  };
}

export interface PluginManagerOptions {
  registry: ModuleRegistry;
  host: string;
  port: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface PluginManagerStats {
  loaded: number;
  withUi: number;
}

export class PluginManager extends EventEmitter {
  private readonly logger;
  private readonly loadedPlugins = new Map<string, LoadedPluginRecord>();

  constructor(private readonly options: PluginManagerOptions) {
    super();
    this.logger = createLogger(options.logLevel || 'info');
  }

  async start(): Promise<void> {
    const autoStartModules = this.options.registry.getAutoStartModules();
    for (const entry of autoStartModules) {
      await this.loadPlugin(entry.moduleId);
    }
  }

  async stop(): Promise<void> {
    for (const moduleId of Array.from(this.loadedPlugins.keys())) {
      await this.unloadPlugin(moduleId);
    }
  }

  async loadPlugin(moduleId: string): Promise<LoadedPluginInfo> {
    const existing = this.loadedPlugins.get(moduleId);
    if (existing) {
      return this.toLoadedPluginInfo(existing);
    }

    const entry = this.options.registry.getModule(moduleId);
    if (!entry) {
      throw new Error(`Plugin module not found: ${moduleId}`);
    }

    const routePrefix = this.getRoutePrefix(entry);
    const pluginModule = await this.importPluginModule(entry);
    const createPlugin = this.resolveFactory(pluginModule, moduleId);
    const plugin = await createPlugin(this.createContext(entry, routePrefix));

    await plugin.initialize?.();

    const now = new Date().toISOString();
    const record: LoadedPluginRecord = {
      moduleId,
      entry,
      plugin,
      routePrefix,
      loadedAt: now,
      updatedAt: now
    };

    this.loadedPlugins.set(moduleId, record);
    this.options.registry.updateModuleStatus(moduleId, 'running');
    this.emit('plugin:loaded', { moduleId });
    this.logger.info(`[PluginManager] Loaded plugin ${moduleId}`);
    return this.toLoadedPluginInfo(record);
  }

  async unloadPlugin(moduleId: string): Promise<boolean> {
    const record = this.loadedPlugins.get(moduleId);
    if (!record) {
      return false;
    }

    await record.plugin.dispose?.();
    this.loadedPlugins.delete(moduleId);
    this.options.registry.updateModuleStatus(moduleId, 'stopped');
    this.emit('plugin:unloaded', { moduleId });
    this.logger.info(`[PluginManager] Unloaded plugin ${moduleId}`);
    return true;
  }

  async reloadPlugin(moduleId: string): Promise<LoadedPluginInfo> {
    await this.unloadPlugin(moduleId);
    return this.loadPlugin(moduleId);
  }

  async handleHttpRequest(moduleId: string, subPath: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const record = this.loadedPlugins.get(moduleId);
    if (!record?.plugin.handleHttpRequest) {
      return false;
    }

    const handled = await record.plugin.handleHttpRequest(subPath, request, response);
    return handled !== false;
  }

  getLoadedPlugins(): LoadedPluginInfo[] {
    return Array.from(this.loadedPlugins.values())
      .map((record) => this.toLoadedPluginInfo(record))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  }

  getPlugin(moduleId: string): LoadedPluginInfo | undefined {
    const record = this.loadedPlugins.get(moduleId);
    return record ? this.toLoadedPluginInfo(record) : undefined;
  }

  getStats(): PluginManagerStats {
    const loaded = this.loadedPlugins.size;
    const withUi = this.getLoadedPlugins().filter((plugin) => plugin.hasUi).length;
    return { loaded, withUi };
  }

  private async importPluginModule(entry: ModuleRegistryEntry): Promise<PluginFactoryModule> {
    const pluginEntry = this.getPluginEntry(entry);
    const importUrl = pathToFileURL(join(entry.modulePath, pluginEntry)).href;
    return import(`${importUrl}?t=${Date.now()}`) as Promise<PluginFactoryModule>;
  }

  private resolveFactory(pluginModule: PluginFactoryModule, moduleId: string) {
    if (typeof pluginModule.createPlugin === 'function') {
      return pluginModule.createPlugin;
    }

    if (typeof pluginModule.default === 'function') {
      return pluginModule.default;
    }

    if (pluginModule.default && typeof pluginModule.default === 'object' && typeof pluginModule.default.createPlugin === 'function') {
      return pluginModule.default.createPlugin;
    }

    throw new Error(`Plugin ${moduleId} does not export createPlugin(context)`);
  }

  private createContext(entry: ModuleRegistryEntry, routePrefix: string): PlatformPluginContext {
    const platformBaseUrl = `http://${this.options.host}:${this.options.port}`;
    return {
      moduleId: entry.moduleId,
      modulePath: entry.modulePath,
      manifest: entry.manifest,
      config: { ...entry.moduleConfig },
      routePrefix,
      platformBaseUrl,
      messageBusUrl: platformBaseUrl
    };
  }

  private getPluginEntry(entry: ModuleRegistryEntry): string {
    if (entry.manifest.plugin?.entry) {
      return entry.manifest.plugin.entry;
    }

    if (entry.manifest.entry.args?.[0]) {
      return entry.manifest.entry.args[0];
    }

    throw new Error(`Plugin entry is not defined for module ${entry.moduleId}`);
  }

  private getRoutePrefix(entry: ModuleRegistryEntry): string {
    const configured = entry.manifest.plugin?.basePath?.trim();
    if (configured) {
      return configured.startsWith('/') ? configured : `/${configured}`;
    }

    return `/plugin/${entry.moduleId}`;
  }

  private toLoadedPluginInfo(record: LoadedPluginRecord): LoadedPluginInfo {
    const metadata = record.plugin.getMetadata?.() || {};
    return {
      pluginId: record.moduleId,
      moduleId: record.moduleId,
      version: record.entry.manifest.version,
      displayName: metadata.displayName || record.entry.manifest.plugin?.displayName || record.entry.manifest.name,
      description: metadata.description || record.entry.manifest.plugin?.description || record.entry.manifest.description,
      icon: metadata.icon || record.entry.manifest.plugin?.icon,
      hasUi: metadata.hasUi ?? record.entry.manifest.plugin?.hasUi ?? true,
      basePath: record.routePrefix,
      homePath: metadata.homePath || record.entry.manifest.plugin?.homePath || '/',
      status: record.entry.status,
      loadedAt: record.loadedAt,
      updatedAt: record.updatedAt
    };
  }
}