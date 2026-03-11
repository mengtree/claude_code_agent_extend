/**
 * 日志工具
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m'  // red
};

const RESET = '\x1b[0m';

/**
 * 创建日志记录器
 */
export function createLogger(level: LogLevel = 'info') {
  const minPriority = LEVEL_PRIORITY[level];

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (minPriority <= 0) {
        console.log(`${COLORS.debug}[DEBUG]${RESET}`, message, ...args);
      }
    },

    info: (message: string, ...args: unknown[]) => {
      if (minPriority <= 1) {
        console.log(`${COLORS.info}[INFO]${RESET}`, message, ...args);
      }
    },

    warn: (message: string, ...args: unknown[]) => {
      if (minPriority <= 2) {
        console.log(`${COLORS.warn}[WARN]${RESET}`, message, ...args);
      }
    },

    error: (message: string, ...args: unknown[]) => {
      if (minPriority <= 3) {
        console.log(`${COLORS.error}[ERROR]${RESET}`, message, ...args);
      }
    }
  };
}

export type Logger = ReturnType<typeof createLogger>;
