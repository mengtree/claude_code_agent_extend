import type { LogLevel } from '../types.js';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m'
};

const RESET_COLOR = '\x1b[0m';

export class Logger {
  private readonly levelWeights: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(private readonly minLevel: LogLevel = 'info') {}

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (this.levelWeights[level] < this.levelWeights[this.minLevel]) {
      return;
    }

    const prefix = `${LOG_COLORS[level]}[${new Date().toISOString()}] [${level.toUpperCase()}]${RESET_COLOR}`;
    if (args.length > 0) {
      console.log(prefix, message, ...args);
      return;
    }

    console.log(prefix, message);
  }
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  return new Logger(minLevel);
}