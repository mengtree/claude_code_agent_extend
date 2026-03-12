/**
 * 配置工具
 *
 * 负责加载和管理模块配置
 */

import { readFile } from 'node:fs/promises';
import type { ModuleConfig } from '../types/index.js';

function getEnvValue(name: string): string | undefined {
  return process.env[`PLATFORM_CORE_${name}`] ?? process.env[name];
}

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
  logLevel: 'info',
  messageBusURL: process.env.MESSAGE_BUS_URL || 'http://localhost:3000'
};

/**
 * 加载配置
 */
export async function loadConfig(): Promise<ModuleConfig> {
  try {
    console.info(`Loading configuration from ${CONFIG_PATH}...`);
    const content = await readFile(CONFIG_PATH, 'utf-8');
    console.info('Configuration file loaded successfully');
    const config = JSON.parse(content) as Partial<ModuleConfig>;

    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    // 配置文件不存在或无效，使用默认配置
    console.warn(`Failed to load configuration from ${CONFIG_PATH}, using default configuration.`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 从环境变量加载配置
 */
export function loadConfigFromEnv(): Partial<ModuleConfig> {
  const config: Partial<ModuleConfig> = {};

  const portValue = getEnvValue('PORT');
  if (portValue) {
    const port = parseInt(portValue, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      config.port = port;
    }
  }

  const hostValue = getEnvValue('HOST');
  if (hostValue) {
    config.host = hostValue;
  }

  const defaultModelValue = getEnvValue('DEFAULT_MODEL');
  if (defaultModelValue) {
    config.defaultModel = defaultModelValue;
  }

  const defaultTimeoutValue = getEnvValue('DEFAULT_TIMEOUT_MS');
  if (defaultTimeoutValue) {
    const timeout = parseInt(defaultTimeoutValue, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.defaultTimeoutMs = timeout;
    }
  }

  const maxConcurrentValue = getEnvValue('MAX_CONCURRENT_SESSIONS');
  if (maxConcurrentValue) {
    const max = parseInt(maxConcurrentValue, 10);
    if (!isNaN(max) && max > 0) {
      config.maxConcurrentSessions = max;
    }
  }

  const sessionPersistenceValue = getEnvValue('SESSION_PERSISTENCE');
  if (sessionPersistenceValue) {
    config.sessionPersistence = sessionPersistenceValue === 'true';
  }

  const logLevelValue = getEnvValue('LOG_LEVEL');
  if (logLevelValue) {
    const level = logLevelValue;
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      config.logLevel = level;
    }
  }

  const messageBusURLValue = getEnvValue('MESSAGE_BUS_URL');
  if (messageBusURLValue) {
    config.messageBusURL = messageBusURLValue;
  }

  return config;
}

/**
 * 获取配置（优先级：环境变量 > 配置文件 > 默认值）
 */
export async function getConfig(): Promise<ModuleConfig> {
  const fileConfig = await loadConfig();
  const envConfig = loadConfigFromEnv();

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}
