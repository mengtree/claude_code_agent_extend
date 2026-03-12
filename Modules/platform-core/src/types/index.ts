/**
 * 平台核心模块类型定义
 *
 * 本模块定义了平台核心的所有类型，包括：
 * - 请求/响应类型
 * - 会话管理类型
 * - 消息类型
 * - 流式传输类型
 */

// ============================================
// 请求类型
// ============================================

/**
 * Claude 查询请求
 */
export interface ClaudeQueryRequest {
  /** 用户提示词 */
  prompt: string;
  /** 业务会话 ID（可选，用于业务侧关联） */
  sessionId?: string;
  /** Claude 会话 ID（可选，用于恢复 Claude 多轮对话） */
  claudeSessionId?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 使用的模型 */
  model?: string;
  /** 是否使用流式传输 */
  stream?: boolean;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** JSON Schema（用于结构化输出） */
  jsonSchema?: Record<string, unknown>;
  /** Claude 执行工作目录 */
  workingDirectory?: string;
}

/**
 * 创建会话请求
 */
export interface CreateSessionRequest {
  /** 外部来源（如 IM 平台） */
  externalSource?: string;
  /** 外部会话 ID */
  externalConversationId?: string;
}

/**
 * 列出会话请求
 */
export interface ListSessionsRequest {
  /** 返回数量限制 */
  limit?: number;
  /** 会话状态过滤 */
  status?: 'active' | 'deleted';
}

/**
 * 删除会话请求
 */
export interface DeleteSessionRequest {
  /** 会话 ID */
  sessionId: string;
  /** 是否保留 Claude 会话数据 */
  keepClaude?: boolean;
}

// ============================================
// 响应类型
// ============================================

/**
 * Claude 查询响应（非流式）
 */
export interface ClaudeQueryResponse {
  /** 是否成功 */
  ok: boolean;
  /** 结果内容 */
  result: string;
  /** 会话 ID */
  sessionId?: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 执行时长（毫秒） */
  durationMs?: number;
  /** 成本（美元） */
  costUsd?: number;
  /** 停止原因 */
  stopReason?: string;
  /** 原始响应 */
  raw?: ClaudeSdkRawResult;
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
  status: 'active' | 'deleted';
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 外部映射 */
  externalMappings?: ExternalMapping[];
}

/**
 * 外部映射信息
 */
export interface ExternalMapping {
  /** 外部来源 */
  source: string;
  /** 外部会话 ID */
  conversationId: string;
  /** 映射时间 */
  mappedAt: string;
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

// ============================================
// 流式传输类型
// ============================================

/**
 * SSE 事件类型
 */
export type SseEventType =
  | 'init'           // 初始化
  | 'user'           // 用户消息
  | 'assistant'      // 助手消息
  | 'tool_use'       // 工具使用
  | 'tool_result'    // 工具结果
  | 'content_block'  // 内容块
  | 'result'         // 最终结果
  | 'error'          // 错误
  | 'done';          // 完成

/**
 * SSE 事件数据
 */
export interface SseEventData {
  /** 事件类型 */
  type: SseEventType;
  /** 会话 ID */
  sessionId?: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 数据内容 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: string;
}

// ============================================
// Claude SDK 类型（适配）
// ============================================

/**
 * Claude SDK 原始结果
 */
export interface ClaudeSdkRawResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  stop_reason?: string;
  structured_output?: unknown;
  errors?: string[];
  [key: string]: unknown;
}

/**
 * SDK 消息类型
 */
export type SdkMessageType =
  | 'init'
  | 'user'
  | 'assistant'
  | 'result'
  | 'error';

/**
 * SDK 消息基础
 */
export interface SdkMessageBase {
  type: SdkMessageType;
  session_id?: string;
}

/**
 * SDK 初始化消息
 */
export interface SdkInitMessage extends SdkMessageBase {
  type: 'init';
  subtype: 'init';
  apiKeySource: string;
  cwd: string;
  session_id: string;
  tools: string[];
  mcp_servers: Array<{
    name: string;
    status: string;
  }>;
  model: string;
  permissionMode: string;
}

/**
 * SDK 用户消息
 */
export interface SdkUserMessage extends SdkMessageBase {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{
      type: string;
      text?: string;
    }>;
  };
}

/**
 * SDK 助手消息
 */
export interface SdkAssistantMessage extends SdkMessageBase {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    model: string;
    stop_reason: string;
    stop_sequence?: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * SDK 结果消息
 */
export interface SdkResultMessage extends SdkMessageBase {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  structured_output?: unknown;
  errors?: string[];
  session_id: string;
  total_cost_usd: number;
  stop_reason?: string;
}

/**
 * SDK 错误消息
 */
export interface SdkErrorMessage extends SdkMessageBase {
  type: 'error';
  error: string;
  session_id?: string;
}

/**
 * SDK 消息联合类型
 */
export type SdkMessage =
  | SdkInitMessage
  | SdkUserMessage
  | SdkAssistantMessage
  | SdkResultMessage
  | SdkErrorMessage;

// ============================================
// 会话存储类型
// ============================================

/**
 * 会话状态
 */
export type SessionStatus = 'active' | 'deleted';

/**
 * 存储的会话数据
 */
export interface StoredSession {
  /** 会话 ID */
  id: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 外部映射 */
  externalMappings: ExternalMapping[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================
// 配置类型
// ============================================

/**
 * 模块配置
 */
export interface ModuleConfig {
  /** HTTP 服务端口 */
  port: number;
  /** HTTP 服务监听地址 */
  host?: string;
  /** 默认模型 */
  defaultModel?: string;
  /** 默认超时时间（毫秒） */
  defaultTimeoutMs?: number;
  /** 最大并发会话数 */
  maxConcurrentSessions?: number;
  /** 是否持久化会话 */
  sessionPersistence?: boolean;
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Platform 消息总线地址 */
  messageBusURL?: string;
}

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ============================================
// 错误类型
// ============================================

/**
 * 模块错误基类
 */
export class PlatformCoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'PlatformCoreError';
  }
}

/**
 * 会话未找到错误
 */
export class SessionNotFoundError extends PlatformCoreError {
  constructor(sessionId: string) {
    super(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      404
    );
    this.name = 'SessionNotFoundError';
  }
}

/**
 * 请求验证错误
 */
export class ValidationError extends PlatformCoreError {
  constructor(message: string) {
    super(
      message,
      'VALIDATION_ERROR',
      400
    );
    this.name = 'ValidationError';
  }
}

/**
 * SDK 调用错误
 */
export class SdkExecutionError extends PlatformCoreError {
  constructor(message: string, public readonly originalError?: unknown) {
    super(
      message,
      'SDK_EXECUTION_ERROR',
      500
    );
    this.name = 'SdkExecutionError';
  }
}

// ============================================
// 消息 Envelope 类型
// ============================================

/**
 * 消息信封
 */
export interface MessageEnvelope {
  /** 消息唯一标识 */
  messageId: string;
  /** 追踪 ID */
  traceId: string;
  /** 发送方模块 */
  fromModule: string;
  /** 接收方模块 */
  toModule: string;
  /** 动作名 */
  action: string;
  /** 载荷 */
  payload: unknown;
  /** 回复目标模块 */
  replyTo: string;
  /** 回调主题 */
  callbackTopic?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 上下文信息 */
  context: {
    sessionId?: string;
    conversationId?: string;
    userId?: string;
    originRequestId?: string;
    [key: string]: unknown;
  };
  /** 创建时间 */
  createdAt: string;
  /** 回复的消息 ID */
  inReplyTo?: string;
}

/**
 * 消息处理器函数类型
 */
export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

/**
 * 模块消息处理结果
 */
export type MessageHandlerResult = unknown;

/**
 * 模块消息处理器函数类型
 */
export type MessageRequestHandler = (envelope: MessageEnvelope) => MessageHandlerResult | Promise<MessageHandlerResult>;
