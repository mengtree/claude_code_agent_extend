import { readFile } from 'node:fs/promises';
import type { ScheduleModuleConfig } from '../types/index.js';

const CONFIG_PATH = process.env.SCHEDULE_CONFIG || './config.json';

const DEFAULT_CONFIG: ScheduleModuleConfig = {
  port: 3015,
  host: '127.0.0.1',
  logLevel: 'info',
  dataDir: './runtime/data',
  messageBusURL: process.env.MESSAGE_BUS_URL || 'http://localhost:3200',
  scanIntervalMs: 1000,
  claimTimeoutMs: 300000
};

export async function loadConfig(): Promise<ScheduleModuleConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content) as Partial<ScheduleModuleConfig>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function loadConfigFromEnv(): Partial<ScheduleModuleConfig> {
  const config: Partial<ScheduleModuleConfig> = {};

  if (process.env.SCHEDULE_PORT) {
    const port = Number.parseInt(process.env.SCHEDULE_PORT, 10);
    if (!Number.isNaN(port)) {
      config.port = port;
    }
  }

  if (process.env.SCHEDULE_HOST) {
    config.host = process.env.SCHEDULE_HOST;
  }

  if (process.env.SCHEDULE_LOG_LEVEL) {
    const level = process.env.SCHEDULE_LOG_LEVEL;
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      config.logLevel = level;
    }
  }

  if (process.env.SCHEDULE_DATA_DIR) {
    config.dataDir = process.env.SCHEDULE_DATA_DIR;
  }

  if (process.env.MESSAGE_BUS_URL) {
    config.messageBusURL = process.env.MESSAGE_BUS_URL;
  }

  if (process.env.SCHEDULE_SCAN_INTERVAL_MS) {
    const scanIntervalMs = Number.parseInt(process.env.SCHEDULE_SCAN_INTERVAL_MS, 10);
    if (!Number.isNaN(scanIntervalMs)) {
      config.scanIntervalMs = scanIntervalMs;
    }
  }

  if (process.env.SCHEDULE_CLAIM_TIMEOUT_MS) {
    const claimTimeoutMs = Number.parseInt(process.env.SCHEDULE_CLAIM_TIMEOUT_MS, 10);
    if (!Number.isNaN(claimTimeoutMs)) {
      config.claimTimeoutMs = claimTimeoutMs;
    }
  }

  return config;
}

export async function getConfig(): Promise<ScheduleModuleConfig> {
  const fileConfig = await loadConfig();
  const envConfig = loadConfigFromEnv();
  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}