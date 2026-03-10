export interface ClaudeCliRequest {
  task: string;
  systemPrompt?: string;
  model?: string;
  resumeSessionId?: string;
  noSessionPersistence?: boolean;
  jsonSchema?: Record<string, unknown>;
  workingDirectory?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface ClaudeCliRawResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  stop_reason?: string;
  [key: string]: unknown;
}

export interface ClaudeCliResponse {
  ok: boolean;
  sessionId?: string;
  result: string;
  durationMs?: number;
  costUsd?: number;
  stopReason?: string;
  raw: ClaudeCliRawResult;
}

export interface ExternalConversationMapping {
  source: string;
  conversationId: string;
}

export type SessionStatus = 'active' | 'deleted';

export interface AgentSession {
  id: string;
  workspacePath: string;
  claudeProjectPath: string;
  claudeSessionId?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  currentTaskId?: string;
  interruptRequested: boolean;
  externalMappings: ExternalConversationMapping[];
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'normal' | 'urgent';
export type ScheduleSourceType = 'one_time' | 'delay' | 'cron';
export type ScheduleStatus = 'active' | 'paused' | 'dispatched';

export interface SessionTask {
  id: string;
  sessionId: string;
  content: string;
  summary: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  sourceScheduleId?: string;
  sourceScheduleTriggerAt?: string;
}

export interface ScheduleTask {
  id: string;
  sessionId: string;
  content: string;
  summary: string;
  sourceType: ScheduleSourceType;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  runAt?: string;
  cronExpression?: string;
  timezone?: string;
  lastTriggeredAt?: string;
  claimedAt?: string;
  triggerToken?: string;
  lastError?: string;
  lastDispatchedTaskId?: string;
}

export interface IntentParseResult {
  intent: 'enqueue_task' | 'list_tasks' | 'remove_task' | 'interrupt' | 'clear_session' | 'calculate' | 'transform_text';
  acknowledgement: string;
  taskContent?: string;
  taskSummary?: string;
  taskId?: string;
  expression?: string;
  transformType?: string;
  textToTransform?: string;
  priority: TaskPriority;
}

export interface IncomingMessageRequest {
  message: string;
  sessionId?: string;
  externalSource?: string;
  externalConversationId?: string;
}

export type IncomingMessageStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IncomingMessageJob {
  id: string;
  sessionId: string;
  claudeSessionId?: string;
  message: string;
  externalSource?: string;
  externalConversationId?: string;
  status: IncomingMessageStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  intent?: IntentParseResult['intent'];
  reply?: string;
  queuedTaskId?: string;
  error?: string;
}

export interface AcceptedIncomingMessageReply {
  sessionId: string;
  claudeSessionId?: string;
  intent: 'processing';
  status: 'accepted';
  acceptedMessageId: string;
  reply?: string;
}

export interface PassiveReply {
  sessionId: string;
  claudeSessionId?: string;
  reply?: string;
  intent: IntentParseResult['intent'];
  queuedTask?: SessionTask;
  tasks?: SessionTask[];
}

export interface PushMessage {
  id: string;
  sessionId: string;
  claudeSessionId?: string;
  taskId?: string;
  category: 'task_completed' | 'task_failed' | 'task_cancelled' | 'system';
  content: string;
  createdAt: string;
}

export interface ImAdapterRequest {
  source: string;
  conversationId: string;
  userId?: string;
  message: string;
}

export interface ImAdapterResponse {
  source: string;
  conversationId: string;
  userId?: string;
  sessionId: string;
  reply?: string;
  intent: PassiveReply['intent'] | AcceptedIncomingMessageReply['intent'];
  status?: AcceptedIncomingMessageReply['status'];
  acceptedMessageId?: string;
  queuedTaskId?: string;
}