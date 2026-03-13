export type ScheduleSourceType = 'delay' | 'cron';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface StoredSchedule {
  id: string;
  title: string;
  message: string;
  sourceType: ScheduleSourceType;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  delayMs?: number;
  cronExpression?: string;
  timezone?: string;
  sessionId?: string;
  claudeSessionId?: string;
  workingDirectory?: string;
  systemPrompt?: string;
  model?: string;
  claimedAt?: string;
  lastError?: string;
  lastResponseSummary?: string;
}

export interface CreateScheduleRequest {
  title?: string;
  message: string;
  sourceType: ScheduleSourceType;
  status?: ScheduleStatus;
  delayMs?: number;
  cronExpression?: string;
  timezone?: string;
  sessionId?: string;
  claudeSessionId?: string;
  workingDirectory?: string;
  systemPrompt?: string;
  model?: string;
}

export interface UpdateScheduleRequest extends Partial<CreateScheduleRequest> {
  scheduleId: string;
}

export interface ListSchedulesQuery {
  status?: ScheduleStatus;
  sourceType?: ScheduleSourceType;
}

export interface ScheduleStats {
  total: number;
  active: number;
  byType: Record<ScheduleSourceType, number>;
}

export interface HealthCheckResponse {
  ok: boolean;
  uptime: number;
  activeSchedules: number;
  version: string;
  startedAt: string;
}

export interface ScheduleModuleConfig {
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dataDir: string;
  messageBusURL?: string;
  scanIntervalMs: number;
  claimTimeoutMs: number;
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

export interface ScheduleExecutionResult {
  ok: boolean;
  response?: string;
  sessionId?: string;
  claudeSessionId?: string;
  durationMs?: number;
  costUsd?: number;
  stopReason?: string;
  error?: string;
}

export type MessageHandlerResult = unknown;
export type MessageRequestHandler = (envelope: MessageEnvelope) => MessageHandlerResult | Promise<MessageHandlerResult>;

export class ScheduleModuleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'ScheduleModuleError';
  }
}

export class ValidationError extends ScheduleModuleError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}
