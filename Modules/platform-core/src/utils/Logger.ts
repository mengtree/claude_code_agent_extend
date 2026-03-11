/**
 * 日志工具
 *
 * 提供简单的日志功能
 */

import type { LogLevel } from '../types/index.js';

/**
 * 日志级别对应的颜色
 */
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // 青色
  info: '\x1b[32m',   // 绿色
  warn: '\x1b[33m',   // 黄色
  error: '\x1b[31m'   // 红色
};

/**
 * 重置颜色
 */
const RESET_COLOR = '\x1b[0m';

/**
 * 日志工具类
 */
export class Logger {
  private readonly minLevel: LogLevel;
  private readonly levelWeights: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  /**
   * 调试日志
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  /**
   * 信息日志
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  /**
   * 警告日志
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  /**
   * 错误日志
   */
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (this.levelWeights[level] < this.levelWeights[this.minLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const reset = RESET_COLOR;

    const prefix = `${color}[${timestamp}] [${level.toUpperCase()}]${reset}`;

    if (args.length > 0) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix, message);
    }
  }
}

/**
 * 创建日志器实例
 */
export function createLogger(minLevel: LogLevel = 'info'): Logger {
  return new Logger(minLevel);
}
