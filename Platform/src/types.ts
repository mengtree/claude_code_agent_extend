export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ModuleKind = 'core' | 'adapter' | 'executor' | 'manager';

export type ModuleStatus =
  | 'registered'
  | 'installing'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'unhealthy'
  | 'restarting'
  | 'paused'
  | 'failed'
  | 'disabled';

export interface ModuleManifest {
  moduleId: string;
  name: string;
  version: string;
  description?: string;
  kind: ModuleKind;
  entry: {
    command: string;
    args?: string[];
  };
  startup?: {
    autoStart?: boolean;
    daemon?: boolean;
    restartPolicy?: 'always' | 'on-failure' | 'never';
    restartMaxRetries?: number;
    restartBackoffMs?: number;
    /** 启动延迟（毫秒），用于控制模块启动顺序 */
    delayMs?: number;
  };
  healthCheck?: {
    type: 'http' | 'process' | 'heartbeat';
    path?: string;
    intervalMs?: number;
    timeoutMs?: number;
    unhealthyThreshold?: number;
  };
  configSchema?: {
    type: string;
    properties?: Record<string, unknown>;
  };
  capabilities?: ModuleCapability[];
  dataPolicy?: {
    isolated?: boolean;
    dataDir?: string;
    logDir?: string;
    tmpDir?: string;
  };
  permissions?: {
    workspaceRead?: boolean;
    workspaceWrite?: boolean;
    network?: boolean;
    processSpawn?: boolean;
    envRead?: boolean;
  };
  dependencies?: {
    nodejs?: string;
    npm?: string[];
  };
}

export interface ModuleCapability {
  action: string;
  description?: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
  idempotent?: boolean;
}

export interface MessageEnvelope {
  messageId: string;
  traceId: string;
  fromModule: string;
  toModule: string;
  action: string;
  payload: unknown;
  replyTo: string;
  callbackTopic?: string;
  timeoutMs?: number;
  context: {
    sessionId?: string;
    conversationId?: string;
    userId?: string;
    originRequestId?: string;
    [key: string]: unknown;
  };
  createdAt: string;
  inReplyTo?: string;
}

export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

export interface ModuleRegistryOptions {
  modulesRoot: string;
}

export interface MessageBusOptions {
  maxHistorySize?: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  statusCode?: number;
  duration?: number;
}

export interface PlatformConfig {
  port: number;
  host: string;
  modulesRoot: string;
  logLevel: LogLevel;
  healthCheckInterval: number;
  maxRestarts: number;
  restartBackoffMs: number;
  /** 全局模块启动延迟（毫秒），每个模块启动之间间隔 */
  moduleStartDelayMs?: number;
  /** 模块启动前的全局延迟（毫秒） */
  startupDelayMs?: number;
}

export interface PlatformRuntimeOptions {
  modulesRoot: string;
  maxMessageHistory?: number;
  healthCheckInterval?: number;
  maxRestarts?: number;
  restartBackoffMs?: number;
  logLevel?: LogLevel;
  /** 全局模块启动延迟（毫秒），每个模块启动之间间隔 */
  moduleStartDelayMs?: number;
  /** 模块启动前的全局延迟（毫秒） */
  startupDelayMs?: number;
}

export interface PlatformRuntimeStatus {
  isStarted: boolean;
  modules: {
    total: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
  };
  messaging: {
    totalHandlers: number;
    subscribedModules: number;
    pendingRequests: number;
    historySize: number;
  };
  processes: {
    runningModules: number;
    totalRestarts: number;
    unhealthyModules: number;
  };
}