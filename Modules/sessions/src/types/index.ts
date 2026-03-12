/**
 * Sessions Module 类型定义
 */

/**
 * 会话状态
 */
export type SessionStatus = 'active' | 'deleted';

/**
 * 外部映射
 */
export interface ExternalMapping {
  /** 外部系统标识 */
  source: string;
  /** 外部会话 ID */
  conversationId: string;
  /** 映射创建时间 */
  mappedAt: string;
}

/**
 * 存储的会话信息
 */
export interface StoredSession {
  /** 会话 ID */
  id: string;
  /** Claude 会话 ID（首次调用 SDK 后设置） */
  claudeSessionId?: string;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 外部系统映射 */
  externalMappings: ExternalMapping[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 创建会话请求
 */
export interface CreateSessionRequest {
  /** 外部系统来源 */
  externalSource?: string;
  /** 外部会话 ID */
  externalConversationId?: string;
}

/**
 * 创建会话响应
 */
export interface CreateSessionResponse {
  /** 会话 ID */
  sessionId: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 外部映射 */
  externalMappings: ExternalMapping[];
}

/**
 * 列出会话请求
 */
export interface ListSessionsRequest {
  /** 返回数量限制 */
  limit?: number;
  /** 状态过滤 */
  status?: SessionStatus;
}

/**
 * 删除会话响应
 */
export interface DeleteSessionResponse {
  /** 是否成功删除 */
  deleted: boolean;
  /** 会话 ID */
  sessionId: string;
}

/**
 * 消息提交请求
 */
export interface SubmitMessageRequest {
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 */
  message: string;
  /** 是否使用流式响应 */
  stream?: boolean;
}

/**
 * 消息响应
 */
export interface MessageResponse {
  /** AI 响应内容 */
  response: string;
  /** Token 使用情况 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * 会话消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 会话消息
 */
export interface SessionMessage {
  /** 消息 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 发送方角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 发送会话消息请求
 */
export interface SendSessionMessageRequest {
  /** 消息内容 */
  message: string;
}

/**
 * 发送会话消息响应
 */
export interface SendSessionMessageResponse {
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 */
  userMessage: SessionMessage;
  /** 助手回复 */
  reply: SessionMessage;
  /** 当前会话全部消息 */
  messages: SessionMessage[];
}

/**
 * 健康检查响应
 */
export interface HealthCheckResponse {
  /** 是否健康 */
  ok: boolean;
  /** 运行时长（秒） */
  uptime: number;
  /** 活跃会话数 */
  activeSessions: number;
  /** 版本 */
  version: string;
  /** 启动时间 */
  startedAt: string;
}

/**
 * 模块配置
 */
export interface SessionsConfig {
  /** HTTP 服务端口 */
  port: number;
  /** HTTP 服务监听地址 */
  host: string;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 数据目录路径 */
  dataDir: string;
  /** 会话超时天数 */
  sessionTimeoutDays: number;
  /** platform-core 通用消息入口 */
  platformCoreUrl: string;
  /** Platform 消息总线地址 */
  messageBusURL?: string;
}

/**
 * Message Envelope - 模块间通信消息
 */
export interface MessageEnvelope {
  /** 消息 ID */
  messageId: string;
  /** 追踪 ID */
  traceId: string;
  /** 发送模块 */
  fromModule: string;
  /** 目标模块 */
  toModule: string;
  /** 动作名称 */
  action: string;
  /** 消息载荷 */
  payload: unknown;
  /** 回复给哪个模块 */
  replyTo: string;
  /** 回调主题 */
  callbackTopic?: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 上下文信息 */
  context: MessageContext;
  /** 创建时间 */
  createdAt: string;
  /** 回复的消息 ID */
  inReplyTo?: string;
}

/**
 * 消息上下文
 */
export interface MessageContext {
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 原始请求 ID */
  originRequestId?: string;
  /** 其他上下文 */
  [key: string]: unknown;
}

/**
 * 消息处理器
 */
export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

/**
 * platform-core 消息回复载荷
 */
export interface PlatformCoreReplyPayload {
  ok: boolean;
  response: string;
  sessionId?: string;
  claudeSessionId?: string;
  durationMs?: number;
  costUsd?: number;
  stopReason?: string;
  raw?: Record<string, unknown>;
}

/**
 * 错误类型
 */
export class SessionsError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SessionsError';
  }
}

export class ValidationError extends SessionsError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class SessionNotFoundError extends SessionsError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

export class ExternalMappingNotFoundError extends SessionsError {
  constructor(source: string, conversationId: string) {
    super(`External mapping not found: ${source}/${conversationId}`, 'EXTERNAL_MAPPING_NOT_FOUND');
    this.name = 'ExternalMappingNotFoundError';
  }
}
