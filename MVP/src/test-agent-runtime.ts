import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentRuntime } from './AgentRuntime';
import { ScheduleService } from './ScheduleService';
import { SessionManager } from './SessionManager';
import { Storage } from './Storage';
import { TaskQueueService } from './TaskQueueService';
import { AgentSession, IntentParseResult, SessionTask, TaskPriority } from './types';

const mockSession: AgentSession = {
  id: 'session-runtime-test',
  workspacePath: process.cwd(),
  claudeProjectPath: process.cwd(),
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  interruptRequested: false,
  externalMappings: []
};

function createQueuedTask(content: string, summary: string, priority: TaskPriority): SessionTask {
  const now = new Date().toISOString();
  return {
    id: 'task-runtime-test',
    sessionId: mockSession.id,
    content,
    summary,
    status: 'queued',
    priority,
    createdAt: now,
    updatedAt: now
  };
}

async function testEnqueueUsesOriginalMessageContent(): Promise<void> {
  let capturedEnqueueArgs:
    | { sessionId: string; content: string; summary: string; priority: TaskPriority }
    | undefined;

  const runtime = new AgentRuntime(
    {} as never,
    {} as never,
    {
      enqueue: async (sessionId: string, content: string, summary: string, priority: TaskPriority): Promise<SessionTask> => {
        capturedEnqueueArgs = { sessionId, content, summary, priority };
        return createQueuedTask(content, summary, priority);
      }
    } as never,
    {
      claimDueSchedules: async () => [],
      completeTriggeredSchedule: async () => undefined,
      releaseClaim: async () => undefined
    } as never,
    {} as never,
    {} as never,
    process.cwd()
  );

  const originalMessage = '请按我这段原始输入执行，不要改写任务内容';
  const parsedIntent: IntentParseResult = {
    intent: 'enqueue_task',
    acknowledgement: '已加入队列。',
    taskContent: '这是解析器改写后的内容，不应该用于入队',
    taskSummary: '原始输入执行',
    priority: 'urgent'
  };

  const reply = await (runtime as unknown as {
    executeIntent: (session: AgentSession, message: string, intent: IntentParseResult) => Promise<{ queuedTask?: SessionTask }>;
  }).executeIntent(mockSession, originalMessage, parsedIntent);

  assert.deepEqual(capturedEnqueueArgs, {
    sessionId: mockSession.id,
    content: originalMessage,
    summary: '原始输入执行',
    priority: 'urgent'
  });
  assert.equal(reply.queuedTask?.content, originalMessage);
}

async function testDueScheduleEnqueuesQueueTask(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-agent-runtime-schedule-test');
  await removeDirectoryWithRetry(workspacePath);
  let runtime: AgentRuntime | undefined;

  try {
    const storage = new Storage(workspacePath);
    const sessionManager = new SessionManager(storage, workspacePath);
    const taskQueueService = new TaskQueueService(storage);
    const runtimeTaskQueueService = createPassiveRuntimeTaskQueueService(taskQueueService);
    const scheduleService = new ScheduleService(storage);
    const session = await sessionManager.resolveSession({});

    await storage.saveSchedule(session.id, {
      id: 'runtime-schedule-test',
      sessionId: session.id,
      content: '提醒我确认定时任务已入队',
      summary: '定时任务入队验证',
      sourceType: 'one_time',
      status: 'active',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
      nextRunAt: '2026-03-10T00:00:00.000Z'
    });

    runtime = new AgentRuntime(
      storage,
      sessionManager,
      runtimeTaskQueueService as never,
      scheduleService,
      {} as never,
      {} as never,
      workspacePath
    );

    const processedCount = await runtime.processDueSchedules();
    const queue = await taskQueueService.list(session.id);
    const persistedSchedule = await storage.loadSchedule(session.id, 'runtime-schedule-test');

    assert.equal(processedCount, 1);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].content, '提醒我确认定时任务已入队');
    assert.equal(queue[0].sourceScheduleId, 'runtime-schedule-test');
    assert.ok(persistedSchedule);
    assert.equal(persistedSchedule?.status, 'dispatched');
    assert.equal(persistedSchedule?.lastDispatchedTaskId, queue[0].id);
  } finally {
    await awaitBackgroundDrain(runtime);
    await removeDirectoryWithRetry(workspacePath);
  }
}

async function testCronScheduleDoesNotEnqueueRepeatedlyBeforeCompletion(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-agent-runtime-cron-schedule-test');
  await removeDirectoryWithRetry(workspacePath);
  let runtime: AgentRuntime | undefined;

  try {
    const storage = new Storage(workspacePath);
    const sessionManager = new SessionManager(storage, workspacePath);
    const taskQueueService = new TaskQueueService(storage);
    const runtimeTaskQueueService = createPassiveRuntimeTaskQueueService(taskQueueService);
    const scheduleService = new ScheduleService(storage);
    const session = await sessionManager.resolveSession({});

    await storage.saveSchedule(session.id, {
      id: 'runtime-cron-schedule-test',
      sessionId: session.id,
      content: '提醒我确认 cron 不会重复入队',
      summary: 'cron 去重验证',
      sourceType: 'cron',
      status: 'active',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
      nextRunAt: '2026-03-10T00:00:00.000Z',
      cronExpression: '* * * * *',
      timezone: 'UTC'
    });

    runtime = new AgentRuntime(
      storage,
      sessionManager,
      runtimeTaskQueueService as never,
      scheduleService,
      {} as never,
      {} as never,
      workspacePath
    );

    const firstProcessedCount = await runtime.processDueSchedules();
    const secondProcessedCount = await runtime.processDueSchedules();
    const queue = await taskQueueService.list(session.id);
    const persistedSchedule = await storage.loadSchedule(session.id, 'runtime-cron-schedule-test');

    assert.equal(firstProcessedCount, 1);
    assert.equal(secondProcessedCount, 0);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].sourceScheduleId, 'runtime-cron-schedule-test');
    assert.ok(persistedSchedule);
    assert.equal(persistedSchedule?.status, 'dispatched');
    assert.equal(persistedSchedule?.lastDispatchedTaskId, queue[0].id);
  } finally {
    await awaitBackgroundDrain(runtime);
    await removeDirectoryWithRetry(workspacePath);
  }
}

async function testPushScheduleSendsMessageWithoutQueueTask(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-agent-runtime-push-schedule-test');
  await removeDirectoryWithRetry(workspacePath);
  let runtime: AgentRuntime | undefined;

  try {
    const storage = new Storage(workspacePath);
    const sessionManager = new SessionManager(storage, workspacePath);
    const taskQueueService = new TaskQueueService(storage);
    const runtimeTaskQueueService = createPassiveRuntimeTaskQueueService(taskQueueService);
    const scheduleService = new ScheduleService(storage);
    const session = await sessionManager.resolveSession({});

    await storage.saveSchedule(session.id, {
      id: 'runtime-push-schedule-test',
      sessionId: session.id,
      content: '提醒：直接推送，不进入任务队列',
      summary: '直接推送验证',
      sourceType: 'one_time',
      deliveryMode: 'push',
      status: 'active',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
      nextRunAt: '2026-03-10T00:00:00.000Z'
    });

    runtime = new AgentRuntime(
      storage,
      sessionManager,
      runtimeTaskQueueService as never,
      scheduleService,
      {} as never,
      {} as never,
      workspacePath
    );

    const processedCount = await runtime.processDueSchedules();
    const queue = await taskQueueService.list(session.id);
    const pushMessages = await storage.loadPushMessages(10, session.id);
    const persistedSchedule = await storage.loadSchedule(session.id, 'runtime-push-schedule-test');

    assert.equal(processedCount, 1);
    assert.equal(queue.length, 0);
    assert.equal(pushMessages.length, 1);
    assert.equal(pushMessages[0].content, '提醒：直接推送，不进入任务队列');
    assert.equal(persistedSchedule, undefined);
  } finally {
    await awaitBackgroundDrain(runtime);
    await removeDirectoryWithRetry(workspacePath);
  }
}

async function awaitBackgroundDrain(runtime: AgentRuntime | undefined): Promise<void> {
  const backgroundDrainPromise = (runtime as unknown as { backgroundDrainPromise?: Promise<void> } | undefined)?.backgroundDrainPromise;

  if (backgroundDrainPromise) {
    await backgroundDrainPromise;
  }
}

function createPassiveRuntimeTaskQueueService(taskQueueService: TaskQueueService) {
  return {
    list: (sessionId: string) => taskQueueService.list(sessionId),
    enqueueScheduledTaskIfAbsent: (
      sessionId: string,
      content: string,
      summary: string,
      priority: TaskPriority,
      scheduleId: string,
      triggerAt: string
    ) => taskQueueService.enqueueScheduledTaskIfAbsent(sessionId, content, summary, priority, scheduleId, triggerAt),
    claimNextQueuedTask: async () => undefined
  };
}

async function removeDirectoryWithRetry(directoryPath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directoryPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  }
}

async function main(): Promise<void> {
  await testEnqueueUsesOriginalMessageContent();
  await testDueScheduleEnqueuesQueueTask();
  await testCronScheduleDoesNotEnqueueRepeatedlyBeforeCompletion();
  await testPushScheduleSendsMessageWithoutQueueTask();
  console.log('AgentRuntime tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});