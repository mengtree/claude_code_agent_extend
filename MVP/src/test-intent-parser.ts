import assert from 'node:assert/strict';
import { IntentParser } from './IntentParser';
import { AgentSession, ClaudeCliResponse } from './types';

const mockSession: AgentSession = {
  id: 'session-1',
  workspacePath: process.cwd(),
  claudeProjectPath: process.cwd(),
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  interruptRequested: false,
  externalMappings: []
};

async function testKeepsOriginalMessageForGenericEnqueue(): Promise<void> {
  const originalMessage = '  帮我整理这个需求，然后给一个实施方案  ';
  const parser = new IntentParser({
    execute: async (): Promise<ClaudeCliResponse> => ({
      ok: true,
      result: JSON.stringify({
        intent: 'enqueue_task',
        acknowledgement: '已入队任务。',
        taskContent: '请整理需求并输出实施方案',
        taskSummary: '整理需求方案',
        priority: 'normal'
      }),
      raw: {}
    })
  } as never);

  const parsed = await parser.parse(originalMessage, mockSession, []);

  assert.equal(parsed.intent, 'enqueue_task');
  assert.equal(parsed.taskContent, originalMessage);
  assert.equal(parsed.taskSummary, '整理需求方案');
}

async function testFallbackKeepsOriginalMessageForGenericEnqueue(): Promise<void> {
  const originalMessage = '  请调研一下这个库的使用方式  ';
  const parser = new IntentParser({
    execute: async (): Promise<ClaudeCliResponse> => {
      throw new Error('mock parse failure');
    }
  } as never);

  const parsed = await parser.parse(originalMessage, mockSession, []);

  assert.equal(parsed.intent, 'enqueue_task');
  assert.equal(parsed.taskContent, originalMessage);
}

async function main(): Promise<void> {
  await testKeepsOriginalMessageForGenericEnqueue();
  await testFallbackKeepsOriginalMessageForGenericEnqueue();
  console.log('IntentParser tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});