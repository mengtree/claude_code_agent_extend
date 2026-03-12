import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { cwd } from 'node:process';
import type { PlatformConfig } from '../types.js';

const CONFIG_PATH = process.env.PLATFORM_APP_CONFIG || './config.json';

const DEFAULT_CONFIG: PlatformConfig = {
  port: 3200,
  host: '127.0.0.1',
  modulesRoot: '../Modules',
  logLevel: 'info',
  healthCheckInterval: 15000,
  maxRestarts: 3,
  restartBackoffMs: 5000,
  moduleStartDelayMs: 2000,
  startupDelayMs: 1000
};

export async function loadConfig(): Promise<PlatformConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as Partial<PlatformConfig>;
    return normalizeConfig({ ...DEFAULT_CONFIG, ...parsed });
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

export function loadConfigFromEnv(): Partial<PlatformConfig> {
  const config: Partial<PlatformConfig> = {};

  if (process.env.PLATFORM_APP_PORT) {
    const port = parseInt(process.env.PLATFORM_APP_PORT, 10);
    if (!Number.isNaN(port) && port > 0 && port < 65536) {
      config.port = port;
    }
  }

  if (process.env.PLATFORM_APP_HOST) {
    config.host = process.env.PLATFORM_APP_HOST;
  }

  if (process.env.PLATFORM_APP_MODULES_ROOT) {
    config.modulesRoot = process.env.PLATFORM_APP_MODULES_ROOT;
  }

  if (process.env.PLATFORM_APP_LOG_LEVEL) {
    const level = process.env.PLATFORM_APP_LOG_LEVEL;
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      config.logLevel = level;
    }
  }

  if (process.env.PLATFORM_APP_HEALTH_CHECK_INTERVAL) {
    const value = parseInt(process.env.PLATFORM_APP_HEALTH_CHECK_INTERVAL, 10);
    if (!Number.isNaN(value) && value > 0) {
      config.healthCheckInterval = value;
    }
  }

  if (process.env.PLATFORM_APP_MAX_RESTARTS) {
    const value = parseInt(process.env.PLATFORM_APP_MAX_RESTARTS, 10);
    if (!Number.isNaN(value) && value >= 0) {
      config.maxRestarts = value;
    }
  }

  if (process.env.PLATFORM_APP_RESTART_BACKOFF_MS) {
    const value = parseInt(process.env.PLATFORM_APP_RESTART_BACKOFF_MS, 10);
    if (!Number.isNaN(value) && value >= 0) {
      config.restartBackoffMs = value;
    }
  }

  if (process.env.PLATFORM_APP_STARTUP_DELAY_MS) {
    const value = parseInt(process.env.PLATFORM_APP_STARTUP_DELAY_MS, 10);
    if (!Number.isNaN(value) && value >= 0) {
      config.startupDelayMs = value;
    }
  }

  if (process.env.PLATFORM_APP_MODULE_START_DELAY_MS) {
    const value = parseInt(process.env.PLATFORM_APP_MODULE_START_DELAY_MS, 10);
    if (!Number.isNaN(value) && value >= 0) {
      config.moduleStartDelayMs = value;
    }
  }

  return normalizeConfig({ ...DEFAULT_CONFIG, ...config });
}

export async function getConfig(): Promise<PlatformConfig> {
  const fileConfig = await loadConfig();
  const envConfig = loadConfigFromEnv();
  return normalizeConfig({ ...fileConfig, ...envConfig });
}

function normalizeConfig(config: PlatformConfig): PlatformConfig {
  return {
    ...config,
    modulesRoot: isAbsolute(config.modulesRoot)
      ? config.modulesRoot
      : resolve(cwd(), config.modulesRoot)
  };
}