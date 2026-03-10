import assert from 'node:assert/strict';
import { AgentRuntime } from './AgentRuntime';
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

async function main(): Promise<void> {
  await testEnqueueUsesOriginalMessageContent();
  console.log('AgentRuntime tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});