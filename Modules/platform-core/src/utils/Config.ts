/**
 * 配置工具
 *
 * 负责加载和管理模块配置
 */

import { readFile } from 'node:fs/promises';
import type { ModuleConfig } from '../types/index.js';

/**
 * 配置文件路径
 */
const CONFIG_PATH = process.env.PLATFORM_CORE_CONFIG || './config.json';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ModuleConfig = {
  port: 3000,
  host: '127.0.0.1',
  defaultModel: 'claude-sonnet-4-6',
  defaultTimeoutMs: 120000,
  maxConcurrentSessions: 100,
  sessionPersistence: true,
  logLevel: 'info'
};

/**
 * 加载配置
 */
export async function loadConfig(): Promise<ModuleConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content) as Partial<ModuleConfig>;

    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    // 配置文件不存在或无效，使用默认配置
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 从环境变量加载配置
 */
export function loadConfigFromEnv(): ModuleConfig {
  const config: ModuleConfig = { ...DEFAULT_CONFIG };

  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      config.port = port;
    }
  }

  if (process.env.HOST) {
    config.host = process.env.HOST;
  }

  if (process.env.DEFAULT_MODEL) {
    config.defaultModel = process.env.DEFAULT_MODEL;
  }

  if (process.env.DEFAULT_TIMEOUT_MS) {
    const timeout = parseInt(process.env.DEFAULT_TIMEOUT_MS, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.defaultTimeoutMs = timeout;
    }
  }

  if (process.env.MAX_CONCURRENT_SESSIONS) {
    const max = parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10);
    if (!isNaN(max) && max > 0) {
      config.maxConcurrentSessions = max;
    }
  }

  if (process.env.SESSION_PERSISTENCE) {
    config.sessionPersistence = process.env.SESSION_PERSISTENCE === 'true';
  }

  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL;
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      config.logLevel = level;
    }
  }

  return config;
}

/**
 * 获取配置（优先级：环境变量 > 配置文件 > 默认值）
 */
export async function getConfig(): Promise<ModuleConfig> {
  const fileConfig = await loadConfig();
  const envConfig = loadConfigFromEnv();

  return { ...fileConfig, ...envConfig };
}
