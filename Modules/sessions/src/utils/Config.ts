/**
 * 配置工具
 *
 * 负责加载和管理模块配置
 */

import { readFile } from 'node:fs/promises';
import type { SessionsConfig } from '../types/index.js';

/**
 * 配置文件路径
 */
const CONFIG_PATH = process.env.SESSIONS_CONFIG || './config.json';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SessionsConfig = {
  port: 3010,
  host: '127.0.0.1',
  logLevel: 'info',
  dataDir: './runtime/data',
  sessionTimeoutDays: 30
};

/**
 * 加载配置
 */
export async function loadConfig(): Promise<SessionsConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content) as Partial<SessionsConfig>;

    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    // 配置文件不存在或无效，使用默认配置
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 从环境变量加载配置
 */
export function loadConfigFromEnv(): Partial<SessionsConfig> {
  const config: Partial<SessionsConfig> = {};

  if (process.env.SESSIONS_PORT) {
    const port = parseInt(process.env.SESSIONS_PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      config.port = port;
    }
  }

  if (process.env.SESSIONS_HOST) {
    config.host = process.env.SESSIONS_HOST;
  }

  if (process.env.SESSIONS_LOG_LEVEL) {
    const level = process.env.SESSIONS_LOG_LEVEL;
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      config.logLevel = level;
    }
  }

  if (process.env.SESSIONS_DATA_DIR) {
    config.dataDir = process.env.SESSIONS_DATA_DIR;
  }

  if (process.env.SESSIONS_TIMEOUT_DAYS) {
    const days = parseInt(process.env.SESSIONS_TIMEOUT_DAYS, 10);
    if (!isNaN(days) && days > 0) {
      config.sessionTimeoutDays = days;
    }
  }

  return config;
}

/**
 * 获取配置（优先级：环境变量 > 配置文件 > 默认值）
 */
export async function getConfig(): Promise<SessionsConfig> {
  const fileConfig = await loadConfig();
  const envConfig = loadConfigFromEnv();

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}
