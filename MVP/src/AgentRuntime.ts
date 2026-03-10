import { randomUUID } from 'node:crypto';
import { ClaudeCliExecution, ClaudeCliService, injectWorkspaceSystemPrompt } from './ClaudeCliService';
import { IntentParser } from './IntentParser';
import { ScheduleService } from './ScheduleService';
import { SessionManager } from './SessionManager';
import { Storage } from './Storage';
import { TaskQueueService } from './TaskQueueService';
import {
  AcceptedIncomingMessageReply,
  AgentSession,
  IncomingMessageJob,
  IncomingMessageRequest,
  IntentParseResult,
  PassiveReply,
  PushMessage,
  ScheduleTask,
  SessionTask
} from './types';
import { DebugLogger } from './DebugLogger';

interface RunningTaskContext {
  execution: ClaudeCliExecution;
  taskId: string;
}

type PushSubscriber = (message: PushMessage) => void;

export class AgentRuntime {
  private readonly runningTasks = new Map<string, RunningTaskContext>();
  private readonly processingIncomingMessages = new Set<string>();
  private readonly pushSubscribers = new Map<string, { sessionId?: string; listener: PushSubscriber }>();
  private backgroundDrainPromise?: Promise<void>;

  constructor(
    private readonly storage: Storage,
    private readonly sessionManager: SessionManager,
    private readonly taskQueueService: TaskQueueService,
    private readonly scheduleService: ScheduleService,
    private readonly intentParser: IntentParser,
    private readonly claudeCliService: ClaudeCliService,
    private readonly workspacePath: string
  ) {}

  async acceptIncomingMessage(request: IncomingMessageRequest): Promise<AcceptedIncomingMessageReply> {
    DebugLogger.info('input.accepted_request', {
      sessionId: request.sessionId,
      externalSource: request.externalSource,
      externalConversationId: request.externalConversationId,
      messagePreview: this.toPreview(request.message)
    });

    const session = await this.sessionManager.resolveSession({
      sessionId: request.sessionId,
      externalSource: request.externalSource,
      externalConversationId: request.externalConversationId
    });

    const incomingMessage = await this.enqueueIncomingMessage(session, request);
    this.scheduleBackgroundWork();

    return {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      intent: 'processing',
      status: 'accepted',
      acceptedMessageId: incomingMessage.id
    };
  }

  async handleIncomingMessage(request: IncomingMessageRequest): Promise<PassiveReply> {
    DebugLogger.info('input.received', {
      sessionId: request.sessionId,
      externalSource: request.externalSource,
      externalConversationId: request.externalConversationId,
      messagePreview: this.toPreview(request.message)
    });

    const session = await this.sessionManager.resolveSession({
      sessionId: request.sessionId,
      externalSource: request.externalSource,
      externalConversationId: request.externalConversationId
    });

    const tasks = await this.taskQueueService.list(session.id);
    const intent = await this.intentParser.parse(request.message, session, tasks);
    DebugLogger.info('input.intent_resolved', {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      intent: intent.intent,
      priority: intent.priority,
      taskId: intent.taskId,
      taskSummary: intent.taskSummary
    });

    return this.executeIntent(session, request.message, intent);
  }

  async processPendingIncomingMessages(): Promise<number> {
    let processedMessageCount = 0;

    for (;;) {
      const incomingMessage = await this.claimNextIncomingMessage();

      if (!incomingMessage) {
        return processedMessageCount;
      }

      processedMessageCount += 1;
      this.processingIncomingMessages.add(incomingMessage.id);

      try {
        await this.processIncomingMessage(incomingMessage);
      } finally {
        this.processingIncomingMessages.delete(incomingMessage.id);
      }
    }
  }

  async processPendingTasks(): Promise<number> {
    let startedTaskCount = 0;
    const sessions = await this.sessionManager.listSessions();

    for (const session of sessions) {
      if (this.runningTasks.has(session.id)) {
        continue;
      }

      const nextTask = await this.taskQueueService.claimNextQueuedTask(session.id);

      if (!nextTask) {
        continue;
      }

      startedTaskCount += 1;
      void this.processTask(session, nextTask).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[worker-error][${session.id}] ${message}\n`);
      });
    }

    return startedTaskCount;
  }

  async processDueSchedules(): Promise<number> {
    const claimedSchedules = await this.scheduleService.claimDueSchedules();

    for (const schedule of claimedSchedules) {
      await this.processClaimedSchedule(schedule);
    }

    return claimedSchedules.length;
  }

  async handleInterrupts(): Promise<void> {
    const sessions = await this.sessionManager.listSessions();

    for (const session of sessions) {
      if (!session.interruptRequested) {
        continue;
      }

      const runningTask = this.runningTasks.get(session.id);

      if (runningTask) {
        runningTask.execution.cancel();
      }
    }
  }

  async runWorkerLoop(pollIntervalMs: number): Promise<void> {
    for (;;) {
      await this.handleInterrupts();
      await this.processPendingIncomingMessages();
      await this.processDueSchedules();
      await this.processPendingTasks();
      await this.sleep(pollIntervalMs);
    }
  }

  async drainUntilIdle(pollIntervalMs: number): Promise<void> {
    for (;;) {
      if (this.backgroundDrainPromise) {
        await this.backgroundDrainPromise;
      }

      await this.handleInterrupts();
      const processedMessages = await this.processPendingIncomingMessages();
      const processedSchedules = await this.processDueSchedules();
      const startedTasks = await this.processPendingTasks();

      if (
        processedMessages === 0 &&
        processedSchedules === 0 &&
        startedTasks === 0 &&
        this.runningTasks.size === 0 &&
        this.processingIncomingMessages.size === 0 &&
        !this.backgroundDrainPromise
      ) {
        return;
      }

      await this.sleep(pollIntervalMs);
    }
  }

  async listPushMessages(limit: number, sessionId?: string): Promise<PushMessage[]> {
    return this.storage.loadPushMessages(limit, sessionId);
  }

  subscribeToPushMessages(listener: PushSubscriber, sessionId?: string): () => void {
    const subscriptionId = randomUUID();
    this.pushSubscribers.set(subscriptionId, { sessionId, listener });

    return () => {
      this.pushSubscribers.delete(subscriptionId);
    };
  }

  private async executeIntent(
    session: AgentSession,
    message: string,
    intent: IntentParseResult
  ): Promise<PassiveReply> {
    switch (intent.intent) {
      case 'list_tasks': {
        const currentTasks = await this.taskQueueService.list(session.id);
        return {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          reply: this.formatTaskList(currentTasks),
          intent: intent.intent,
          tasks: currentTasks
        };
      }
      case 'remove_task': {
        if (!intent.taskId) {
          return {
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            reply: '没有识别到要移除的任务 ID，请明确提供任务 ID。',
            intent: intent.intent
          };
        }

        const removedTask = await this.taskQueueService.removeQueuedTask(session.id, intent.taskId);
        return {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          reply: removedTask
            ? `任务 ${removedTask.id} 已从队列移除。`
            : `没有找到可移除的排队任务 ${intent.taskId}。`,
          intent: intent.intent
        };
      }
      case 'interrupt': {
        await this.sessionManager.requestInterrupt(session.id);
        DebugLogger.warn('task.interrupt_requested', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId
        });
        return {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          reply: intent.acknowledgement,
          intent: intent.intent
        };
      }
      case 'clear_session': {
        await this.sessionManager.clearSession(session.id, true);
        DebugLogger.warn('session.cleared', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId
        });
        return {
          sessionId: session.id,
          reply: '当前会话已清空，本地队列和 Claude 会话持久化已重置。',
          intent: intent.intent
        };
      }
      case 'enqueue_task':
      default: {
        const queuedTask = await this.taskQueueService.enqueue(
          session.id,
          message,
          intent.taskSummary || message,
          intent.priority
        );

        DebugLogger.info('task.queued', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          taskId: queuedTask.id,
          priority: queuedTask.priority,
          summary: queuedTask.summary
        });

        return {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          reply: intent.acknowledgement,
          intent: intent.intent,
          queuedTask
        };
      }
    }
  }

  private async processTask(session: AgentSession, task: SessionTask): Promise<void> {
    const activeSession = await this.sessionManager.tryGetSession(session.id);

    if (!activeSession) {
      DebugLogger.warn('task.aborted_session_missing', {
        sessionId: session.id,
        taskId: task.id,
        summary: task.summary,
        phase: 'before_start'
      });
      const cancelledTask = await this.taskQueueService.tryMarkCancelled(
        session.id,
        task.id,
        'Session was removed before task start.'
      );

      if (cancelledTask) {
        await this.scheduleService.settleTriggeredTask(cancelledTask, 'cancelled', cancelledTask.error);
      }

      return;
    }

    await this.sessionManager.tryClearInterrupt(session.id);
    await this.sessionManager.trySetCurrentTask(session.id, task.id);
    DebugLogger.info('task.started', {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      taskId: task.id,
      summary: task.summary,
      priority: task.priority
    });

    const execution = this.claudeCliService.startExecution({
      task: task.content,
      systemPrompt: injectWorkspaceSystemPrompt(undefined, this.workspacePath, session.id),
      workingDirectory: this.workspacePath,
      resumeSessionId: session.claudeSessionId,
      timeoutMs: 10 * 60 * 1000
    });

    this.runningTasks.set(session.id, {
      execution,
      taskId: task.id
    });

    try {
      const response = await execution.completion;
      const updatedSession = await this.sessionManager.tryAttachClaudeSessionId(session.id, response.sessionId);
      const updatedTask = await this.taskQueueService.tryMarkCompleted(session.id, task.id, response.result);

      if (!updatedSession || !updatedTask) {
        DebugLogger.warn('task.finished_without_session', {
          sessionId: session.id,
          taskId: task.id,
          status: 'completed',
          summary: task.summary,
          reason: !updatedSession ? 'session_missing' : 'task_missing'
        });
        return;
      }

      DebugLogger.info('task.finished', {
        sessionId: session.id,
        claudeSessionId: response.sessionId,
        taskId: task.id,
        status: 'completed',
        summary: task.summary,
        resultPreview: this.toPreview(response.result)
      });
      await this.scheduleService.settleTriggeredTask(updatedTask, 'completed');
      await this.pushMessage({
        id: randomUUID(),
        sessionId: session.id,
        claudeSessionId: response.sessionId,
        taskId: task.id,
        category: 'task_completed',
        content: response.result,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isCancelled = /cancelled/i.test(message);

      if (isCancelled) {
        const cancelledTask = await this.taskQueueService.tryMarkCancelled(session.id, task.id, message);
        DebugLogger.warn('task.finished', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          taskId: task.id,
          status: 'cancelled',
          summary: task.summary,
          error: message
        });

        if (cancelledTask) {
          await this.scheduleService.settleTriggeredTask(cancelledTask, 'cancelled', message);
        }

        if (cancelledTask && (await this.sessionManager.tryGetSession(session.id))) {
          await this.pushMessage({
            id: randomUUID(),
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            taskId: task.id,
            category: 'task_cancelled',
            content: `任务 ${task.summary} 已中断。`,
            createdAt: new Date().toISOString()
          });
        }
      } else {
        const failedTask = await this.taskQueueService.tryMarkFailed(session.id, task.id, message);
        DebugLogger.error('task.finished', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          taskId: task.id,
          status: 'failed',
          summary: task.summary,
          error: message
        });

        if (failedTask) {
          await this.scheduleService.settleTriggeredTask(failedTask, 'failed', message);
        }

        if (failedTask && (await this.sessionManager.tryGetSession(session.id))) {
          await this.pushMessage({
            id: randomUUID(),
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            taskId: task.id,
            category: 'task_failed',
            content: `任务 ${task.summary} 执行失败: ${message}`,
            createdAt: new Date().toISOString()
          });
        }
      }
    } finally {
      this.runningTasks.delete(session.id);
      const clearedCurrentTask = await this.sessionManager.trySetCurrentTask(session.id, undefined);
      const clearedInterrupt = await this.sessionManager.tryClearInterrupt(session.id);
      this.scheduleBackgroundWork();

      if (!clearedCurrentTask || !clearedInterrupt) {
        DebugLogger.warn('task.cleanup_skipped', {
          sessionId: session.id,
          taskId: task.id,
          summary: task.summary,
          reason: 'session_missing'
        });
      }
    }
  }

  private async pushMessage(message: PushMessage): Promise<void> {
    await this.storage.appendPushMessage(message);

    for (const subscription of this.pushSubscribers.values()) {
      if (!subscription.sessionId || subscription.sessionId === message.sessionId) {
        subscription.listener(message);
      }
    }

    process.stdout.write(`[push][${message.sessionId}] ${message.content}\n`);
  }

  private formatTaskList(tasks: SessionTask[]): string {
    if (tasks.length === 0) {
      return '当前没有任务。';
    }

    return tasks
      .map((task) => `${task.id} | ${task.status} | ${task.priority} | ${task.summary}`)
      .join('\n');
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private toPreview(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= 80 ? normalized : `${normalized.slice(0, 80)}...`;
  }

  private scheduleBackgroundWork(): void {
    if (this.backgroundDrainPromise) {
      return;
    }

    this.backgroundDrainPromise = (async () => {
      for (;;) {
        await this.handleInterrupts();
        const processedMessages = await this.processPendingIncomingMessages();
        const processedSchedules = await this.processDueSchedules();
        const startedTasks = await this.processPendingTasks();

        if (processedMessages === 0 && processedSchedules === 0 && startedTasks === 0) {
          return;
        }
      }
    })()
      .catch((error: unknown) => {
        DebugLogger.error('background.drain_failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        this.backgroundDrainPromise = undefined;
      });
  }

  private async enqueueIncomingMessage(
    session: AgentSession,
    request: IncomingMessageRequest
  ): Promise<IncomingMessageJob> {
    return this.storage.withIncomingMessagesLock(async (messages) => {
      const now = new Date().toISOString();
      const incomingMessage: IncomingMessageJob = {
        id: randomUUID(),
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        message: request.message,
        externalSource: request.externalSource,
        externalConversationId: request.externalConversationId,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      };

      messages.push(incomingMessage);
      await this.storage.writeIncomingMessagesUnsafe(messages);
      DebugLogger.info('input.persisted', {
        sessionId: session.id,
        messageId: incomingMessage.id,
        externalSource: request.externalSource,
        externalConversationId: request.externalConversationId
      });
      return incomingMessage;
    });
  }

  private async claimNextIncomingMessage(): Promise<IncomingMessageJob | undefined> {
    return this.storage.withIncomingMessagesLock(async (messages) => {
      const nextMessage = messages.find((message) => message.status === 'queued');

      if (!nextMessage) {
        return undefined;
      }

      const claimedMessage: IncomingMessageJob = {
        ...nextMessage,
        status: 'processing',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const messageIndex = messages.findIndex((message) => message.id === claimedMessage.id);
      messages[messageIndex] = claimedMessage;
      await this.storage.writeIncomingMessagesUnsafe(messages);
      return claimedMessage;
    });
  }

  private async processIncomingMessage(incomingMessage: IncomingMessageJob): Promise<void> {
    const session = await this.sessionManager.tryGetSession(incomingMessage.sessionId);

    if (!session) {
      await this.failIncomingMessage(incomingMessage.id, 'Session was removed before message processing.');
      return;
    }

    try {
      const tasks = await this.taskQueueService.list(session.id);
      const intent = await this.intentParser.parse(incomingMessage.message, session, tasks);
      const reply = await this.executeIntent(session, incomingMessage.message, intent);

      await this.completeIncomingMessage(incomingMessage.id, intent, reply);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.failIncomingMessage(incomingMessage.id, errorMessage);
      await this.pushMessage({
        id: randomUUID(),
        sessionId: incomingMessage.sessionId,
        claudeSessionId: session.claudeSessionId,
        category: 'system',
        content: `消息处理失败: ${errorMessage}`,
        createdAt: new Date().toISOString()
      });
    }
  }

  private async completeIncomingMessage(
    messageId: string,
    intent: IntentParseResult,
    reply: PassiveReply
  ): Promise<void> {
    await this.storage.withIncomingMessagesLock(async (messages) => {
      const messageIndex = messages.findIndex((message) => message.id === messageId);

      if (messageIndex < 0) {
        return;
      }

      messages.splice(messageIndex, 1);
      await this.storage.writeIncomingMessagesUnsafe(messages);
      DebugLogger.info('input.completed', {
        messageId,
        sessionId: reply.sessionId,
        intent: intent.intent,
        queuedTaskId: reply.queuedTask?.id
      });
    });
  }

  private async failIncomingMessage(messageId: string, error: string): Promise<void> {
    await this.storage.withIncomingMessagesLock(async (messages) => {
      const messageIndex = messages.findIndex((message) => message.id === messageId);

      if (messageIndex < 0) {
        return;
      }

      const failedMessage = {
        ...messages[messageIndex],
        status: 'failed' as const,
        error,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      messages[messageIndex] = failedMessage;
      await this.storage.writeIncomingMessagesUnsafe(messages);
      DebugLogger.error('input.failed', {
        messageId,
        sessionId: failedMessage.sessionId,
        error
      });
    });
  }

  private async processClaimedSchedule(schedule: ScheduleTask): Promise<void> {
    const session = await this.sessionManager.tryGetSession(schedule.sessionId);

    if (!session) {
      await this.scheduleService.releaseClaim(schedule, 'Session was removed before schedule trigger.');
      return;
    }

    try {
      const tasks = await this.taskQueueService.list(schedule.sessionId);
      const existingQueuedTask = tasks.find(
        (task) =>
          task.sourceScheduleId === schedule.id &&
          task.sourceScheduleTriggerAt === schedule.claimedAt
      );
      const isAlreadyEnqueued = Boolean(existingQueuedTask);
      let dispatchedTaskId = existingQueuedTask?.id;

      if (!isAlreadyEnqueued) {
        const queuedTask = await this.taskQueueService.enqueue(
          schedule.sessionId,
          schedule.content,
          schedule.summary,
          'normal',
          {
            sourceScheduleId: schedule.id,
            sourceScheduleTriggerAt: schedule.claimedAt
          }
        );
        dispatchedTaskId = queuedTask.id;

        DebugLogger.info('schedule.enqueued_task', {
          sessionId: schedule.sessionId,
          scheduleId: schedule.id,
          taskId: queuedTask.id,
          triggerAt: schedule.claimedAt,
          sourceType: schedule.sourceType
        });

        await this.pushMessage({
          id: randomUUID(),
          sessionId: schedule.sessionId,
          claudeSessionId: session.claudeSessionId,
          taskId: queuedTask.id,
          category: 'system',
          content: `定时任务已触发并入队: ${schedule.summary}。`,
          createdAt: new Date().toISOString()
        });
      }

      await this.scheduleService.completeTriggeredSchedule(schedule, dispatchedTaskId);
      this.scheduleBackgroundWork();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.scheduleService.releaseClaim(schedule, message);
      DebugLogger.error('schedule.trigger_failed', {
        sessionId: schedule.sessionId,
        scheduleId: schedule.id,
        error: message
      });
    }
  }
}